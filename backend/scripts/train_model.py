"""
scripts/train_model.py — Train LSTM + XGBoost on current labels.

Usage:
    python -m scripts.train_model
    python -m scripts.train_model --lstm-only
    python -m scripts.train_model --xgb-only
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import db as _db_mod
from app.lib.db import init_db
from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence
from app.lib.scoring import label_to_binary
from app.lib.sites import get_all_sites


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LSTM_MODEL_PATH = DATA_DIR / "seasid_lstm.pt"
XGB_MODEL_PATH = DATA_DIR / "seasid_xgb.pkl"
METRICS_PATH = DATA_DIR / "seasid_metrics.json"


def _load_training_data() -> tuple[pd.DataFrame, pd.Series, np.ndarray, np.ndarray]:
    """
    Load labels from DB and build feature matrices for both XGBoost and LSTM.

    Returns:
        X_flat: (n_samples, 11) DataFrame for XGBoost
        y: (n_samples,) Series of binary labels
        X_seq: (n_samples, seq_len, 11) ndarray for LSTM
        y_arr: (n_samples,) ndarray of binary labels
    """
    db = _db_mod.SessionLocal()
    try:
        labels = db.query(_db_mod.NoDiveLabel).all()
    finally:
        db.close()

    if not labels:
        print("ERROR: No labels in database. Run seed_history.py first.")
        sys.exit(1)

    print(f"Found {len(labels)} labels in database")

    X_rows = []
    y_vals = []
    X_seqs = []
    skipped = 0

    for lbl in labels:
        target_ts = datetime(
            lbl.date.year, lbl.date.month, lbl.date.day,
            12, 0, 0, tzinfo=timezone.utc,
        )

        try:
            # Flat features for XGBoost
            feat_df = build_features(lbl.site_key, target_ts)
            X_rows.append(feat_df.values[0])

            # Sequence for LSTM
            seq = build_sequence(lbl.site_key, target_ts, window_hours=24)
            X_seqs.append(seq)

            # Binary label
            y_vals.append(label_to_binary(lbl.label))
        except Exception as exc:
            skipped += 1
            continue

    if skipped > 0:
        print(f"Skipped {skipped} labels due to insufficient weather data")

    X_flat = pd.DataFrame(X_rows, columns=FEATURE_COLUMNS)
    y = pd.Series(y_vals, name="label")
    X_seq = np.array(X_seqs, dtype=np.float32)
    y_arr = np.array(y_vals, dtype=np.float32)

    print(f"Training data: {len(X_flat)} samples, {int(y.sum())} positive (no-go), "
          f"{int(len(y) - y.sum())} negative (go)")

    return X_flat, y, X_seq, y_arr


def train_xgboost(X: pd.DataFrame, y: pd.Series) -> dict:
    """Train XGBoost baseline."""
    from app.lib.model_xgb import train_xgb, save_xgb

    print("\n-- Training XGBoost (Baseline 2) --")
    result = train_xgb(X, y)
    save_xgb(result, XGB_MODEL_PATH, DATA_DIR / "xgb_metrics.json")

    print(f"  Samples: {result.n_samples}")
    for k, v in result.metrics.items():
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")
        else:
            print(f"  {k}: {v}")

    return result.metrics


def train_lstm_model(X_seq: np.ndarray, y: np.ndarray) -> dict:
    """Train LSTM primary model."""
    from app.lib.model_lstm import train_lstm, save_lstm, LSTMTrainConfig

    print("\n-- Training LSTM (Primary) --")
    config = LSTMTrainConfig(
        seq_len=24,
        hidden_size=64,
        num_layers=2,
        dropout=0.3,
        lr=1e-3,
        batch_size=32,
        max_epochs=100,
        patience=10,
    )
    result = train_lstm(X_seq, y, config)
    save_lstm(result, LSTM_MODEL_PATH, DATA_DIR / "lstm_metrics.json")

    print(f"  Samples: {result.n_samples}")
    print(f"  Epochs trained: {len(result.train_losses)}")
    for k, v in result.metrics.items():
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")
        else:
            print(f"  {k}: {v}")

    return result.metrics


def main():
    parser = argparse.ArgumentParser(description="Train SeaSID models")
    parser.add_argument("--lstm-only", action="store_true", help="Train LSTM only")
    parser.add_argument("--xgb-only", action="store_true", help="Train XGBoost only")
    args = parser.parse_args()

    init_db()
    X_flat, y, X_seq, y_arr = _load_training_data()

    all_metrics = {}

    if not args.lstm_only:
        xgb_metrics = train_xgboost(X_flat, y)
        all_metrics["xgboost"] = xgb_metrics

    if not args.xgb_only:
        lstm_metrics = train_lstm_model(X_seq, y_arr)
        all_metrics["lstm"] = lstm_metrics

    # Save combined metrics
    with open(METRICS_PATH, "w") as f:
        json.dump(all_metrics, f, indent=2)
    print(f"\nCombined metrics saved to {METRICS_PATH}")

    # Summary
    print("\n" + "=" * 50)
    print("Training complete!")
    if "xgboost" in all_metrics:
        cv_acc = all_metrics["xgboost"].get("cv_accuracy", "N/A")
        print(f"  XGBoost CV accuracy: {cv_acc}")
    if "lstm" in all_metrics:
        f1 = all_metrics["lstm"].get("f1", "N/A")
        print(f"  LSTM F1: {f1}")
    print("=" * 50)


if __name__ == "__main__":
    main()
