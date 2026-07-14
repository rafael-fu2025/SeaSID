"""Audit SeaSID's SQLite training data and CSV inputs without modifying them.

Usage:
    python -m scripts.audit_training_data
    python -m scripts.audit_training_data --output data/quality/audit.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

import pandas as pd


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB = BACKEND_DIR / "data" / "seasid.db"


def _rows(connection: sqlite3.Connection, sql: str) -> list[dict]:
    return [dict(row) for row in connection.execute(sql).fetchall()]


def audit_database(db_path: Path) -> dict:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        labels = pd.read_sql_query("SELECT * FROM no_dive_labels", connection)
        report = {
            "database": str(db_path),
            "labels": {
                "row_count": int(len(labels)),
                "date_min": None if labels.empty else str(labels["date"].min()),
                "date_max": None if labels.empty else str(labels["date"].max()),
                "duplicate_site_date_source": int(
                    labels.duplicated(["site_key", "date", "source"]).sum()
                ) if not labels.empty else 0,
                "duplicate_site_date": int(
                    labels.duplicated(["site_key", "date"]).sum()
                ) if not labels.empty else 0,
                "missing_by_column": {
                    key: int(value) for key, value in labels.isna().sum().items()
                },
                "by_source_and_label": _rows(
                    connection,
                    """SELECT source, label, COUNT(*) AS rows
                       FROM no_dive_labels
                       GROUP BY source, label ORDER BY source, label""",
                ),
                "invalid_labels": _rows(
                    connection,
                    """SELECT label, COUNT(*) AS rows FROM no_dive_labels
                       WHERE label NOT IN ('dive', 'poor_viz', 'no_dive')
                       GROUP BY label""",
                ),
                "invalid_records": {
                    "invalid_date": int(pd.to_datetime(labels["date"], errors="coerce").isna().sum()),
                    "invalid_site": int((~labels["site_key"].isin(["dauin_muck", "apo_reef"])).sum()),
                    "invalid_visibility": int(
                        (labels["actual_viz_m"].notna() & ~labels["actual_viz_m"].between(0, 100)).sum()
                    ),
                    "invalid_current": int(
                        (labels["actual_current"].notna() & ~labels["actual_current"].isin(["Low", "Moderate", "High"])).sum()
                    ),
                    "invalid_confidence": int(
                        (labels["confidence"].notna() & ~labels["confidence"].isin(["low", "med", "high"])).sum()
                    ),
                },
            },
            "weather": _rows(
                connection,
                """SELECT site_key, COUNT(*) AS rows, COUNT(DISTINCT ts) AS unique_ts,
                          MIN(ts) AS min_ts, MAX(ts) AS max_ts,
                          SUM(precip_mm IS NULL) AS missing_precip,
                          SUM(wind_max_kmh IS NULL) AS missing_wind,
                          SUM(sea_temp_c IS NULL) AS missing_sea_temp,
                          MIN(precip_mm) AS min_precip, MAX(precip_mm) AS max_precip,
                          MIN(wind_max_kmh) AS min_wind, MAX(wind_max_kmh) AS max_wind
                          ,SUM(precip_mm < 0 OR precip_mm > 500) AS invalid_precip
                          ,SUM(wind_max_kmh < 0 OR wind_max_kmh > 350) AS invalid_wind
                   FROM weather_obs GROUP BY site_key""",
            ),
            "marine": _rows(
                connection,
                """SELECT site_key, COUNT(*) AS rows, COUNT(DISTINCT ts) AS unique_ts,
                          MIN(ts) AS min_ts, MAX(ts) AS max_ts,
                          SUM(wave_height_m IS NULL) AS missing_wave_height,
                          SUM(wave_period_s IS NULL) AS missing_wave_period,
                          SUM(current_speed_ms IS NULL) AS missing_current
                          ,SUM(wave_height_m < 0 OR wave_height_m > 30) AS invalid_wave_height
                          ,SUM(current_speed_ms < 0 OR current_speed_ms > 10) AS invalid_current
                   FROM marine_obs GROUP BY site_key""",
            ),
            "tides": _rows(
                connection,
                """SELECT site_key, COUNT(*) AS rows, COUNT(DISTINCT ts) AS unique_ts,
                          MIN(ts) AS min_ts, MAX(ts) AS max_ts,
                          SUM(height_m IS NULL) AS missing_height
                          ,SUM(height_m < -10 OR height_m > 10) AS invalid_height
                   FROM tide_obs GROUP BY site_key""",
            ),
        }
        return report
    finally:
        connection.close()


def audit_csvs(data_dir: Path) -> list[dict]:
    reports = []
    for path in sorted(data_dir.glob("*.csv")):
        frame = pd.read_csv(path)
        reports.append({
            "file": path.name,
            "rows": int(len(frame)),
            "columns": list(frame.columns),
            "duplicate_rows": int(frame.duplicated().sum()),
            "missing_cells": int(frame.isna().sum().sum()),
        })
    return reports


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = audit_database(args.db)
    report["csv_files"] = audit_csvs(args.db.parent)
    payload = json.dumps(report, indent=2, default=str)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
