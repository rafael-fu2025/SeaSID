"""
Unified model interface for SeaSID.

Dispatches to LSTM (primary) or XGBoost (fallback) based on what's loaded.
Falls back to rule-based scoring when no model is available.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence

logger = logging.getLogger(__name__)

# ── Default paths ──────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
LSTM_MODEL_PATH = DATA_DIR / "seasid_lstm.pt"
XGB_MODEL_PATH = DATA_DIR / "seasid_xgb.pkl"
METRICS_PATH = DATA_DIR / "seasid_metrics.json"

# ── Module-level cache ────────────────────────────────────────────────────
_cached_bundle: dict | None = None


def load_best() -> dict | None:
    """
    Try LSTM first, fall back to XGBoost, then None (rule-based).
    Caches the loaded bundle for subsequent calls.
    """
    global _cached_bundle

    if _cached_bundle is not None:
        return _cached_bundle

    # Try LSTM first
    from app.lib.model_lstm import load_lstm
    bundle = load_lstm(LSTM_MODEL_PATH)
    if bundle is not None:
        _cached_bundle = bundle
        logger.info("Loaded LSTM model as primary")
        return bundle

    # Fall back to XGBoost
    from app.lib.model_xgb import load_xgb
    bundle = load_xgb(XGB_MODEL_PATH)
    if bundle is not None:
        _cached_bundle = bundle
        logger.info("Loaded XGBoost model as fallback")
        return bundle

    logger.warning("No ML model available — using rule-based scoring")
    return None


def reload() -> dict | None:
    """Force-reload the model (e.g., after retraining)."""
    global _cached_bundle
    _cached_bundle = None
    return load_best()


def predict(bundle: dict | None, site_key: str, target_ts: datetime) -> float:
    """
    Return P(no-go) for a given site and time.
    Dispatches to LSTM or XGBoost based on bundle type.
    Falls back to rule-based scoring if bundle is None.
    """
    if bundle is None:
        from app.lib.scoring import p_bad_from_rules, features_dict_from_row
        feat_df = build_features(site_key, target_ts)
        feat_dict = features_dict_from_row(feat_df.values[0])
        return p_bad_from_rules(feat_dict)

    model_type = get_model_type(bundle)

    if model_type == "lstm":
        from app.lib.model_lstm import predict_proba_lstm
        seq = build_sequence(site_key, target_ts, window_hours=bundle.get("config", {}).get("seq_len", 24))
        proba = predict_proba_lstm(bundle, seq)
        return float(proba[0])

    elif model_type == "xgboost":
        from app.lib.model_xgb import predict_proba_xgb
        feat_df = build_features(site_key, target_ts)
        proba = predict_proba_xgb(bundle, feat_df)
        return float(proba.iloc[0])

    else:
        from app.lib.scoring import p_bad_from_rules, features_dict_from_row
        feat_df = build_features(site_key, target_ts)
        feat_dict = features_dict_from_row(feat_df.values[0])
        return p_bad_from_rules(feat_dict)


def get_model_type(bundle: dict | None) -> Literal["lstm", "xgboost", "rule_based"]:
    """Determine which model type a bundle represents."""
    if bundle is None:
        return "rule_based"
    return bundle.get("model_type", "rule_based")


def get_feature_importance(bundle: dict | None) -> pd.DataFrame | None:
    """Get feature importance from the loaded model (XGBoost only)."""
    if bundle is None:
        return None

    model_type = get_model_type(bundle)
    if model_type == "xgboost":
        from app.lib.model_xgb import feature_importance
        return feature_importance(bundle)

    # LSTM doesn't have built-in feature importance
    return None
