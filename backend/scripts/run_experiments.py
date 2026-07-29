"""
scripts/run_experiments.py — Run the full experiment suite.

Usage:
    python -m scripts.run_experiments
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import db as _db_mod
from app.lib.db import init_db
from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence
from app.lib.scoring import label_to_binary
from app.lib.experiments import run_full_experiment_suite
from scripts.train_model import EXCLUDED_SOURCES_DEFAULT


def main():
    init_db()

    # Load labels, excluding the circular rule-generated sources so the
    # held-out metrics reflect real/threshold-grounded data (matches
    # scripts.train_model). See the "Accurate Dive Model Rebuild" plan.
    db = _db_mod.SessionLocal()
    try:
        labels = (
            db.query(_db_mod.NoDiveLabel)
            .filter(_db_mod.NoDiveLabel.source.notin_(EXCLUDED_SOURCES_DEFAULT))
            .all()
        )
    finally:
        db.close()

    if not labels:
        print("ERROR: No labels found. Run seed_history.py and expand_dataset.py first.")
        sys.exit(1)

    print(f"Excluding label sources: {', '.join(EXCLUDED_SOURCES_DEFAULT)}")
    print(f"Loading {len(labels)} labels...")

    X_rows = []
    y_vals = []
    X_seqs = []
    label_dates = []
    label_site_keys = []
    skipped = 0

    for lbl in labels:
        target_ts = datetime(
            lbl.date.year, lbl.date.month, lbl.date.day,
            12, 0, 0, tzinfo=timezone.utc,
        )
        try:
            feat_df = build_features(lbl.site_key, target_ts)
            X_rows.append(feat_df.values[0])

            seq = build_sequence(lbl.site_key, target_ts, window_hours=24)
            X_seqs.append(seq)

            y_vals.append(label_to_binary(lbl.label))
            label_dates.append(lbl.date)
            label_site_keys.append(lbl.site_key)
        except Exception:
            skipped += 1

    if skipped > 0:
        print(f"Skipped {skipped} labels with insufficient data")

    X_flat = pd.DataFrame(X_rows, columns=FEATURE_COLUMNS)
    y = pd.Series(y_vals, name="label")
    X_seq = np.array(X_seqs, dtype=np.float32)
    y_arr = np.array(y_vals, dtype=np.float32)

    print(f"Dataset ready: {len(X_flat)} samples")

    # Pass label_dates + site keys so the suite uses the time-aware blocked
    # split (70/15/15, purge_days=1) instead of the leaky random split.
    results = run_full_experiment_suite(
        X_flat, y, X_seq, y_arr,
        label_dates=label_dates,
        label_site_keys=label_site_keys,
    )

    # Print summary
    print("\n" + "=" * 60)
    print("EXPERIMENT RESULTS SUMMARY")
    print("=" * 60)

    comp = results.get("model_comparison", {})
    ds = results.get("dataset", {})
    print(f"\nSplit: {ds.get('split_method')}  "
          f"train={ds.get('train_size')} val={ds.get('val_size')} test={ds.get('test_size')}  "
          f"pos_ratio={ds.get('positive_ratio', 0):.3f}")
    b = ds.get("boundaries", {})
    if b.get("test"):
        print(f"  test window: {b['test'].get('start')} -> {b['test'].get('end')} "
              f"(n={b['test'].get('count')})")
    if ds.get("per_site"):
        print(f"  per-site test counts: {ds['per_site']}")
    print(f"\n{'Model':<10} {'Accuracy':>10} {'Precision':>10} {'Recall':>10} {'F1':>10} {'AUC-ROC':>10}")
    print("-" * 60)
    for model_name, metrics in comp.items():
        acc = f"{metrics.get('accuracy', 0):.4f}"
        prec = f"{metrics.get('precision', 0):.4f}"
        rec = f"{metrics.get('recall', 0):.4f}"
        f1 = f"{metrics.get('f1', 0):.4f}"
        auc = f"{metrics.get('auc_roc', 'N/A')}" if metrics.get("auc_roc") else "N/A"
        print(f"{model_name:<10} {acc:>10} {prec:>10} {rec:>10} {f1:>10} {auc:>10}")

    print(f"\nBest model: {results.get('best_model', 'N/A')}")
    print("=" * 60)


if __name__ == "__main__":
    main()
