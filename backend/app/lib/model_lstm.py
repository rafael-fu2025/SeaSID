"""
LSTM deep learning model (Primary) for SeaSID.

Uses PyTorch nn.LSTM to process sequences of hourly weather features
for binary no-go prediction.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from app.lib.features import FEATURE_COLUMNS

logger = logging.getLogger(__name__)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ── Model architecture ────────────────────────────────────────────────────

class LSTMPredictor(nn.Module):
    """LSTM-based binary classifier for dive condition prediction.

    Phase 2 fix: the final activation is now ``Linear`` (raw logits) instead
    of ``Sigmoid``. Pairing this with ``BCEWithLogitsLoss`` is numerically
    stable and lets gradients flow even when the logit is far from zero —
    the previous Sigmoid+BCELoss combo was the root cause of the LSTM
    collapsing to 0.5 on the 78-sample dataset (Phase 0 finding).
    """

    def __init__(
        self,
        input_size: int = 11,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
            # No Sigmoid here — see class docstring.
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass. x shape: (batch, seq_len, input_size). Returns logits."""
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]  # take last timestep
        return self.classifier(last_hidden).squeeze(-1)


class GRUPredictor(nn.Module):
    """GRU variant for ablation comparison.

    Phase 2 fix: removed final Sigmoid for the same reason as LSTMPredictor.
    """

    def __init__(
        self,
        input_size: int = 11,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.gru = nn.GRU(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        gru_out, _ = self.gru(x)
        last_hidden = gru_out[:, -1, :]
        return self.classifier(last_hidden).squeeze(-1)


# ── Training configuration ────────────────────────────────────────────────

@dataclass
class LSTMTrainConfig:
    seq_len: int = 24
    hidden_size: int = 64
    num_layers: int = 2
    dropout: float = 0.3
    lr: float = 1e-3
    batch_size: int = 32
    max_epochs: int = 100
    patience: int = 10
    weight_decay: float = 1e-4
    arch: Literal["lstm", "gru"] = "lstm"
    optimizer: Literal["adam", "adamw", "rmsprop"] = "adam"
    random_seed: int = 42
    # Phase 2: pos_weight for BCEWithLogitsLoss. Default 1.0 disables the
    # class balancing; the trainer computes the optimal value from the label
    # ratio when left at None. Set explicitly to a float to override.
    pos_weight: float | None = None


@dataclass
class LSTMTrainingResult:
    model: nn.Module
    scaler: StandardScaler
    metrics: dict
    train_losses: list[float]
    val_losses: list[float]
    n_samples: int
    config: LSTMTrainConfig
    feature_columns: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))


# ── Training ──────────────────────────────────────────────────────────────

def train_lstm(
    X_sequences: np.ndarray,
    y: np.ndarray,
    config: LSTMTrainConfig | None = None,
    label_dates: list | None = None,
) -> LSTMTrainingResult:
    """
    Train an LSTM/GRU model on sequence data.

    Args:
        X_sequences: shape (n_samples, seq_len, n_features)
        y: shape (n_samples,) binary labels
        config: training hyperparameters
        label_dates: optional list of ``datetime.date`` / ISO strings in the
            same order as ``y``. When provided, the train/val split is
            time-aware (earliest 85% train, latest 15% val) instead of a
            random shuffle. Phase 2: random shuffle leaks future weather
            into training because consecutive days share 23 of 24 lookback
            hours.

    Returns:
        LSTMTrainingResult with trained model, scaler, metrics, and loss history
    """
    if config is None:
        config = LSTMTrainConfig()

    np.random.seed(config.random_seed)
    torch.manual_seed(config.random_seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(config.random_seed)

    n_samples = len(X_sequences)
    if n_samples == 0:
        raise ValueError("Cannot train on empty dataset")

    n_features = X_sequences.shape[2] if X_sequences.ndim == 3 else len(FEATURE_COLUMNS)

    def random_split_indices() -> tuple[np.ndarray, np.ndarray]:
        if n_samples < 3:
            return np.arange(n_samples), np.array([], dtype=int)
        indices = np.arange(n_samples)
        counts = np.unique(y, return_counts=True)[1]
        stratify = y if len(counts) > 1 and counts.min() >= 2 else None
        try:
            return train_test_split(
                indices, test_size=0.15, random_state=config.random_seed,
                shuffle=True, stratify=stratify,
            )
        except ValueError:
            shuffled = np.random.RandomState(config.random_seed).permutation(indices)
            split_point = max(1, int(n_samples * 0.85))
            return shuffled[:split_point], shuffled[split_point:]

    # ── Normalize features ─────────────────────────────────────────────
    # ── Train/val split ────────────────────────────────────────────────
    # Phase 2: time-aware split when label_dates is supplied. Without
    # dates we fall back to a deterministic random shuffle (legacy tests).
    if label_dates is not None and len(label_dates) == n_samples:
        from datetime import date as _date
        # Sort indices by date — earliest train, latest val.
        parsed: list[tuple[int, _date]] = []
        for i, d in enumerate(label_dates):
            if isinstance(d, str):
                parsed.append((i, _date.fromisoformat(d)))
            elif isinstance(d, _date):
                parsed.append((i, d))
            else:
                parsed = None
                break
        if parsed is not None:
            parsed.sort(key=lambda x: x[1])
            sorted_indices = [i for i, _ in parsed]
            split_idx = max(1, int(n_samples * 0.85))
            train_idx = np.array(sorted_indices[:split_idx])
            val_idx = np.array(sorted_indices[split_idx:])
        else:
            train_idx, val_idx = random_split_indices()
    else:
        train_idx, val_idx = random_split_indices()

    # Preprocessing is fitted on training timesteps only. The previous
    # fit_transform over every sequence leaked validation statistics.
    scaler = StandardScaler()
    original_shape = X_sequences.shape
    scaler.fit(X_sequences[train_idx].reshape(-1, n_features))
    X_scaled = scaler.transform(
        X_sequences.reshape(-1, n_features)
    ).reshape(original_shape)

    X_train = torch.FloatTensor(X_scaled[train_idx]).to(DEVICE)
    y_train = torch.FloatTensor(y[train_idx]).to(DEVICE)
    X_val = torch.FloatTensor(X_scaled[val_idx]).to(DEVICE) if len(val_idx) > 0 else None
    y_val = torch.FloatTensor(y[val_idx]).to(DEVICE) if len(val_idx) > 0 else None

    train_dataset = TensorDataset(X_train, y_train)
    train_loader = DataLoader(
        train_dataset,
        batch_size=config.batch_size,
        shuffle=True,
    )

    # ── Build model ────────────────────────────────────────────────────
    if config.arch == "gru":
        model = GRUPredictor(
            input_size=n_features,
            hidden_size=config.hidden_size,
            num_layers=config.num_layers,
            dropout=config.dropout,
        ).to(DEVICE)
    else:
        model = LSTMPredictor(
            input_size=n_features,
            hidden_size=config.hidden_size,
            num_layers=config.num_layers,
            dropout=config.dropout,
        ).to(DEVICE)

    # Phase 2: BCEWithLogitsLoss replaces BCELoss so the model's raw logits
    # feed directly into the loss. We compute pos_weight from the training
    # labels unless the config overrides it — this stops the model from
    # ignoring the minority class (40+ positives vs 60+ negatives in the
    # current dataset).
    # Class weighting is learned from the training labels only.
    n_pos = float(y[train_idx].sum())
    n_neg = float(len(train_idx) - n_pos)
    if config.pos_weight is None:
        if n_pos == 0 or n_neg == 0:
            pw_tensor = torch.tensor([1.0], device=DEVICE)
        else:
            pw_tensor = torch.tensor([n_neg / n_pos], device=DEVICE)
    else:
        pw_tensor = torch.tensor([float(config.pos_weight)], device=DEVICE)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pw_tensor)
    optimizer_class = {
        "adam": torch.optim.Adam,
        "adamw": torch.optim.AdamW,
        "rmsprop": torch.optim.RMSprop,
    }[config.optimizer]
    optimizer = optimizer_class(model.parameters(), lr=config.lr, weight_decay=config.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=5,
    )

    # ── Training loop ──────────────────────────────────────────────────
    train_losses: list[float] = []
    val_losses: list[float] = []
    best_val_loss = float("inf")
    best_state = None
    patience_counter = 0

    for epoch in range(config.max_epochs):
        # Train
        model.train()
        epoch_loss = 0.0
        n_batches = 0

        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            preds = model(X_batch)
            loss = criterion(preds, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            epoch_loss += loss.item()
            n_batches += 1

        avg_train_loss = epoch_loss / max(n_batches, 1)
        train_losses.append(avg_train_loss)

        # Validate
        if X_val is not None and len(X_val) > 0:
            model.eval()
            with torch.no_grad():
                val_preds = model(X_val)
                val_loss = criterion(val_preds, y_val).item()
            val_losses.append(val_loss)
            scheduler.step(val_loss)

            # Early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
                patience_counter = 0
            else:
                patience_counter += 1

            if patience_counter >= config.patience:
                logger.info("Early stopping at epoch %d (best val loss: %.4f)",
                            epoch + 1, best_val_loss)
                break
        else:
            val_losses.append(avg_train_loss)

    # Restore best weights
    if best_state is not None:
        model.load_state_dict(best_state)

    # ── Compute metrics ────────────────────────────────────────────────
    model.eval()
    evaluation_idx = val_idx if len(val_idx) > 0 else train_idx
    metrics = _compute_metrics(
        model, X_scaled[evaluation_idx], y[evaluation_idx], config,
    )
    metrics["evaluation_split"] = "validation" if len(val_idx) > 0 else "train"
    metrics["n_train"] = int(len(train_idx))
    metrics["n_validation"] = int(len(val_idx))
    metrics["epochs_trained"] = len(train_losses)
    metrics["best_val_loss"] = float(best_val_loss) if best_val_loss != float("inf") else None
    metrics["final_train_loss"] = train_losses[-1] if train_losses else None
    metrics["n_samples"] = n_samples
    metrics["arch"] = config.arch
    metrics["optimizer"] = config.optimizer
    metrics["pos_weight"] = float(pw_tensor.item())

    model = model.cpu()

    logger.info("LSTM trained (%s): %d epochs, metrics=%s",
                config.arch, len(train_losses), metrics)

    return LSTMTrainingResult(
        model=model,
        scaler=scaler,
        metrics=metrics,
        train_losses=train_losses,
        val_losses=val_losses,
        n_samples=n_samples,
        config=config,
    )


def _compute_metrics(
    model: nn.Module,
    X_scaled: np.ndarray,
    y: np.ndarray,
    config: LSTMTrainConfig,
) -> dict:
    """Compute classification metrics on the full dataset.

    Phase 2 fix: the model now returns raw logits (no final Sigmoid), so we
    apply ``torch.sigmoid`` here before thresholding for accuracy/F1/AUC.
    """
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

    model.eval()
    with torch.no_grad():
        X_tensor = torch.FloatTensor(X_scaled).to(DEVICE)
        logits = model(X_tensor).cpu().numpy()
    # Map logits → probabilities for downstream metrics.
    proba = 1.0 / (1.0 + np.exp(-logits))

    preds = (proba >= 0.5).astype(int)

    metrics = {
        "accuracy": float(accuracy_score(y, preds)),
        "precision": float(precision_score(y, preds, zero_division=0)),
        "recall": float(recall_score(y, preds, zero_division=0)),
        "f1": float(f1_score(y, preds, zero_division=0)),
    }

    # AUC-ROC (requires both classes present)
    if len(np.unique(y)) > 1:
        try:
            metrics["auc_roc"] = float(roc_auc_score(y, proba))
        except ValueError:
            metrics["auc_roc"] = None
    else:
        metrics["auc_roc"] = None

    return metrics


# ── Persistence ────────────────────────────────────────────────────────────

def save_lstm(result: LSTMTrainingResult, model_path: Path, metrics_path: Path) -> None:
    """Save the trained LSTM model, scaler, and config."""
    import json

    save_config = {
        "seq_len": result.config.seq_len,
        "hidden_size": result.config.hidden_size,
        "num_layers": result.config.num_layers,
        "dropout": result.config.dropout,
        "arch": result.config.arch,
        "optimizer": result.config.optimizer,
        "random_seed": result.config.random_seed,
    }
    # Persist pos_weight so a reload+continue training works later.
    if result.config.pos_weight is not None:
        save_config["pos_weight"] = float(result.config.pos_weight)

    torch.save({
        "model_state_dict": result.model.state_dict(),
        "scaler": result.scaler,
        "config": save_config,
        "feature_columns": result.feature_columns,
        "n_samples": result.n_samples,
        "model_type": "lstm",
    }, model_path)
    logger.info("LSTM model saved to %s", model_path)

    with open(metrics_path, "w") as f:
        json.dump(result.metrics, f, indent=2)
    logger.info("LSTM metrics saved to %s", metrics_path)


def load_lstm(model_path: Path) -> dict | None:
    """Load a saved LSTM bundle. Returns None if file doesn't exist."""
    if not model_path.exists():
        logger.warning("LSTM model not found at %s", model_path)
        return None

    try:
        bundle = torch.load(model_path, map_location="cpu", weights_only=False)

        # Rebuild the model
        config = bundle["config"]
        n_features = len(bundle.get("feature_columns", FEATURE_COLUMNS))

        if config.get("arch", "lstm") == "gru":
            model = GRUPredictor(
                input_size=n_features,
                hidden_size=config["hidden_size"],
                num_layers=config["num_layers"],
                dropout=config.get("dropout", 0.3),
            )
        else:
            model = LSTMPredictor(
                input_size=n_features,
                hidden_size=config["hidden_size"],
                num_layers=config["num_layers"],
                dropout=config.get("dropout", 0.3),
            )

        model.load_state_dict(bundle["model_state_dict"])
        model.eval()

        result = {
            "model": model,
            "scaler": bundle["scaler"],
            "config": config,
            "feature_columns": bundle.get("feature_columns", list(FEATURE_COLUMNS)),
            "n_samples": bundle.get("n_samples", 0),
            "model_type": "lstm",
        }

        logger.info("LSTM model loaded from %s (%d samples)",
                     model_path, result["n_samples"])
        return result

    except Exception as exc:
        logger.error("Failed to load LSTM model: %s", exc)
        return None


# ── Inference ──────────────────────────────────────────────────────────────

def predict_proba_lstm(bundle: dict, X_seq: np.ndarray) -> np.ndarray:
    """
    Return P(no-go) for each sequence in X_seq.

    Phase 2 fix: the model now outputs raw logits (no final Sigmoid), so
    this function applies ``torch.sigmoid`` at inference time to return
    a proper probability in [0, 1].

    Args:
        bundle: loaded model bundle from load_lstm()
        X_seq: shape (n_samples, seq_len, n_features) or (seq_len, n_features) for single

    Returns:
        np.ndarray of probabilities, shape (n_samples,)
    """
    model = bundle["model"]
    scaler = bundle["scaler"]

    if X_seq.ndim == 2:
        X_seq = X_seq[np.newaxis, ...]  # add batch dimension

    n_features = X_seq.shape[2]
    original_shape = X_seq.shape
    X_flat = X_seq.reshape(-1, n_features)
    X_scaled = scaler.transform(X_flat).reshape(original_shape)

    model.eval()
    with torch.no_grad():
        X_tensor = torch.FloatTensor(X_scaled)
        logits = model(X_tensor)
        proba = torch.sigmoid(logits).numpy()

    return proba


def predict_proba_lstm_batch(bundle: dict, X_seq: np.ndarray) -> np.ndarray:
    """Convenience alias for ``predict_proba_lstm`` — emphasises batched inference.

    Phase 4 surfaces this so the services layer can call it explicitly when
    it has already built a full ``(n_hours, seq_len, n_features)`` array via
    ``build_sequences_for_window``. Identical behaviour; clearer intent.
    """
    return predict_proba_lstm(bundle, X_seq)
