"""
scripts/seed_history.py — Load sample_no_dive_history.csv into the database.

Usage:
    python -m scripts.seed_history
"""

import csv
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import db as _db_mod
from app.lib.db import init_db


def main():
    csv_path = Path(__file__).resolve().parent.parent / "data" / "sample_no_dive_history.csv"

    if not csv_path.exists():
        print(f"ERROR: CSV not found at {csv_path}")
        sys.exit(1)

    # Ensure tables exist
    init_db()

    db = _db_mod.SessionLocal()
    inserted = 0
    skipped = 0

    try:
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Check for duplicate
                existing = (
                    db.query(_db_mod.NoDiveLabel)
                    .filter(
                        _db_mod.NoDiveLabel.site_key == row["site_key"],
                        _db_mod.NoDiveLabel.date == date.fromisoformat(row["date"]),
                        _db_mod.NoDiveLabel.source == row.get("source", "seed"),
                    )
                    .first()
                )

                if existing:
                    skipped += 1
                    continue

                label = _db_mod.NoDiveLabel(
                    site_key=row["site_key"],
                    date=date.fromisoformat(row["date"]),
                    label=row["label"],
                    source=row.get("source", "seed"),
                    actual_viz_m=float(row["actual_viz_m"]) if row.get("actual_viz_m") else None,
                    actual_current=row.get("actual_current"),
                    comments=row.get("comments"),
                )
                db.add(label)
                inserted += 1

        db.commit()
        print(f"Seeded {inserted} labels ({skipped} duplicates skipped)")

    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
