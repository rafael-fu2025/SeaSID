"""Build leakage-safe flat training examples from labels and prior data."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.lib.ml_pipeline import (
    build_flat_examples,
    dataset_version,
    load_config,
    load_labels,
    promotion_eligibility,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--horizon", type=int)
    parser.add_argument("--include-synthetic", action="store_true")
    args = parser.parse_args()
    config = load_config(args.config) if args.config else load_config()
    horizon = args.horizon or int(config["dataset"]["forecast_horizon_hours"])
    labels = load_labels(Path(config["paths"]["database"]), config, args.include_synthetic)
    examples, report = build_flat_examples(labels, horizon)
    if examples.empty:
        raise SystemExit(
            "No eligible examples were built. Collect trusted operator labels; "
            "use --include-synthetic only for diagnostics, never promotion."
        )
    version = dataset_version(examples)
    output_dir = Path(config["paths"]["processed_dir"])
    report_dir = Path(config["paths"]["report_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"training_examples_h{horizon}_{version}.csv"
    examples.to_csv(output, index=False)
    report.update({
        "dataset_version": version,
        "horizon_hours": horizon,
        "include_synthetic": args.include_synthetic,
        "promotion": promotion_eligibility(
            examples[examples["trusted_label"].astype(bool)], config,
        ),
        "class_counts": examples["target"].value_counts().to_dict(),
        "output": str(output),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    (report_dir / f"dataset_{version}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
