"""Validate immutable raw API responses and create a versioned clean CSV."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.lib.ml_pipeline import load_config


FIELD_MAP = {
    "temperature_2m": "air_temp_c",
    "relative_humidity_2m": "humidity_pct",
    "precipitation": "precip_mm",
    "wind_speed_10m": "wind_mean_kmh",
    "wind_gusts_10m": "wind_max_kmh",
    "surface_pressure": "surface_pressure_hpa",
}
RANGES = {
    "air_temp_c": (-20, 55),
    "humidity_pct": (0, 100),
    "precip_mm": (0, 500),
    "wind_mean_kmh": (0, 250),
    "wind_max_kmh": (0, 350),
    "surface_pressure_hpa": (700, 1100),
}


def clean(config: dict) -> tuple[Path, dict]:
    raw_dir = Path(config["paths"]["raw_dir"]) / "open_meteo_archive"
    output_dir = Path(config["paths"]["processed_dir"])
    report_dir = Path(config["paths"]["report_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    rejected_files = []
    for path in sorted(raw_dir.glob("*/*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            metadata, response = payload["metadata"], payload["response"]
            hourly = response["hourly"]
            count = len(hourly["time"])
            for index in range(count):
                row = {
                    "site_key": metadata["site_key"],
                    "ts": hourly["time"][index],
                    "source": metadata["provider"],
                    "raw_file": str(path.relative_to(raw_dir)),
                }
                for source, target in FIELD_MAP.items():
                    values = hourly.get(source, [])
                    row[target] = values[index] if index < len(values) else None
                rows.append(row)
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
            rejected_files.append({"file": str(path), "error": str(exc)})

    frame = pd.DataFrame(rows)
    original_rows = len(frame)
    if frame.empty:
        raise ValueError(f"No raw records found under {raw_dir}")
    frame["ts"] = pd.to_datetime(frame["ts"], errors="coerce", utc=True)
    for column in RANGES:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    invalid = frame["ts"].isna() | (frame["ts"] > pd.Timestamp.now(tz="UTC"))
    invalid |= frame[["precip_mm", "wind_mean_kmh", "wind_max_kmh"]].isna().any(axis=1)
    for column, (low, high) in RANGES.items():
        invalid |= frame[column].notna() & ~frame[column].between(low, high)
    rejected_rows = int(invalid.sum())
    frame = frame[~invalid].copy()
    duplicate_count = int(frame.duplicated(["site_key", "ts"], keep="last").sum())
    frame = frame.drop_duplicates(["site_key", "ts"], keep="last").sort_values(["site_key", "ts"])
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = output_dir / f"weather_clean_{timestamp}.csv"
    frame.to_csv(output, index=False, date_format="%Y-%m-%dT%H:%M:%SZ", na_rep="")
    report = {
        "original_row_count": original_rows,
        "new_row_count": original_rows,
        "duplicate_count": duplicate_count,
        "missing_value_count": {key: int(value) for key, value in frame.isna().sum().items()},
        "rejected_row_count": rejected_rows,
        "rejected_file_count": len(rejected_files),
        "rejected_files": rejected_files,
        "final_row_count": int(len(frame)),
        "output": str(output),
    }
    (report_dir / f"cleaning_{timestamp}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return output, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    config = load_config(args.config) if args.config else load_config()
    _, report = clean(config)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
