"""Merge database labels with authorized label CSVs into a new versioned file."""
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.lib.ml_pipeline import load_config


COLUMNS = [
    "site_key", "date", "label", "source", "actual_viz_m",
    "actual_current", "no_go_reason", "confidence", "comments",
]
VALID_LABELS = {"dive", "poor_viz", "no_dive"}
VALID_CURRENTS = {"Low", "Moderate", "High"}
VALID_CONFIDENCE = {"low", "med", "high"}


def _standardize(frame: pd.DataFrame, default_source: str) -> tuple[pd.DataFrame, int]:
    work = frame.copy()
    for column in COLUMNS:
        if column not in work:
            work[column] = None
    work = work[COLUMNS]
    work["source"] = work["source"].fillna(default_source).astype(str).str.strip().str.lower()
    work["site_key"] = work["site_key"].astype(str).str.strip().str.lower()
    work["label"] = work["label"].astype(str).str.strip().str.lower()
    work["date"] = pd.to_datetime(work["date"], errors="coerce", utc=True)
    work["actual_viz_m"] = pd.to_numeric(work["actual_viz_m"], errors="coerce")
    work["actual_current"] = work["actual_current"].replace({"low": "Low", "moderate": "Moderate", "high": "High"})
    work["confidence"] = work["confidence"].fillna("low").astype(str).str.strip().str.lower()
    today = pd.Timestamp.now(tz="UTC").normalize()
    invalid = (
        work["date"].isna()
        | (work["date"] > today)
        | ~work["label"].isin(VALID_LABELS)
        | ~work["site_key"].isin({"dauin_muck", "apo_reef"})
        | (work["actual_viz_m"].notna() & ~work["actual_viz_m"].between(0, 100))
        | (work["actual_current"].notna() & ~work["actual_current"].isin(VALID_CURRENTS))
        | ~work["confidence"].isin(VALID_CONFIDENCE)
    )
    return work[~invalid].copy(), int(invalid.sum())


def merge(config: dict, additions: list[Path]) -> tuple[Path, dict]:
    db_path = Path(config["paths"]["database"])
    connection = sqlite3.connect(db_path)
    try:
        original = pd.read_sql_query(
            """SELECT site_key, date, label, source, actual_viz_m,
                      actual_current, no_go_reason, confidence, comments
               FROM no_dive_labels""",
            connection,
        )
    finally:
        connection.close()
    original_clean, rejected_original = _standardize(original, "database")
    new_frames = []
    rejected_new = 0
    for path in additions:
        frame, rejected = _standardize(pd.read_csv(path), f"authorized_{path.stem}")
        new_frames.append(frame)
        rejected_new += rejected
    new = pd.concat(new_frames, ignore_index=True) if new_frames else pd.DataFrame(columns=COLUMNS)
    combined = pd.concat([original_clean, new], ignore_index=True)
    combined["date"] = pd.to_datetime(combined["date"], errors="coerce", utc=True)
    # One verified outcome per site/day. Authorized additions are appended
    # after database rows, so a corrected authorized record wins in this new
    # versioned export without mutating the original database.
    duplicate_count = int(combined.duplicated(["site_key", "date"], keep="last").sum())
    combined = combined.drop_duplicates(["site_key", "date"], keep="last")
    combined = combined.sort_values(["date", "site_key", "source"])
    combined["date"] = combined["date"].dt.strftime("%Y-%m-%d")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(config["paths"]["processed_dir"])
    report_dir = Path(config["paths"]["report_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"labels_merged_{timestamp}.csv"
    combined.to_csv(output, index=False, na_rep="")
    report = {
        "original_row_count": int(len(original)),
        "new_row_count": int(sum(len(pd.read_csv(path)) for path in additions)),
        "duplicate_count": duplicate_count,
        "missing_value_count": {key: int(value) for key, value in combined.isna().sum().items()},
        "rejected_row_count": rejected_original + rejected_new,
        "final_row_count": int(len(combined)),
        "output": str(output),
    }
    (report_dir / f"merge_{timestamp}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return output, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--add", type=Path, action="append", default=[])
    args = parser.parse_args()
    config = load_config(args.config) if args.config else load_config()
    _, report = merge(config, args.add)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
