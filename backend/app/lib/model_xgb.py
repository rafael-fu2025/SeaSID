"""
XGBoost baseline model (Baseline 2) for SeaSID.

Traditional ML baseline for experimental comparison against the LSTM.
Uses sklearn-compatible XGBClassifier with conservative hyperparameters.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import cross_val_score, LeaveOneOut
from xgboost import XGBClassifier

from app.lib.features import FEATURE_COLUMNS

logger = logging.getLogger(__name__)


@dataclass
class XGBTrainingResult:
    model: XGBClassifier
    metrics: dict
    n_samples: int
    feature_columns: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))


def _build_classifier() -> XGBClassifier:
    """Create an XGBoost classifier with conservative hyperparameters."""
    return XGBClassifier(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.05,
        min_child_weight=2,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=1,
        tree_method="hist",
        verbosity=0,
    )


def train_xgb(X: pd.DataFrame, y: pd.Series) -> XGBTrainingResult:
    """
    Train an XGBoost classifier on the given features and labels.

    If len(X) < 4, skip CV and set metrics["mode"] = "tiny_train_only".
    Otherwise use LeaveOneOut CV for accuracy and f1.
    Final fit on all data.
    """
    if len(X) == 0:
        raise ValueError("Cannot train on empty dataset")

    clf = _build_classifier()
    metrics: dict = {}

    if len(X) < 4:
        logger.warning("Tiny dataset (%d samples) — skipping CV", len(X))
        metrics["mode"] = "tiny_train_only"
        clf.fit(X, y)
        train_preds = clf.predict(X)
        metrics["train_accuracy"] = float(np.mean(train_preds == y))
    else:
        # Cross-validation
        if len(X) <= 20:
            cv = LeaveOneOut()
        else:
            cv = min(5, len(X))

        try:
            acc_scores = cross_val_score(clf, X, y, cv=cv, scoring="accuracy")
            metrics["cv_accuracy"] = float(np.mean(acc_scores))
            metrics["cv_accuracy_std"] = float(np.std(acc_scores))
        except Exception as exc:
            logger.warning("CV accuracy failed: %s", exc)
            metrics["cv_accuracy"] = None

        try:
            f1_scores = cross_val_score(clf, X, y, cv=cv, scoring="f1")
            metrics["cv_f1"] = float(np.mean(f1_scores))
            metrics["cv_f1_std"] = float(np.std(f1_scores))
        except Exception as exc:
            logger.warning("CV f1 failed: %s", exc)
            metrics["cv_f1"] = None

        metrics["mode"] = "cv"

        # Final fit on all data
        clf.fit(X, y)

    metrics["n_samples"] = len(X)
    metrics["n_positive"] = int(y.sum())
    metrics["n_negative"] = int(len(y) - y.sum())

    logger.info("XGBoost trained: %s", metrics)

    return XGBTrainingResult(
        model=clf,
        metrics=metrics,
        n_samples=len(X),
        feature_columns=list(X.columns),
    )


def save_xgb(result: XGBTrainingResult, model_path: Path, metrics_path: Path) -> None:
    """Persist the trained XGBoost model and metrics."""
    import json

    bundle = {
        "model": result.model,
        "feature_columns": result.feature_columns,
        "n_samples": result.n_samples,
        "model_type": "xgboost",
    }
    joblib.dump(bundle, model_path)
    logger.info("XGBoost model saved to %s", model_path)

    with open(metrics_path, "w") as f:
        json.dump(result.metrics, f, indent=2)
    logger.info("XGBoost metrics saved to %s", metrics_path)


def load_xgb(model_path: Path) -> dict | None:
    """Load a saved XGBoost bundle. Returns None if file doesn't exist."""
    if not model_path.exists():
        logger.warning("XGBoost model not found at %s", model_path)
        return None
    try:
        bundle = joblib.load(model_path)
        bundle["model_type"] = "xgboost"
        logger.info("XGBoost model loaded from %s (%d samples)",
                     model_path, bundle.get("n_samples", 0))
        return bundle
    except Exception as exc:
        logger.error("Failed to load XGBoost model: %s", exc)
        return None


def predict_proba_xgb(bundle: dict, X: pd.DataFrame) -> pd.Series:
    """Return P(no-go) for each row in X."""
    clf = bundle["model"]
    proba = clf.predict_proba(X)[:, 1]  # column 1 = P(positive = no-go)
    return pd.Series(proba, index=X.index, name="p_bad")


def feature_importance(bundle: dict, feature_names: list[str] | None = None) -> pd.DataFrame:
    """Return a DataFrame of feature importance scores."""
    clf = bundle["model"]
    if feature_names is None:
        feature_names = bundle.get("feature_columns", FEATURE_COLUMNS)

    importance = clf.feature_importances_
    df = pd.DataFrame({
        "feature": feature_names,
        "importance": importance,
    }).sort_values("importance", ascending=False).reset_index(drop=True)
    return df
