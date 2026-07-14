"""Tune and evaluate a leakage-safe XGBoost candidate.

The input must be produced by ``build_training_dataset.py``. Candidate files
are versioned and never replace the production bundle automatically.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from app.lib.features import FEATURE_COLUMNS
from app.lib.ml_pipeline import (
    XGB_EXTRA_COLUMNS,
    choose_threshold,
    chronological_split,
    classification_metrics,
    dataset_version,
    load_config,
    promotion_eligibility,
)
from app.lib.scoring import features_dict_from_row, p_bad_from_rules


def _json_default(value):
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Cannot serialize {type(value)!r}")


def _valid_cv_splits(frame: pd.DataFrame, n_splits: int, purge_hours: int):
    """Return expanding splits with a timestamp purge and both classes."""
    raw = TimeSeriesSplit(n_splits=min(n_splits, max(2, len(frame) // 20)))
    splits = []
    for train_idx, validation_idx in raw.split(frame):
        validation_issue = pd.to_datetime(
            frame.iloc[validation_idx]["issue_ts"], utc=True,
        ).min()
        train_targets = pd.to_datetime(frame.iloc[train_idx]["target_ts"], utc=True)
        keep = train_targets < validation_issue - pd.Timedelta(hours=purge_hours)
        train_idx = train_idx[np.asarray(keep)]
        if (
            len(train_idx) >= 10
            and len(validation_idx) >= 2
            and frame.iloc[train_idx]["target"].nunique() == 2
            and frame.iloc[validation_idx]["target"].nunique() == 2
        ):
            splits.append((train_idx, validation_idx))
    return splits


def _classifier(seed: int, scale_pos_weight: float, **overrides) -> XGBClassifier:
    settings = {
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "tree_method": "hist",
        "random_state": seed,
        "n_jobs": 1,
        "verbosity": 0,
        "scale_pos_weight": scale_pos_weight,
        "n_estimators": 200,
        "learning_rate": 0.05,
        "max_depth": 3,
        "min_child_weight": 2,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
        "gamma": 0.0,
        "reg_alpha": 0.0,
        "reg_lambda": 2.0,
    }
    settings.update(overrides)
    return XGBClassifier(**settings)


def train(dataset_path: Path, config: dict) -> tuple[Path, dict]:
    frame = pd.read_csv(dataset_path)
    feature_columns = [*FEATURE_COLUMNS, *XGB_EXTRA_COLUMNS]
    missing = [column for column in [*feature_columns, "target", "issue_ts", "target_ts"] if column not in frame]
    if missing:
        raise ValueError(f"Training dataset is missing columns: {missing}")
    frame = frame.sort_values(["target_ts", "site_key"]).reset_index(drop=True)
    split = chronological_split(
        frame,
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

    X_train = split.train[feature_columns]
    y_train = split.train["target"].astype(int)
    n_pos, n_neg = int(y_train.sum()), int(len(y_train) - y_train.sum())
    class_weight = n_neg / max(n_pos, 1)
    seed = int(config["random_seed"])
    base = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", _classifier(seed, class_weight)),
    ])
    parameter_space = {
        f"model__{key}": values
        for key, values in config["xgboost"]["parameter_space"].items()
    }
    cv_splits = _valid_cv_splits(
        split.train,
        int(config["xgboost"]["time_series_splits"]),
        int(config["dataset"]["purge_hours"]),
    )
    started = time.perf_counter()
    if cv_splits:
        search = RandomizedSearchCV(
            base,
            param_distributions=parameter_space,
            n_iter=int(config["xgboost"]["search_iterations"]),
            scoring="average_precision",
            cv=cv_splits,
            refit=False,
            random_state=seed,
            n_jobs=1,
            error_score="raise",
        )
        search.fit(X_train, y_train)
        best_params = {
            key.removeprefix("model__"): value
            for key, value in search.best_params_.items()
        }
        cv_score = float(search.best_score_)
    else:
        best_params = {}
        cv_score = None

    imputer = SimpleImputer(strategy="median", add_indicator=True)
    X_train_imputed = imputer.fit_transform(X_train)
    X_validation_imputed = imputer.transform(split.validation[feature_columns])
    final_model = _classifier(seed, class_weight, early_stopping_rounds=30, **best_params)
    final_model.fit(
        X_train_imputed,
        y_train,
        eval_set=[(X_validation_imputed, split.validation["target"].astype(int))],
        verbose=False,
    )
    candidate = Pipeline([("imputer", imputer), ("model", final_model)])
    training_seconds = time.perf_counter() - started

    validation_prob = candidate.predict_proba(split.validation[feature_columns])[:, 1]
    threshold = choose_threshold(split.validation["target"].to_numpy(), validation_prob)
    inference_started = time.perf_counter()
    test_prob = candidate.predict_proba(split.test[feature_columns])[:, 1]
    inference_seconds = time.perf_counter() - inference_started

    # Persistence/rain baseline is intentionally simple and uses no future data.
    prevalence = float(y_train.mean())
    majority_prob = np.full(len(split.test), prevalence)
    rule_prob = np.array([
        p_bad_from_rules(features_dict_from_row(row))
        for row in split.test[FEATURE_COLUMNS].to_numpy()
    ])
    version = dataset_version(frame)
    artifact_dir = Path(config["paths"]["artifact_dir"])
    report_dir = Path(config["paths"]["report_dir"])
    artifact_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model_path = artifact_dir / f"xgb_candidate_{version}_{stamp}.pkl"
    prediction_path = report_dir / f"xgb_test_predictions_{version}_{stamp}.csv"
    metrics_path = report_dir / f"xgb_candidate_{version}_{stamp}.json"

    trusted = frame[frame["trusted_label"].astype(bool)] if "trusted_label" in frame else frame.iloc[0:0]
    eligibility = promotion_eligibility(trusted, config)
    bundle = {
        "model": candidate,
        "feature_columns": feature_columns,
        "n_samples": int(len(frame)),
        "model_type": "xgboost",
        "forecast_horizon_hours": int(frame["forecast_horizon_hours"].iloc[0]),
        "threshold": threshold,
        "dataset_version": version,
        "promotion_eligible": eligibility["eligible"],
    }
    joblib.dump(bundle, model_path)
    predictions = split.test[["label_id", "site_key", "target_ts", "target"]].copy()
    predictions["probability"] = test_prob
    predictions.to_csv(prediction_path, index=False)
    report = {
        "model": "xgboost",
        "dataset": str(dataset_path),
        "dataset_version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "split": split.boundaries,
        "cross_validation": {"valid_splits": len(cv_splits), "best_average_precision": cv_score},
        "best_hyperparameters": {**best_params, "scale_pos_weight": class_weight},
        "validation": classification_metrics(split.validation["target"], validation_prob, threshold),
        "test": classification_metrics(split.test["target"], test_prob, threshold),
        "baselines": {
            "training_prevalence": classification_metrics(split.test["target"], majority_prob, 0.5),
            "rules": classification_metrics(split.test["target"], rule_prob, 0.5),
        },
        "training_seconds": training_seconds,
        "test_inference_seconds": inference_seconds,
        "mean_inference_ms": inference_seconds * 1000 / len(split.test),
        "feature_columns": feature_columns,
        "threshold": threshold,
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
