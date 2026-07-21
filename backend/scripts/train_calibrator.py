"""
Phase 7 — train a probability calibrator on the time-aware holdout.

Workflow:

1. Pull all labels from the DB and split them chronologically:
   oldest 80% train (used by the underlying LSTM/XGB fit), newest 20%
   holdout (used here to fit the calibrator).
2. For each label in the holdout, recompute the rule-based ``P(no-go)``
   using the same feature pipeline production uses. This is the source
   probability that needs calibration — when the bundle is ``None`` the
   model path falls through to rules, so we always have a probability to
   calibrate.
3. Optionally re-train an LSTM on the train split and use its raw
   ``predict_proba_lstm`` output as the source probability instead — this
   exercises the full pipeline through the calibrator.
4. Fit ``Calibrator.auto`` on ``(p_raw, y)`` and persist to
   ``calibrator.pkl``. Print before/after Brier + ECE.

Usage::

    python -m scripts.train_calibrator                 # default: rules
    python -m scripts.train_calibrator --use-lstm      # re-train LSTM and calibrate its outputs
    python -m scripts.train_calibrator --json          # emit JSON for the phase report
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.metrics import brier_score_loss, roc_auc_score

# Ensure backend/ is on sys.path when run as a module
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.lib.calibration import Calibrator
from app.lib.db import init_db, SessionLocal, NoDiveLabel
from app.lib.features import build_features, build_sequences_for_window
from app.lib.model import CALIBRATOR_PATH
from app.lib.scoring import features_dict_from_row, p_bad_from_rules


def _load_holdout():
    """Return ``(y_true, dates)`` for the time-aware holdout (newest 20%)."""
    init_db()
    sess = SessionLocal()
    try:
        all_labels = sess.query(NoDiveLabel).all()
    finally:
        sess.close()
    sorted_labels = sorted(all_labels, key=lambda l: l.date)
    n = len(sorted_labels)
    split_idx = int(n * 0.80)
    holdout = sorted_labels[split_idx:]
    y = np.array([1 if l.label == "no_dive" else 0 for l in holdout], dtype=int)
    return holdout, y


def _rules_p(holdout):
    """Rule-based P(no-go) on the holdout — same path production uses."""
    p = []
    for l in holdout:
        ts = datetime.combine(l.date, datetime.min.time())
        feat_df = build_features(l.site_key, ts)
        feat_dict = features_dict_from_row(feat_df.values[0])
        p.append(p_bad_from_rules(feat_dict))
    return np.array(p, dtype=float)


def _lstm_p(holdout):
    """Re-train LSTM on the train split and predict on the holdout.

    Returns ``(p_raw, trained_metrics)``. If training fails, raises.
    """
    from app.lib.db import NoDiveLabel as _Lbl
    from app.lib.features import build_sequence, FEATURE_COLUMNS
    from app.lib.scoring import label_to_binary
    from app.lib.model_lstm import (
        LSTMTrainConfig, train_lstm, predict_proba_lstm_batch,
    )

    init_db()
    sess = SessionLocal()
    try:
        all_labels = sess.query(_Lbl).all()
    finally:
        sess.close()
    sorted_labels = sorted(all_labels, key=lambda l: l.date)
    n = len(sorted_labels)
    split_idx = int(n * 0.80)
    train_labels = sorted_labels[:split_idx]
    label_dates = [l.date for l in train_labels]

    # Build X_seq / y arrays for the train split
    X_rows = []
    X_seqs = []
    y_vals = []
    for lbl in train_labels:
        target_ts = datetime(
            lbl.date.year, lbl.date.month, lbl.date.day,
            12, 0, 0,
        )
        try:
            feat_df = build_features(lbl.site_key, target_ts)
            X_rows.append(feat_df.values[0])
            seq = build_sequence(lbl.site_key, target_ts, window_hours=24)
            X_seqs.append(seq)
            y_vals.append(label_to_binary(lbl.label))
        except Exception:
            continue

    if len(X_seqs) < 10:
        raise RuntimeError(f"only {len(X_seqs)} trainable LSTM samples (need >=10)")

    X_seq = np.array(X_seqs, dtype=np.float32)
    y_arr = np.array(y_vals, dtype=np.float32)
    print(f"  LSTM training: {len(X_seq)} samples, {int(y_arr.sum())} positive")

    result = train_lstm(
        X_seq, y_arr,
        LSTMTrainConfig(arch="lstm", max_epochs=30, patience=7),
        label_dates=label_dates[:len(X_seq)],
    )
    bundle = {
        "model": result.model,
        "scaler": result.scaler,
        "config": {"seq_len": result.config.seq_len},
        "model_type": "lstm",
        "n_samples": result.n_samples,
    }
    sites = [l.site_key for l in holdout]
    ts_list = [datetime.combine(l.date, datetime.min.time()) for l in holdout]

    # build_sequences_for_window is per-site — loop and concatenate.
    seqs = []
    site_to_indices: dict[str, list[int]] = {}
    for idx, sk in enumerate(sites):
        site_to_indices.setdefault(sk, []).append(idx)
    ordered_seqs = []
    for sk, indices in site_to_indices.items():
        site_ts = [ts_list[i] for i in indices]
        site_seqs = build_sequences_for_window(sk, site_ts)
        ordered_seqs.append(site_seqs)
    if ordered_seqs:
        seqs = np.concatenate(ordered_seqs, axis=0)
    else:
        seqs = np.zeros((0, 24, len(FEATURE_COLUMNS)), dtype=np.float32)
    p = np.array(predict_proba_lstm_batch(bundle, seqs), dtype=float)
    return p, result.metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--use-lstm", action="store_true",
        help="Re-train LSTM and calibrate its outputs (more expensive)",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit a single JSON line to stdout for the phase report",
    )
    args = parser.parse_args()

    holdout, y = _load_holdout()
    if len(holdout) == 0:
        print("ERROR: no labels in DB; cannot fit calibrator.", file=sys.stderr)
        sys.exit(1)

    print(f"holdout size: {len(holdout)}, positive_rate: {y.mean():.3f}")

    if args.use_lstm:
        print("Re-training LSTM on train split...")
        try:
            p_raw, trained_metrics = _lstm_p(holdout)
            source = "lstm"
        except Exception as exc:
            import traceback
            traceback.print_exc()
            print(f"\nLSTM training failed: {exc}\nFalling back to rules.", file=sys.stderr)
            p_raw = _rules_p(holdout)
            source = "rules_fallback"
            trained_metrics = None
    else:
        p_raw = _rules_p(holdout)
        source = "rules"
        trained_metrics = None

    # Raw metrics
    raw_auc = float(roc_auc_score(y, p_raw))
    raw_brier = float(brier_score_loss(y, np.clip(p_raw, 0, 1)))

    # Fit calibrator
    cal = Calibrator.auto(p_raw, y, min_isotonic_samples=100)

    # Calibrated metrics
    p_cal = np.array(cal.predict(p_raw))
    cal_auc = float(roc_auc_score(y, p_cal))
    cal_brier = float(brier_score_loss(y, np.clip(p_cal, 0, 1)))

    # Persist
    cal.save(CALIBRATOR_PATH)

    report = {
        "captured_at": datetime.now().isoformat(),
        "source": source,
        "n_holdout": len(holdout),
        "positive_rate": float(y.mean()),
        "raw": {
            "auc": raw_auc,
            "brier": raw_brier,
            "method": source,
            "ece": cal.metrics.ece_raw if cal.metrics else None,
        },
        "calibrated": {
            "auc": cal_auc,
            "brier": cal_brier,
            "method": cal.method,
            "n_fit": cal.n_fit,
            "ece": cal.metrics.ece_calibrated if cal.metrics else None,
            "version_string": cal.version_string(),
        },
        "improvement_brier": raw_brier - cal_brier,
    }
    if trained_metrics is not None:
        report["lstm_metrics"] = {
            "epochs_trained": trained_metrics.get("epochs_trained"),
            "best_val_loss": trained_metrics.get("best_val_loss"),
            "auc_roc": trained_metrics.get("auc_roc"),
        }

    if args.json:
        print(json.dumps(report))
    else:
        print(json.dumps(report, indent=2))
    print(f"\nCalibrator saved to {CALIBRATOR_PATH}")


if __name__ == "__main__":
    main()