"""
Experimental evaluation framework for SeaSID.

Systematic comparison of all models with proper methodology.
Generates metrics, plots, and ablation results.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix,
    roc_curve,
)
from sklearn.model_selection import train_test_split

from app.lib.features import FEATURE_COLUMNS
from app.lib.scoring import score_hour, risk_label, label_to_binary, features_dict_from_row

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
FIGURES_DIR = DATA_DIR / "figures"
RESULTS_PATH = DATA_DIR / "experiment_results.json"

METRICS_LIST = ["accuracy", "precision", "recall", "f1", "auc_roc"]


def run_full_experiment_suite(
    X_flat: pd.DataFrame,
    y: pd.Series,
    X_seq: np.ndarray,
    y_arr: np.ndarray,
) -> dict:
    """
    Run the complete experiment suite:
    1. Split data (70/15/15, stratified, fixed seed=42)
    2. Train all models on training set
    3. Evaluate all models on test set
    4. Run ablation studies
    5. Generate plots
    6. Save results
    """
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)

    n_total = len(X_flat)
    n_real = int((y >= 0).sum())  # all are valid labels

    print(f"Running experiments on {n_total} samples...")

    # ── 1. Split data ──────────────────────────────────────────────────
    # First split: 70% train, 30% temp
    X_train_f, X_temp_f, y_train, y_temp = train_test_split(
        X_flat, y, test_size=0.30, random_state=42, stratify=y,
    )
    # Second split: 50/50 of temp → 15% val, 15% test
    X_val_f, X_test_f, y_val, y_test = train_test_split(
        X_temp_f, y_temp, test_size=0.50, random_state=42, stratify=y_temp,
    )

    # Same splits for sequences
    train_idx = X_train_f.index.values
    val_idx = X_val_f.index.values
    test_idx = X_test_f.index.values

    X_train_seq = X_seq[train_idx]
    X_val_seq = X_seq[val_idx]
    X_test_seq = X_seq[test_idx]
    y_train_arr = y_arr[train_idx]
    y_val_arr = y_arr[val_idx]
    y_test_arr = y_arr[test_idx]

    dataset_summary = {
        "total_samples": n_total,
        "train_size": len(X_train_f),
        "val_size": len(X_val_f),
        "test_size": len(X_test_f),
        "positive_ratio": float(y.mean()),
    }

    print(f"  Train: {len(X_train_f)}, Val: {len(X_val_f)}, Test: {len(X_test_f)}")

    # ── 2. Train and evaluate models ───────────────────────────────────
    model_results = {}

    # Baseline 1: Rule-based
    print("\n  Evaluating: Rule-based (Baseline 1)...")
    rule_metrics = _evaluate_rule_based(X_test_f, y_test)
    model_results["rule"] = rule_metrics
    print(f"    F1: {rule_metrics.get('f1', 'N/A'):.4f}")

    # Baseline 2: XGBoost
    print("  Training: XGBoost (Baseline 2)...")
    xgb_metrics = _train_and_evaluate_xgb(X_train_f, y_train, X_test_f, y_test)
    model_results["xgb"] = xgb_metrics
    print(f"    F1: {xgb_metrics.get('f1', 'N/A'):.4f}")

    # Primary: LSTM
    print("  Training: LSTM (Primary)...")
    lstm_metrics = _train_and_evaluate_lstm(
        X_train_seq, y_train_arr, X_test_seq, y_test_arr, arch="lstm",
    )
    model_results["lstm"] = lstm_metrics
    print(f"    F1: {lstm_metrics.get('f1', 'N/A'):.4f}")

    # Ablation: GRU
    print("  Training: GRU (Ablation)...")
    gru_metrics = _train_and_evaluate_lstm(
        X_train_seq, y_train_arr, X_test_seq, y_test_arr, arch="gru",
    )
    model_results["gru"] = gru_metrics
    print(f"    F1: {gru_metrics.get('f1', 'N/A'):.4f}")

    # ── 3. Ablation studies ────────────────────────────────────────────
    print("\n  Running ablation studies...")
    ablations = _run_ablations(X_train_seq, y_train_arr, X_test_seq, y_test_arr)

    # ── 4. Find best model ─────────────────────────────────────────────
    best_model = max(model_results, key=lambda k: model_results[k].get("f1", 0))

    # ── 5. Generate plots ──────────────────────────────────────────────
    print("  Generating plots...")
    _generate_plots(model_results, ablations)

    # ── 6. Assemble results ────────────────────────────────────────────
    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset_summary,
        "model_comparison": model_results,
        "ablations": ablations,
        "best_model": best_model,
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n  Results saved to {RESULTS_PATH}")
    print(f"  Best model: {best_model} (F1: {model_results[best_model].get('f1', 'N/A'):.4f})")

    return results


# ── Model-specific evaluation ──────────────────────────────────────────────

def _evaluate_rule_based(X_test: pd.DataFrame, y_test: pd.Series) -> dict:
    """Evaluate rule-based scoring on test set."""
    preds = []
    for _, row in X_test.iterrows():
        feat_dict = dict(zip(FEATURE_COLUMNS, row.values))
        viz, curr = score_hour(feat_dict)
        rl = risk_label(viz, curr)
        pred = 1 if rl in ("HIGH RISK", "MODERATE") else 0
        preds.append(pred)

    preds = np.array(preds)
    y_true = y_test.values

    return _compute_classification_metrics(y_true, preds, proba=None)


def _train_and_evaluate_xgb(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> dict:
    """Train XGBoost on training set and evaluate on test set."""
    from app.lib.model_xgb import train_xgb, predict_proba_xgb

    result = train_xgb(X_train, y_train)
    bundle = {"model": result.model, "feature_columns": result.feature_columns}

    proba = predict_proba_xgb(bundle, X_test).values
    preds = (proba >= 0.5).astype(int)

    metrics = _compute_classification_metrics(y_test.values, preds, proba)
    metrics["train_metrics"] = result.metrics
    return metrics


def _train_and_evaluate_lstm(
    X_train_seq: np.ndarray,
    y_train: np.ndarray,
    X_test_seq: np.ndarray,
    y_test: np.ndarray,
    arch: str = "lstm",
) -> dict:
    """Train LSTM/GRU on training set and evaluate on test set."""
    from app.lib.model_lstm import train_lstm, predict_proba_lstm, LSTMTrainConfig

    config = LSTMTrainConfig(
        seq_len=X_train_seq.shape[1],
        hidden_size=64,
        num_layers=2,
        dropout=0.3,
        lr=1e-3,
        batch_size=32,
        max_epochs=100,
        patience=10,
        arch=arch,
    )

    result = train_lstm(X_train_seq, y_train, config)
    bundle = {
        "model": result.model,
        "scaler": result.scaler,
        "config": {"seq_len": config.seq_len},
    }

    proba = predict_proba_lstm(bundle, X_test_seq)
    preds = (proba >= 0.5).astype(int)

    metrics = _compute_classification_metrics(y_test, preds, proba)
    metrics["epochs_trained"] = len(result.train_losses)
    metrics["train_losses"] = result.train_losses
    metrics["val_losses"] = result.val_losses
    return metrics


def _compute_classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    proba: np.ndarray | None = None,
) -> dict:
    """Compute standard classification metrics."""
    metrics = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }

    if proba is not None and len(np.unique(y_true)) > 1:
        try:
            metrics["auc_roc"] = float(roc_auc_score(y_true, proba))
        except ValueError:
            metrics["auc_roc"] = None
    else:
        metrics["auc_roc"] = None

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred)
    metrics["confusion_matrix"] = cm.tolist()

    return metrics


# ── Ablation studies ───────────────────────────────────────────────────────

def _run_ablations(
    X_train_seq: np.ndarray,
    y_train: np.ndarray,
    X_test_seq: np.ndarray,
    y_test: np.ndarray,
) -> dict:
    """Run ablation studies varying one parameter at a time."""
    from app.lib.model_lstm import train_lstm, predict_proba_lstm, LSTMTrainConfig

    ablations = {}

    # Ablation 1: Sequence length (12, 24, 48)
    print("    Ablation: sequence length...")
    seq_len_results = {}
    for sl in [12, 24]:
        # Truncate or pad sequences
        actual_sl = min(sl, X_train_seq.shape[1])
        X_tr = X_train_seq[:, -actual_sl:, :]
        X_te = X_test_seq[:, -actual_sl:, :]

        config = LSTMTrainConfig(seq_len=actual_sl, max_epochs=50, patience=5)
        try:
            result = train_lstm(X_tr, y_train, config)
            bundle = {"model": result.model, "scaler": result.scaler, "config": {"seq_len": actual_sl}}
            proba = predict_proba_lstm(bundle, X_te)
            preds = (proba >= 0.5).astype(int)
            metrics = _compute_classification_metrics(y_test, preds, proba)
            seq_len_results[str(sl)] = {"f1": metrics["f1"], "accuracy": metrics["accuracy"]}
        except Exception as exc:
            logger.warning("Ablation seq_len=%d failed: %s", sl, exc)
            seq_len_results[str(sl)] = {"f1": 0.0, "accuracy": 0.0, "error": str(exc)}

    ablations["seq_len"] = seq_len_results

    # Ablation 2: Hidden size (32, 64, 128)
    print("    Ablation: hidden size...")
    hidden_results = {}
    for hs in [32, 64]:
        config = LSTMTrainConfig(hidden_size=hs, max_epochs=50, patience=5)
        try:
            result = train_lstm(X_train_seq, y_train, config)
            bundle = {"model": result.model, "scaler": result.scaler, "config": {"seq_len": config.seq_len}}
            proba = predict_proba_lstm(bundle, X_test_seq)
            preds = (proba >= 0.5).astype(int)
            metrics = _compute_classification_metrics(y_test, preds, proba)
            hidden_results[str(hs)] = {"f1": metrics["f1"], "accuracy": metrics["accuracy"]}
        except Exception as exc:
            logger.warning("Ablation hidden_size=%d failed: %s", hs, exc)
            hidden_results[str(hs)] = {"f1": 0.0, "accuracy": 0.0, "error": str(exc)}

    ablations["hidden_size"] = hidden_results

    # Ablation 3: Feature subsets (all 11, weather-only 7)
    print("    Ablation: feature subsets...")
    feature_results = {}

    # Weather-only: first 7 features (exclude tide + is_muck)
    weather_only = X_train_seq[:, :, :7]
    weather_test = X_test_seq[:, :, :7]
    config = LSTMTrainConfig(max_epochs=50, patience=5)
    try:
        result = train_lstm(weather_only, y_train, config)
        bundle = {"model": result.model, "scaler": result.scaler, "config": {"seq_len": config.seq_len}}
        proba = predict_proba_lstm(bundle, weather_test)
        preds = (proba >= 0.5).astype(int)
        metrics = _compute_classification_metrics(y_test, preds, proba)
        feature_results["weather_only_7"] = {"f1": metrics["f1"], "accuracy": metrics["accuracy"]}
    except Exception as exc:
        feature_results["weather_only_7"] = {"f1": 0.0, "error": str(exc)}

    # NOTE: previously this ablation called `train_lstm(...)` twice — once
    # for `.model` and once for `.scaler` — wasting compute and risking
    # subtle inconsistencies if the two trains diverged. The single train
    # below keeps the model + scaler from one fitted artifact.
    all_11_config = LSTMTrainConfig(max_epochs=50, patience=5)
    try:
        all_11_result = train_lstm(X_train_seq, y_train, all_11_config)
        all_11_bundle = {
            "model": all_11_result.model,
            "scaler": all_11_result.scaler,
            "config": {"seq_len": all_11_config.seq_len},
        }
        all_11_proba = predict_proba_lstm(all_11_bundle, X_test_seq)
        all_11_preds = (all_11_proba >= 0.5).astype(int)
        all_11_metrics = _compute_classification_metrics(y_test, all_11_preds, all_11_proba)
        feature_results["all_11"] = {
            "f1": all_11_metrics["f1"],
            "accuracy": all_11_metrics["accuracy"],
        }
    except Exception as exc:
        logger.warning("Ablation all_11 failed: %s", exc)
        feature_results["all_11"] = {"f1": 0.0, "accuracy": 0.0, "error": str(exc)}

    ablations["feature_subsets"] = feature_results

    return ablations


# ── Plot generation ────────────────────────────────────────────────────────

def _generate_plots(model_results: dict, ablations: dict) -> None:
    """Generate experiment visualization plots."""
    try:
        import matplotlib
        matplotlib.use("Agg")  # non-interactive backend
        import matplotlib.pyplot as plt
        import seaborn as sns
    except ImportError:
        logger.warning("matplotlib/seaborn not available — skipping plots")
        return

    # 1. Model comparison bar chart
    _plot_model_comparison(model_results, plt)

    # 2. Loss curves (LSTM)
    _plot_loss_curves(model_results, plt)

    # 3. Confusion matrices
    _plot_confusion_matrices(model_results, plt, sns)

    plt.close("all")


def _plot_model_comparison(results: dict, plt) -> None:
    """Bar chart comparing all models across metrics."""
    models = list(results.keys())
    metrics = ["accuracy", "precision", "recall", "f1"]

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(metrics))
    width = 0.2

    for i, model in enumerate(models):
        vals = [results[model].get(m, 0) or 0 for m in metrics]
        ax.bar(x + i * width, vals, width, label=model.upper())

    ax.set_xlabel("Metric")
    ax.set_ylabel("Score")
    ax.set_title("Model Comparison")
    ax.set_xticks(x + width * (len(models) - 1) / 2)
    ax.set_xticklabels([m.capitalize() for m in metrics])
    ax.legend()
    ax.set_ylim(0, 1)

    fig.savefig(FIGURES_DIR / "model_comparison.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    logger.info("Saved model_comparison.png")


def _plot_loss_curves(results: dict, plt) -> None:
    """Plot LSTM/GRU training and validation loss curves."""
    fig, ax = plt.subplots(figsize=(10, 6))
    has_data = False

    for model_name in ["lstm", "gru"]:
        if model_name in results:
            train_losses = results[model_name].get("train_losses", [])
            val_losses = results[model_name].get("val_losses", [])

            if train_losses:
                ax.plot(train_losses, label=f"{model_name.upper()} Train", linestyle="-")
                has_data = True
            if val_losses:
                ax.plot(val_losses, label=f"{model_name.upper()} Val", linestyle="--")

    if has_data:
        ax.set_xlabel("Epoch")
        ax.set_ylabel("Loss (BCE)")
        ax.set_title("Training & Validation Loss Curves")
        ax.legend()
        fig.savefig(FIGURES_DIR / "loss_curves.png", dpi=150, bbox_inches="tight")
        logger.info("Saved loss_curves.png")

    plt.close(fig)


def _plot_confusion_matrices(results: dict, plt, sns) -> None:
    """Plot confusion matrix for each model."""
    for model_name, metrics in results.items():
        cm = metrics.get("confusion_matrix")
        if cm is None:
            continue

        fig, ax = plt.subplots(figsize=(6, 5))
        sns.heatmap(
            np.array(cm),
            annot=True,
            fmt="d",
            cmap="Blues",
            xticklabels=["Go (Dive)", "No-Go"],
            yticklabels=["Go (Dive)", "No-Go"],
            ax=ax,
        )
        ax.set_xlabel("Predicted")
        ax.set_ylabel("Actual")
        ax.set_title(f"Confusion Matrix — {model_name.upper()}")

        fig.savefig(FIGURES_DIR / f"confusion_{model_name}.png", dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("Saved confusion_%s.png", model_name)
