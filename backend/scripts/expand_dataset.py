"""
scripts/expand_dataset.py — Pull 90-day historical weather + generate synthetic labels.

This is critical for training the LSTM with sufficient data.
1. Pull 90 days of historical hourly weather from Open-Meteo Archive
2. Insert into weather_obs table
3. For each historical day, run rule-based scoring to generate synthetic labels
4. Insert synthetic labels into no_dive_labels with source="synthetic_rule"

Usage:
    python -m scripts.expand_dataset
    python -m scripts.expand_dataset --days 60
"""

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import db as _db_mod
from app.lib.db import init_db
from app.lib.ingest import ingest_archive
from app.lib.sites import get_all_sites
from app.lib.features import build_features, FEATURE_COLUMNS
from app.lib.scoring import score_hour, risk_label, label_to_binary, features_dict_from_row


def main():
    parser = argparse.ArgumentParser(description="Expand training dataset with historical data")
    parser.add_argument("--days", type=int, default=90, help="Days of history to pull (default: 90)")
    args = parser.parse_args()

    init_db()

    today = date.today()
    start = today - timedelta(days=args.days)
    end = today - timedelta(days=1)

    start_str = start.isoformat()
    end_str = end.isoformat()

    print(f"Expanding dataset: {args.days} days [{start_str} -> {end_str}]")

    total_weather = 0
    total_labels = 0
    total_skipped = 0

    for site in get_all_sites():
        site_key = site["key"]
        print(f"\n-- {site['name']} ({site_key}) --")

        # Step 1: Pull historical weather
        print(f"  Fetching archive weather [{start_str} -> {end_str}]...")
        result = ingest_archive(site_key, start_str, end_str)
        weather_count = result["weather_rows"]
        total_weather += weather_count
        print(f"  Ingested {weather_count} weather rows")

        # Step 2: Generate synthetic labels for each day
        print(f"  Generating synthetic labels...")
        db = _db_mod.SessionLocal()
        labels_created = 0
        labels_skipped = 0

        try:
            current = start
            while current <= end:
                # Check if we already have a label for this day
                existing = (
                    db.query(_db_mod.NoDiveLabel)
                    .filter(
                        _db_mod.NoDiveLabel.site_key == site_key,
                        _db_mod.NoDiveLabel.date == current,
                    )
                    .first()
                )
                if existing:
                    labels_skipped += 1
                    current += timedelta(days=1)
                    continue

                # Build features for noon UTC on this day
                target_ts = datetime(current.year, current.month, current.day, 12, 0, 0, tzinfo=timezone.utc)

                try:
                    feat_df = build_features(site_key, target_ts)
                    feat_dict = dict(zip(FEATURE_COLUMNS, feat_df.values[0]))
                    viz, curr = score_hour(feat_dict)
                    rl = risk_label(viz, curr)

                    # Convert risk to label
                    if rl == "HIGH RISK":
                        label = "no_dive"
                        viz_estimate = 3.0
                    elif rl == "MODERATE":
                        label = "poor_viz"
                        viz_estimate = 8.0
                    else:
                        label = "dive"
                        viz_estimate = 15.0

                    synthetic_label = _db_mod.NoDiveLabel(
                        site_key=site_key,
                        date=current,
                        label=label,
                        source="synthetic_rule",
                        actual_viz_m=viz_estimate,
                        actual_current=curr,
                        comments=f"Synthetic: viz={viz}, current={curr}, risk={rl}",
                    )
                    db.add(synthetic_label)
                    labels_created += 1

                except Exception as exc:
                    # Skip days with insufficient weather data
                    labels_skipped += 1

                current += timedelta(days=1)

            db.commit()
            total_labels += labels_created
            total_skipped += labels_skipped
            print(f"  Created {labels_created} synthetic labels ({labels_skipped} skipped)")

        except Exception as exc:
            db.rollback()
            print(f"  ERROR: {exc}")
        finally:
            db.close()

    # Summary
    db = _db_mod.SessionLocal()
    try:
        real_count = db.query(_db_mod.NoDiveLabel).filter(_db_mod.NoDiveLabel.source != "synthetic_rule").count()
        synthetic_count = db.query(_db_mod.NoDiveLabel).filter(_db_mod.NoDiveLabel.source == "synthetic_rule").count()
        total_count = db.query(_db_mod.NoDiveLabel).count()
    finally:
        db.close()

    print(f"\n{'='*50}")
    print(f"Dataset expansion complete!")
    print(f"  Weather rows ingested: {total_weather}")
    print(f"  Synthetic labels created: {total_labels}")
    print(f"  Total dataset: {real_count} real + {synthetic_count} synthetic = {total_count} labels")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
