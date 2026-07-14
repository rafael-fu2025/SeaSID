"""Leakage-safe dataset and evaluation utilities for SeaSID retraining."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    precision_recall_fscore_support,
    recall_score,
    roc_auc_score,
)

from app.lib.features import FEATURE_COLUMNS, build_features, build_sequences_for_window
from app.lib.scoring import label_to_binary


BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_CONFIG = BACKEND_DIR / "config" / "ml_pipeline.json"

XGB_EXTRA_COLUMNS = [
    "site_key_apo_reef",
    "site_key_dauin_muck",
    "issue_hour_sin",
    "issue_hour_cos",
    "issue_doy_sin",
    "issue_doy_cos",
    "forecast_horizon_hours",
    "precip_acceleration",
    "wind_variability",
    "wind_wave_interaction",
    "tide_wind_interaction",
]


def load_config(path: Path = DEFAULT_CONFIG) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    for key, value in config["paths"].items():
        candidate = Path(value)
        config["paths"][key] = str(candidate if candidate.is_absolute() else BACKEND_DIR / candidate)
    return config


def dataset_version(frame: pd.DataFrame) -> str:
    canonical = frame.sort_values(["target_ts", "site_key"]).reset_index(drop=True).copy()
    float_columns = canonical.select_dtypes(include=["float32", "float64"]).columns
    canonical[float_columns] = canonical[float_columns].round(8)
    stable = canonical.to_csv(index=False, date_format="%Y-%m-%dT%H:%M:%SZ")
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()[:12]


def is_trusted_source(source: str, config: dict) -> bool:
    value = str(source or "").lower()
    excluded = tuple(x.lower() for x in config["dataset"]["excluded_source_prefixes"])
    trusted = tuple(x.lower() for x in config["dataset"]["trusted_source_prefixes"])
    return not value.startswith(excluded) and value.startswith(trusted)


def load_labels(db_path: Path, config: dict, include_synthetic: bool = False) -> pd.DataFrame:
    connection = sqlite3.connect(db_path)
    try:
        labels = pd.read_sql_query(
            """SELECT id, site_key, date, label, source, actual_viz_m,
                      actual_current, no_go_reason, confidence
               FROM no_dive_labels ORDER BY date, site_key, id""",
            connection,
        )
    finally:
        connection.close()
    labels["date"] = pd.to_datetime(labels["date"], errors="coerce", utc=True)
    labels["trusted_label"] = labels["source"].map(lambda value: is_trusted_source(value, config))
    if not include_synthetic:
        labels = labels[labels["trusted_label"]].copy()
    labels["target"] = labels["label"].map(label_to_binary)
    return labels.reset_index(drop=True)


def _extra_xgb_features(row: pd.Series, site_key: str, issue_ts: datetime, horizon: int) -> dict:
    hour_angle = 2 * np.pi * issue_ts.hour / 24
    doy_angle = 2 * np.pi * issue_ts.timetuple().tm_yday / 366
    wind_mean = max(float(row["wind_mean_24h_kmh"]), 0.1)
    return {
        "site_key_apo_reef": float(site_key == "apo_reef"),
        "site_key_dauin_muck": float(site_key == "dauin_muck"),
        "issue_hour_sin": float(np.sin(hour_angle)),
        "issue_hour_cos": float(np.cos(hour_angle)),
        "issue_doy_sin": float(np.sin(doy_angle)),
        "issue_doy_cos": float(np.cos(doy_angle)),
        "forecast_horizon_hours": float(horizon),
        "precip_acceleration": float(row["precip_recent_3h"] - row["precip_24h_mm"] / 8.0),
        "wind_variability": float(row["wind_max_24h_kmh"] / wind_mean),
        "wind_wave_interaction": float(row["wind_max_24h_kmh"] * row["wave_max_24h_m"]),
        "tide_wind_interaction": float(row["tide_range_24h_m"] * row["wind_max_24h_kmh"]),
    }


def build_flat_examples(
    labels: pd.DataFrame,
    horizon_hours: int,
) -> tuple[pd.DataFrame, dict]:
    """Build one row per label using information available by issue_ts only."""
    rows: list[dict] = []
    rejected = 0
    for label in labels.itertuples(index=False):
        target_ts = label.date.to_pydatetime().replace(hour=12)
        issue_ts = target_ts - timedelta(hours=horizon_hours)
        try:
            feature_row = build_features(label.site_key, issue_ts).iloc[0]
        except Exception:
            rejected += 1
            continue
        record = {name: float(feature_row[name]) for name in FEATURE_COLUMNS}
        record.update(_extra_xgb_features(feature_row, label.site_key, issue_ts, horizon_hours))
        record.update({
            "label_id": int(label.id),
            "site_key": label.site_key,
            "issue_ts": issue_ts.isoformat(),
            "target_ts": target_ts.isoformat(),
            "forecast_horizon_hours": int(horizon_hours),
            "target": int(label.target),
            "label": label.label,
            "label_source": label.source,
            "trusted_label": bool(label.trusted_label),
        })
        rows.append(record)
    columns = [
        *FEATURE_COLUMNS,
        *XGB_EXTRA_COLUMNS,
        "label_id", "site_key", "issue_ts", "target_ts",
        "target", "label", "label_source", "trusted_label",
    ]
    frame = pd.DataFrame(rows, columns=columns)
    if not frame.empty:
        frame = frame.sort_values(["target_ts", "site_key"]).reset_index(drop=True)
    report = {"input_labels": int(len(labels)), "rejected_rows": rejected, "final_rows": int(len(frame))}
    return frame, report


def build_sequence_examples(
    labels: pd.DataFrame,
    horizon_hours: int,
    sequence_length_hours: int,
) -> tuple[np.ndarray, pd.DataFrame, dict]:
    """Build chronological LSTM examples ending at the forecast issue time.

    The target is the recorded dive outcome at noon UTC on ``label.date``.
    Every sequence ends at ``issue_ts = target_ts - horizon`` and therefore
    cannot include observations from the forecast horizon or target day after
    issuance.
    """
    metadata_rows: list[dict] = []
    sequences: list[np.ndarray] = []
    rejected = 0

    work = labels.copy()
    if work.empty:
        shape = (0, sequence_length_hours, len(FEATURE_COLUMNS))
        return np.zeros(shape, dtype=np.float32), pd.DataFrame(), {
            "input_labels": 0, "rejected_rows": 0, "final_rows": 0,
        }

    target_timestamps = work["date"].map(
        lambda value: value.to_pydatetime().replace(hour=12)
    )
    work["target_ts"] = target_timestamps
    work["issue_ts"] = target_timestamps - pd.Timedelta(hours=horizon_hours)

    for site_key, site_labels in work.groupby("site_key", sort=False):
        site_labels = site_labels.sort_values(["target_ts", "id"])
        issue_tses = list(site_labels["issue_ts"])
        try:
            site_sequences = build_sequences_for_window(
                site_key,
                issue_tses,
                window_hours=sequence_length_hours,
            )
        except Exception:
            rejected += len(site_labels)
            continue
        for sequence, label in zip(site_sequences, site_labels.itertuples(index=False)):
            if sequence.shape != (sequence_length_hours, len(FEATURE_COLUMNS)):
                rejected += 1
                continue
            sequences.append(sequence.astype(np.float32, copy=False))
            metadata_rows.append({
                "label_id": int(label.id),
                "site_key": label.site_key,
                "issue_ts": label.issue_ts.isoformat(),
                "target_ts": label.target_ts.isoformat(),
                "forecast_horizon_hours": int(horizon_hours),
                "sequence_length_hours": int(sequence_length_hours),
                "target": int(label.target),
                "label": label.label,
                "label_source": label.source,
                "trusted_label": bool(label.trusted_label),
            })

    if sequences:
        X = np.stack(sequences)
        metadata = pd.DataFrame(metadata_rows)
        order = metadata.sort_values(["target_ts", "site_key"]).index.to_numpy()
        X = X[order]
        metadata = metadata.loc[order].reset_index(drop=True)
    else:
        X = np.zeros((0, sequence_length_hours, len(FEATURE_COLUMNS)), dtype=np.float32)
        metadata = pd.DataFrame(metadata_rows)
    return X, metadata, {
        "input_labels": int(len(labels)),
        "rejected_rows": int(rejected),
        "final_rows": int(len(metadata)),
    }


@dataclass
class SplitFrames:
    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame
    boundaries: dict


def chronological_split(
    frame: pd.DataFrame,
    train_fraction: float = 0.70,
    validation_fraction: float = 0.15,
    purge_hours: int = 48,
) -> SplitFrames:
    ordered = frame.sort_values("target_ts").reset_index(drop=True)
    n = len(ordered)
    if n < 10:
        raise ValueError(f"At least 10 examples are required for a three-way split; found {n}")
    train_end = max(1, int(n * train_fraction))
    validation_end = min(n - 1, max(train_end + 1, int(n * (train_fraction + validation_fraction))))
    train = ordered.iloc[:train_end].copy()
    validation = ordered.iloc[train_end:validation_end].copy()
    test = ordered.iloc[validation_end:].copy()
    purge = pd.Timedelta(hours=purge_hours)
    if not validation.empty:
        train = train[pd.to_datetime(train["target_ts"], utc=True) < pd.to_datetime(validation["issue_ts"], utc=True).min() - purge]
    if not test.empty:
        validation = validation[pd.to_datetime(validation["target_ts"], utc=True) < pd.to_datetime(test["issue_ts"], utc=True).min() - purge]
    boundaries = {
        name: {
            "rows": int(len(part)),
            "start": None if part.empty else str(part["target_ts"].min()),
            "end": None if part.empty else str(part["target_ts"].max()),
        }
        for name, part in (("train", train), ("validation", validation), ("test", test))
    }
    return SplitFrames(train, validation, test, boundaries)


def choose_threshold(y_true: np.ndarray, probabilities: np.ndarray) -> float:
    candidates = np.linspace(0.1, 0.9, 81)
    scores = [f1_score(y_true, probabilities >= threshold, zero_division=0) for threshold in candidates]
    return float(candidates[int(np.argmax(scores))])


def classification_metrics(y_true, probabilities, threshold: float = 0.5) -> dict:
    y_true = np.asarray(y_true, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    predicted = (probabilities >= threshold).astype(int)
    class_precision, class_recall, class_f1, class_support = precision_recall_fscore_support(
        y_true, predicted, labels=[0, 1], zero_division=0,
    )
    result = {
        "threshold": float(threshold),
        "accuracy": float(accuracy_score(y_true, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, predicted)),
        "precision": float(precision_score(y_true, predicted, zero_division=0)),
        "recall": float(recall_score(y_true, predicted, zero_division=0)),
        "f1": float(f1_score(y_true, predicted, zero_division=0)),
        "pr_auc": None,
        "roc_auc": None,
        "confusion_matrix": confusion_matrix(y_true, predicted, labels=[0, 1]).tolist(),
        "support": {"go": int((y_true == 0).sum()), "no_go": int((y_true == 1).sum())},
        "class_metrics": {
            name: {
                "precision": float(class_precision[index]),
                "recall": float(class_recall[index]),
                "f1": float(class_f1[index]),
                "support": int(class_support[index]),
            }
            for index, name in enumerate(("go", "no_go"))
        },
    }
    if len(np.unique(y_true)) > 1:
        result["roc_auc"] = float(roc_auc_score(y_true, probabilities))
        result["pr_auc"] = float(average_precision_score(y_true, probabilities))
    return result


def promotion_eligibility(frame: pd.DataFrame, config: dict) -> dict:
    counts = frame["target"].value_counts().to_dict() if not frame.empty else {}
    min_total = config["dataset"]["minimum_total_labels_for_promotion"]
    min_class = config["dataset"]["minimum_labels_per_class_for_promotion"]
    reasons = []
    if len(frame) < min_total:
        reasons.append(f"trusted labels {len(frame)} < {min_total}")
    for klass in (0, 1):
        if counts.get(klass, 0) < min_class:
            reasons.append(f"class {klass} labels {counts.get(klass, 0)} < {min_class}")
    return {"eligible": not reasons, "reasons": reasons, "class_counts": counts}
