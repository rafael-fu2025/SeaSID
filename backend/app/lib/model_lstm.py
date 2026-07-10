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
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from app.lib.features import FEATURE_COLUMNS

logger = logging.getLogger(__name__)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ── Model architecture ────────────────────────────────────────────────────

class LSTMPredictor(nn.Module):
    """LSTM-based binary classifier for dive condition prediction."""

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
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass. x shape: (batch, seq_len, input_size)."""
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]  # take last timestep
        return self.classifier(last_hidden).squeeze(-1)


class GRUPredictor(nn.Module):
    """GRU variant for ablation comparison."""

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
            nn.Sigmoid(),
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
) -> LSTMTrainingResult:
    """
    Train an LSTM/GRU model on sequence data.

    Args:
        X_sequences: shape (n_samples, seq_len, n_features)
        y: shape (n_samples,) binary labels
        config: training hyperparameters

    Returns:
        LSTMTrainingResult with trained model, scaler, metrics, and loss history
    """
    if config is None:
        config = LSTMTrainConfig()

    n_samples = len(X_sequences)
    if n_samples == 0:
        raise ValueError("Cannot train on empty dataset")

    n_features = X_sequences.shape[2] if X_sequences.ndim == 3 else len(FEATURE_COLUMNS)

    # ── Normalize features ─────────────────────────────────────────────
    scaler = StandardScaler()
    original_shape = X_sequences.shape
    X_flat = X_sequences.reshape(-1, n_features)
    X_scaled = scaler.fit_transform(X_flat).reshape(original_shape)

    # ── Train/val split (85/15 of training data) ───────────────────────
    split_idx = max(1, int(n_samples * 0.85))
    indices = np.random.RandomState(42).permutation(n_samples)

    train_idx = indices[:split_idx]
    val_idx = indices[split_idx:]

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

    criterion = nn.BCELoss()
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=config.lr,
        weight_decay=config.weight_decay,
    )
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
    metrics = _compute_metrics(model, X_scaled, y, config)
    metrics["epochs_trained"] = len(train_losses)
    metrics["best_val_loss"] = float(best_val_loss) if best_val_loss != float("inf") else None
    metrics["final_train_loss"] = train_losses[-1] if train_losses else None
    metrics["n_samples"] = n_samples
    metrics["arch"] = config.arch

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
    """Compute classification metrics on the full dataset."""
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

    model.eval()
    with torch.no_grad():
        X_tensor = torch.FloatTensor(X_scaled).to(DEVICE)
        proba = model(X_tensor).cpu().numpy()

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

    torch.save({
        "model_state_dict": result.model.state_dict(),
        "scaler": result.scaler,
        "config": {
            "seq_len": result.config.seq_len,
            "hidden_size": result.config.hidden_size,
            "num_layers": result.config.num_layers,
            "dropout": result.config.dropout,
            "arch": result.config.arch,
        },
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
        proba = model(X_tensor).numpy()

    return proba
