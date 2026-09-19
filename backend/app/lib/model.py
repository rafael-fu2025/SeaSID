"""
Unified model interface for SeaSID.

Phase 3 — tiered model selection.

Loader precedence (highest preferred first)::

    Tier 1:  LSTM  — only when the saved bundle has ≥ LSTM_MIN_SAMPLES
                     samples AND a previously-measured AUC ≥ LSTM_MIN_AUC.
                     Right now our LSTM was trained on 104 samples and has
                     AUC ≈ 0.53, so the tier gates reject it.
    Tier 2:  XGBoost — when the saved bundle exists and AUC ≥ XGB_MIN_AUC
                     from the latest xgb_metrics.json. With 104 samples the
                     CV F1 is 0.0 so this *also* fails the gate and falls
                     through to rules. Once labels grow past the 500/sample
                     threshold this tier will engage.
    Tier 3:  None  (rule-based scorer in scoring.p_bad_from_rules).

The tier chosen at load time is logged once and surfaced in
``/api/v1/health`` and ``model_version()`` so operators can see *why* a
prediction is coming from rules instead of ML.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

import pandas as pd

from app.lib.features import (
    build_features,
    build_sequences_for_window,
)
from app.lib.scoring import features_dict_from_row, p_bad_from_rules

logger = logging.getLogger(__name__)

# ── Default paths ──────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
LSTM_MODEL_PATH = DATA_DIR / "seasid_lstm.pt"
XGB_MODEL_PATH = DATA_DIR / "seasid_xgb.pkl"
METRICS_PATH = DATA_DIR / "seasid_metrics.json"
XGB_METRICS_PATH = DATA_DIR / "xgb_metrics.json"
CALIBRATOR_PATH = DATA_DIR / "calibrator.pkl"

# ── Tier qualification thresholds (Phase 3) ─────────────────────────────
# Conservative defaults — the right value depends on the use-case. Raising
# LSTM_MIN_SAMPLES protects against the collapse mode we documented in
# Phase 0/2; raising the AUC thresholds means we only ship a model that
# materially beats the rules baseline.
LSTM_MIN_SAMPLES = 500
LSTM_MIN_AUC = 0.65
XGB_MIN_AUC = 0.60

# ── Module-level cache ────────────────────────────────────────────────────
_cached_bundle: dict | None = None
_selected_tier: str | None = None  # "lstm" | "xgboost" | "rule_based"
_selection_reason: str | None = None
_lstm_rejection_reason: str | None = None
_xgb_rejection_reason: str | None = None
# Tier 3 (rules) is cached for a short TTL so a deployment without a
# qualified bundle doesn't re-scan model files on every request.
_RULES_CACHE_TTL_SECONDS = 60
_cached_none_at: float | None = None


def _read_metrics_file(path: Path) -> dict:
    """Read a metrics JSON file; return {} on missing/corrupt."""
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Could not read %s: %s", path, exc)
        return {}


def _bundle_qualifies(bundle: dict, min_samples: int, min_auc: float, metrics: dict) -> tuple[bool, str]:
    """Return (qualifies, reason) for a bundle against a tier gate."""
    n_samples = bundle.get("n_samples", 0) or 0
    if n_samples < min_samples:
        return False, f"n_samples={n_samples} < {min_samples}"

    auc = metrics.get("auc_roc") or metrics.get("cv_f1") or 0.0
    if auc is None:
        return False, "no AUC metric in metrics file"
    if float(auc) < min_auc:
        return False, f"auc={float(auc):.3f} < {min_auc}"

    return True, f"n_samples={n_samples}, auc={float(auc):.3f}"


def load_best() -> dict | None:
    """
    Phase 3: tiered model selection — LIVE (audit F-B2-01).

    Tier 1 LSTM (n_samples >= 500, honest AUC >= 0.65) → Tier 2 XGBoost
    (n_samples >= 500, out-of-fold AUC >= 0.60) → Tier 3 rule-based (None).
    A rules-tier result is cached for _RULES_CACHE_TTL_SECONDS to avoid
    re-scanning model files on every request; ``reload()`` clears it.
    """
    global _cached_bundle, _selected_tier, _selection_reason
    global _lstm_rejection_reason, _xgb_rejection_reason, _cached_none_at

    # Cache: skip only when a *bundle* (not None) was previously selected.
    if _cached_bundle is not None:
        return _cached_bundle

    # Tier 3 (rules) result is cached briefly — a deployment without a
    # qualified bundle would otherwise re-scan model files per request.
    if _cached_none_at is not None and (time.time() - _cached_none_at) < _RULES_CACHE_TTL_SECONDS:
        _selected_tier = "rule_based"
        _selection_reason = "no ML bundle qualified its tier gate (cached)"
        return None

    # Lazy imports avoid a circular import at module load.
    from app.lib.model_lstm import load_lstm
    from app.lib.model_xgb import load_xgb

    # ── Tier 1: LSTM (audit F-B2-01: gates are live again) ─────────
    lstm_bundle = load_lstm(LSTM_MODEL_PATH)
    lstm_metrics = _read_metrics_file(DATA_DIR / "lstm_metrics.json")
    if lstm_bundle is not None:
        ok, reason = _bundle_qualifies(
            lstm_bundle, LSTM_MIN_SAMPLES, LSTM_MIN_AUC, lstm_metrics,
        )
        if ok:
            _cached_bundle = lstm_bundle
            _selected_tier = "lstm"
            _selection_reason = reason
            _lstm_rejection_reason = None
            _xgb_rejection_reason = "xgboost: not needed — LSTM qualified"
            _cached_none_at = None
            logger.info("Tier 1 selected: LSTM (%s)", reason)
            return _cached_bundle
        logger.info("Tier 1 (LSTM) rejected: %s", reason)
        _lstm_rejection_reason = f"lstm: {reason}"
    else:
        logger.info("Tier 1 (LSTM): no bundle on disk")
        _lstm_rejection_reason = "lstm: no bundle on disk"

    # ── Tier 2: XGBoost ─────────────────────────────────────────────
    xgb_bundle = load_xgb(XGB_MODEL_PATH)
    xgb_metrics = _read_metrics_file(XGB_METRICS_PATH)
    if xgb_bundle is not None:
        # Audit F-B2-04: auc_roc is out-of-fold (train_xgb), so gating on
        # it is meaningful. Older metrics files without it cannot qualify.
        n_samples = xgb_bundle.get("n_samples", 0) or 0
        auc = xgb_metrics.get("auc_roc") or 0.0
        reason = f"n_samples={n_samples}, auc={float(auc):.3f} (min_auc={XGB_MIN_AUC})"
        if n_samples >= LSTM_MIN_SAMPLES and float(auc) >= XGB_MIN_AUC:
            _cached_bundle = xgb_bundle
            _selected_tier = "xgboost"
            _selection_reason = reason
            _xgb_rejection_reason = None
            _cached_none_at = None
            logger.info("Tier 2 selected: XGBoost (%s)", reason)
            return _cached_bundle
        logger.info("Tier 2 (XGBoost) rejected: %s", reason)
        _xgb_rejection_reason = f"xgboost: {reason}"
    else:
        logger.info("Tier 2 (XGBoost): no bundle on disk")
        _xgb_rejection_reason = "xgboost: no bundle on disk"

    # ── Tier 3: rules ───────────────────────────────────────────────
    _cached_bundle = None
    _selected_tier = "rule_based"
    _selection_reason = "no ML bundle qualified its tier gate"
    logger.warning("Tier 3 selected: rule-based scoring (%s)", _selection_reason)
    _cached_none_at = time.time()
    return None


def reload() -> dict | None:
    """Force-reload the model (e.g., after retraining)."""
    global _cached_bundle, _selected_tier, _selection_reason
    global _lstm_rejection_reason, _xgb_rejection_reason, _cached_none_at
    _cached_bundle = None
    _selected_tier = None
    _selection_reason = None
    _lstm_rejection_reason = None
    _xgb_rejection_reason = None
    _cached_none_at = None
    return load_best()


def selected_tier() -> tuple[str, str]:
    """Return ``(tier, reason)`` describing the model tier chosen at last load.

    Phase 3: lets the API surface *which* model served the forecast and
    *why* (e.g. "xgboost — n_samples=104, auc=0.55" or "rule_based — no
    ML bundle qualified its tier gate").
    """
    if _selected_tier is None:
        # load_best hasn't been called yet — do so now.
        load_best()
    return _selected_tier or "unknown", _selection_reason or "no selection made yet"


def tier_diagnostics() -> dict[str, str]:
    """Return per-tier rejection reasons from the last load attempt.

    Useful for the Settings/Inspector panel so operators can see *why* an
    LSTM or XGBoost didn't make it past its gate (e.g. "AUC 0.55 < 0.60").
    The Tier 3 (rules) entry is always present and explains the fallback
    path if no model qualified.
    """
    if _selected_tier is None:
        load_best()
    return {
        "lstm": _lstm_rejection_reason or "qualified",
        "xgboost": _xgb_rejection_reason or "qualified",
        "selected_tier": _selected_tier or "unknown",
        "selection_reason": _selection_reason or "no selection made yet",
    }


def predict(bundle: dict | None, site_key: str, target_ts: datetime) -> float:
    """
    Return P(no-go) for a given site and time.

    Tier 3 (bundle is None) serves the rule-based scorer — audit F-B2-01.
    The LSTM path uses the batched sequence builder for its single window
    (audit F-B2-06: the old per-hour build_sequence made 96 DB queries).

    Phase 7: applies the persisted calibrator (``calibrator.pkl``) to the
    raw ML probability before returning it. If the calibrator is missing
    or the bundle is the rule-based fallback, returns the raw probability
    unchanged.
    """
    if bundle is None:
        feat_df = build_features(site_key, target_ts)
        return float(p_bad_from_rules(features_dict_from_row(feat_df.values[0])))

    model_type = get_model_type(bundle)

    if model_type == "lstm":
        from app.lib.model_lstm import predict_proba_lstm
        seq_len = bundle.get("config", {}).get("seq_len", 24)
        seq = build_sequences_for_window(site_key, [target_ts], window_hours=seq_len)
        proba = predict_proba_lstm(bundle, seq[0])
        raw = float(proba[0])
    else:
        raise RuntimeError(f"Unsupported production model type: {model_type}")

    # Phase 7: apply calibrator to the raw probability.
    cal = get_calibrator()
    return float(cal.predict(raw))


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


# ── Calibration (Phase 7) ────────────────────────────────────────────────────
# A single calibrator (Platt, isotonic, or identity) is loaded once per
# process from ``calibrator.pkl`` and applied in ``predict()``. Operators
# re-train it via ``scripts/train_calibrator.py`` after every LSTM/XGB
# retrain — the script fits on the time-aware holdout and saves the
# winner of Platt vs isotonic (lower Brier wins).

_cached_calibrator: object | None = None  # Calibrator instance or None
_calibrator_checked: bool = False


def get_calibrator():
    """Return the persisted calibrator, or an identity passthrough.

    Lazy-loaded from ``calibrator.pkl`` on first call; subsequent calls
    hit the module-level cache. Use ``reload_calibrator()`` after a
    retrain to force a fresh load.
    """
    global _cached_calibrator, _calibrator_checked
    from app.lib.calibration import Calibrator
    if _calibrator_checked and _cached_calibrator is not None:
        return _cached_calibrator
    cal = Calibrator.load(CALIBRATOR_PATH)
    _cached_calibrator = cal if cal is not None else Calibrator.identity()
    _calibrator_checked = True
    return _cached_calibrator


def reload_calibrator():
    """Force a fresh load of the persisted calibrator (post-retrain)."""
    global _cached_calibrator, _calibrator_checked
    _cached_calibrator = None
    _calibrator_checked = False
    return get_calibrator()
