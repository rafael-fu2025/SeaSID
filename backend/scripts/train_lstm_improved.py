"""Tune and evaluate a leakage-safe PyTorch LSTM candidate."""
from __future__ import annotations

import argparse
import itertools
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from app.lib.features import FEATURE_COLUMNS
from app.lib.ml_pipeline import (
    build_sequence_examples,
    choose_threshold,
    chronological_split,
    classification_metrics,
    dataset_version,
    load_config,
    promotion_eligibility,
)
from app.lib.model_lstm import LSTMTrainConfig, predict_proba_lstm, train_lstm
from app.lib.scoring import features_dict_from_row, p_bad_from_rules


def _json_default(value):
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value)!r}")


def _labels_from_dataset(frame: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({
        "id": frame["label_id"].astype(int),
        "site_key": frame["site_key"],
        "date": pd.to_datetime(frame["target_ts"], utc=True).dt.normalize(),
        "label": frame["label"],
        "source": frame["label_source"],
        "target": frame["target"].astype(int),
        "trusted_label": frame["trusted_label"].astype(bool),
    })


def _trial_settings(config: dict) -> list[dict]:
    settings = config["lstm"]
    combinations = list(itertools.product(
        settings["sequence_lengths"],
        settings["hidden_sizes"],
        settings["num_layers"],
        settings["dropouts"],
        settings["batch_sizes"],
        settings["learning_rates"],
        settings["optimizers"],
    ))
    rng = np.random.RandomState(int(config["random_seed"]))
    rng.shuffle(combinations)
    return [
        {
            "seq_len": values[0], "hidden_size": values[1],
            "num_layers": values[2], "dropout": values[3],
            "batch_size": values[4], "lr": values[5], "optimizer": values[6],
        }
        for values in combinations[: int(settings["max_trials"])]
    ]


def train(dataset_path: Path, config: dict) -> tuple[Path, dict]:
    flat = pd.read_csv(dataset_path)
    required = {
        "label_id", "site_key", "target_ts", "issue_ts", "target",
        "label", "label_source", "trusted_label",
    }
    missing = sorted(required - set(flat.columns))
    if missing:
        raise ValueError(f"Training dataset is missing columns: {missing}")
    max_sequence = max(config["lstm"]["sequence_lengths"])
    horizon = int(flat["forecast_horizon_hours"].iloc[0])
    print(f"Building {max_sequence}-hour sequences for {len(flat)} labels...", flush=True)
    X_all, metadata, build_report = build_sequence_examples(
        _labels_from_dataset(flat), horizon, max_sequence,
    )
    if len(metadata) < 10:
        raise ValueError(f"At least 10 sequence examples are required; found {len(metadata)}")
    metadata["sequence_index"] = np.arange(len(metadata))
    split = chronological_split(
        metadata,
        config["dataset"]["train_fraction"],
        config["dataset"]["validation_fraction"],
        config["dataset"]["purge_hours"],
    )
    for name, part in (("train", split.train), ("validation", split.validation), ("test", split.test)):
        if part.empty or part["target"].nunique() < 2:
            raise ValueError(
                f"{name} split needs both classes after chronological purging; "
                f"counts={part['target'].value_counts().to_dict()}"
            )

    train_idx = split.train["sequence_index"].to_numpy(dtype=int)
    validation_idx = split.validation["sequence_index"].to_numpy(dtype=int)
    test_idx = split.test["sequence_index"].to_numpy(dtype=int)
    y_all = metadata["target"].to_numpy(dtype=np.float32)
    trials = []
    best = None
    started = time.perf_counter()
    for number, settings in enumerate(_trial_settings(config), start=1):
        print(
            f"LSTM trial {number}/{config['lstm']['max_trials']}: {settings}",
            flush=True,
        )
        seq_len = int(settings["seq_len"])
        train_config = LSTMTrainConfig(
            **settings,
            max_epochs=int(config["lstm"]["max_epochs"]),
            patience=int(config["lstm"]["patience"]),
            random_seed=int(config["random_seed"]),
            arch="lstm",
        )
        result = train_lstm(
            X_all[train_idx, -seq_len:, :],
            y_all[train_idx],
            train_config,
            label_dates=list(pd.to_datetime(split.train["target_ts"]).dt.date),
        )
        bundle = {"model": result.model, "scaler": result.scaler}
        validation_prob = predict_proba_lstm(bundle, X_all[validation_idx, -seq_len:, :])
        threshold = choose_threshold(y_all[validation_idx], validation_prob)
        metrics = classification_metrics(y_all[validation_idx], validation_prob, threshold)
        trial = {
            "trial": number,
            "hyperparameters": settings,
            "inner_training": result.metrics,
            "validation": metrics,
            "threshold": threshold,
        }
        trials.append(trial)
        print(
            f"LSTM trial {number} validation PR-AUC={metrics['pr_auc']} F1={metrics['f1']:.3f}",
            flush=True,
        )
        score = metrics["pr_auc"] if metrics["pr_auc"] is not None else metrics["f1"]
        if best is None or score > best["score"]:
            best = {
                "score": score, "settings": settings, "result": result,
                "threshold": threshold, "validation": metrics,
            }
    training_seconds = time.perf_counter() - started
    if best is None:
        raise RuntimeError("No LSTM trial completed")

    seq_len = int(best["settings"]["seq_len"])
    candidate_bundle = {"model": best["result"].model, "scaler": best["result"].scaler}
    inference_started = time.perf_counter()
    test_prob = predict_proba_lstm(candidate_bundle, X_all[test_idx, -seq_len:, :])
    inference_seconds = time.perf_counter() - inference_started
    test_metrics = classification_metrics(y_all[test_idx], test_prob, best["threshold"])

    prevalence = float(y_all[train_idx].mean())
    majority_prob = np.full(len(test_idx), prevalence)
    flat_by_label = flat.set_index("label_id")
    rule_prob = np.array([
        p_bad_from_rules(features_dict_from_row(flat_by_label.loc[label_id, FEATURE_COLUMNS].to_numpy()))
        for label_id in split.test["label_id"]
    ])

    version = dataset_version(flat)
    artifact_dir = Path(config["paths"]["artifact_dir"])
    report_dir = Path(config["paths"]["report_dir"])
    artifact_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model_path = artifact_dir / f"lstm_candidate_{version}_{stamp}.pt"
    metrics_path = report_dir / f"lstm_candidate_{version}_{stamp}.json"
    prediction_path = report_dir / f"lstm_test_predictions_{version}_{stamp}.csv"
    trusted = flat[flat["trusted_label"].astype(bool)]
    eligibility = promotion_eligibility(trusted, config)
    saved_config = {
        "seq_len": seq_len,
        "hidden_size": int(best["settings"]["hidden_size"]),
        "num_layers": int(best["settings"]["num_layers"]),
        "dropout": float(best["settings"]["dropout"]),
        "optimizer": best["settings"]["optimizer"],
        "learning_rate": float(best["settings"]["lr"]),
        "batch_size": int(best["settings"]["batch_size"]),
        "recurrent_dropout": float(config["lstm"]["recurrent_dropout"]),
        "arch": "lstm",
        "random_seed": int(config["random_seed"]),
    }
    torch.save({
        "model_state_dict": best["result"].model.state_dict(),
        "scaler": best["result"].scaler,
        "config": saved_config,
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": int(len(metadata)),
        "model_type": "lstm",
        "forecast_horizon_hours": horizon,
        "threshold": best["threshold"],
        "dataset_version": version,
        "promotion_eligible": eligibility["eligible"],
    }, model_path)
    predictions = split.test[["label_id", "site_key", "target_ts", "target"]].copy()
    predictions["probability"] = test_prob
    predictions.to_csv(prediction_path, index=False)
    report = {
        "model": "lstm",
        "dataset": str(dataset_path),
        "dataset_version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sequence_build": build_report,
        "split": split.boundaries,
        "best_hyperparameters": saved_config,
        "validation": best["validation"],
        "test": test_metrics,
        "baselines": {
            "training_prevalence": classification_metrics(y_all[test_idx], majority_prob, 0.5),
            "rules": classification_metrics(y_all[test_idx], rule_prob, 0.5),
        },
        "training_seconds": training_seconds,
        "test_inference_seconds": inference_seconds,
        "mean_inference_ms": inference_seconds * 1000 / len(test_idx),
        "feature_columns": list(FEATURE_COLUMNS),
        "threshold": best["threshold"],
        "trials": trials,
        "promotion": eligibility,
        "candidate_model": str(model_path),
        "test_predictions": str(prediction_path),
    }
    metrics_path.write_text(json.dumps(report, indent=2, default=_json_default), encoding="utf-8")
    report["metrics_file"] = str(metrics_path)
    return model_path, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    config = load_config(args.config) if args.config else load_config()
    _, report = train(args.dataset, config)
    print(json.dumps(report, indent=2, default=_json_default))


if __name__ == "__main__":
    main()
