"""Compare XGBoost and LSTM predictions on their identical test records."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd
from sklearn.metrics import ConfusionMatrixDisplay, PrecisionRecallDisplay, RocCurveDisplay

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from app.lib.ml_pipeline import classification_metrics, load_config


def evaluate(
    xgb_predictions: Path,
    lstm_predictions: Path,
    config: dict,
    xgb_metrics: Path | None = None,
    lstm_metrics: Path | None = None,
) -> tuple[Path, dict]:
    xgb_training = json.loads(xgb_metrics.read_text(encoding="utf-8")) if xgb_metrics else {}
    lstm_training = json.loads(lstm_metrics.read_text(encoding="utf-8")) if lstm_metrics else {}
    xgb = pd.read_csv(xgb_predictions).rename(columns={"probability": "xgb_probability"})
    lstm = pd.read_csv(lstm_predictions).rename(columns={"probability": "lstm_probability"})
    common = xgb.merge(
        lstm[["label_id", "target", "lstm_probability"]],
        on="label_id",
        how="inner",
        suffixes=("", "_lstm"),
        validate="one_to_one",
    )
    if common.empty:
        raise ValueError("The model prediction files have no common test records")
    if not (common["target"] == common["target_lstm"]).all():
        raise ValueError("Target values disagree between prediction files")
    if common["target"].nunique() < 2:
        raise ValueError("The common test period must contain both classes")

    y = common["target"].to_numpy(dtype=int)
    ensemble_probability = (
        common["xgb_probability"].to_numpy()
        + common["lstm_probability"].to_numpy()
    ) / 2
    # This threshold is descriptive only: production threshold selection must
    # use validation data, never this final test set.
    model_reports = {
        "xgboost": classification_metrics(y, common["xgb_probability"], 0.5),
        "lstm": classification_metrics(y, common["lstm_probability"], 0.5),
        "ensemble_at_0_5": classification_metrics(y, ensemble_probability, 0.5),
    }
    selected_threshold_reports = {
        "xgboost": classification_metrics(
            y, common["xgb_probability"], float(xgb_training.get("threshold", 0.5)),
        ),
        "lstm": classification_metrics(
            y, common["lstm_probability"], float(lstm_training.get("threshold", 0.5)),
        ),
    }
    common["ensemble_probability"] = ensemble_probability

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir = Path(config["paths"]["report_dir"])
    report_dir.mkdir(parents=True, exist_ok=True)
    common_path = report_dir / f"common_test_predictions_{stamp}.csv"
    plot_path = report_dir / f"model_comparison_{stamp}.png"
    output_path = report_dir / f"model_comparison_{stamp}.json"
    common.to_csv(common_path, index=False)

    figure, axes = plt.subplots(1, 3, figsize=(15, 4.5))
    for name, column in (("XGBoost", "xgb_probability"), ("LSTM", "lstm_probability"), ("Ensemble", "ensemble_probability")):
        PrecisionRecallDisplay.from_predictions(y, common[column], name=name, ax=axes[0])
        RocCurveDisplay.from_predictions(y, common[column], name=name, ax=axes[1])
    winner = max(model_reports, key=lambda key: model_reports[key]["f1"])
    winner_column = {
        "xgboost": "xgb_probability",
        "lstm": "lstm_probability",
        "ensemble_at_0_5": "ensemble_probability",
    }[winner]
    ConfusionMatrixDisplay.from_predictions(
        y, (common[winner_column] >= 0.5).astype(int),
        display_labels=["go", "no-go"], ax=axes[2], colorbar=False,
    )
    axes[2].set_title(f"Confusion matrix: {winner}")
    figure.tight_layout()
    figure.savefig(plot_path, dpi=160)
    plt.close(figure)

    training_metadata = {}
    for name, payload in (("xgboost", xgb_training), ("lstm", lstm_training)):
        if payload:
            training_metadata[name] = {
                "training_seconds": payload.get("training_seconds"),
                "mean_inference_ms": payload.get("mean_inference_ms"),
                "best_hyperparameters": payload.get("best_hyperparameters"),
                "candidate_model": payload.get("candidate_model"),
                "model_size_bytes": (
                    Path(payload["candidate_model"]).stat().st_size
                    if payload.get("candidate_model") and Path(payload["candidate_model"]).exists()
                    else None
                ),
            }
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "common_test_rows": int(len(common)),
        "test_start": str(common["target_ts"].min()),
        "test_end": str(common["target_ts"].max()),
        "metrics_at_fixed_0_5_threshold": model_reports,
        "metrics_at_validation_selected_threshold": selected_threshold_reports,
        "best_f1_at_fixed_threshold": winner,
        "ensemble_note": "Candidate only; tune ensemble weight and threshold on validation data before use.",
        "training_metadata": training_metadata,
        "common_predictions": str(common_path),
        "plot": str(plot_path),
    }
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["report_file"] = str(output_path)
    return output_path, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xgb-predictions", required=True, type=Path)
    parser.add_argument("--lstm-predictions", required=True, type=Path)
    parser.add_argument("--xgb-metrics", type=Path)
    parser.add_argument("--lstm-metrics", type=Path)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    config = load_config(args.config) if args.config else load_config()
    _, report = evaluate(
        args.xgb_predictions, args.lstm_predictions, config,
        args.xgb_metrics, args.lstm_metrics,
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
