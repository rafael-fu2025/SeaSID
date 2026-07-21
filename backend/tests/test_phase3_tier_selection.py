"""
Phase 3 regression tests — tiered model selection.

Pins down the rules for choosing between LSTM, XGBoost, and rule-based
scoring so the dashboard never silently serves an unreliable model.

Tested contracts:
  - Tier 1 (LSTM) is selected only when the bundle has ≥ LSTM_MIN_SAMPLES
    samples AND last-known AUC ≥ LSTM_MIN_AUC.
  - Tier 2 (XGBoost) is selected only when the bundle exists and
    last-known AUC ≥ XGB_MIN_AUC.
  - Tier 3 (rules) is selected when no model qualifies — and the
    ``reason`` string explains why.
  - The ``selected_tier()`` function exposes (tier, reason) to the API.
  - The dashboard forecast reflects the chosen tier via
    ``forecast_source`` and ``model_version``.
"""
from __future__ import annotations

import json



def _reset_model_cache():
    """Drop the cached bundle + tier info AND clear stale metrics so each
    test starts from a known baseline. Model artefacts (seasid_lstm.pt /
    seasid_xgb.pkl) are kept on disk by default so load_best() can find
    them — but the test that *writes* an LSTM bundle is responsible for
    deleting it (see test_tier1_lstm_accepted_with_good_metrics)."""
    import app.lib.model as M
    M._cached_bundle = None
    M._selected_tier = None
    M._selection_reason = None
    M._lstm_rejection_reason = None
    M._xgb_rejection_reason = None
    # Drop both metrics files so each test starts from a known baseline.
    (M.DATA_DIR / "lstm_metrics.json").unlink(missing_ok=True)
    (M.DATA_DIR / "xgb_metrics.json").unlink(missing_ok=True)


def _write_metrics(name: str, payload: dict) -> None:
    """Helper: overwrite one of the metrics files used by load_best()."""
    import app.lib.model as M
    p = M.DATA_DIR / name
    with open(p, "w") as f:
        json.dump(payload, f)


def test_tier1_lstm_rejected_for_too_few_samples(monkeypatch):
    """An LSTM with 100 samples and 0.9 AUC must NOT pass Tier 1
    (LSTM_MIN_SAMPLES = 500)."""
    import app.lib.model as M
    _reset_model_cache()

    # Build a real LSTM bundle on disk so Tier 1 sees it and reports a
    # diagnostic.
    import torch
    from app.lib.model_lstm import LSTMPredictor
    from sklearn.preprocessing import StandardScaler
    from app.lib.features import FEATURE_COLUMNS
    import numpy as np
    n = len(FEATURE_COLUMNS)
    model = LSTMPredictor(input_size=n, hidden_size=8, num_layers=1)
    scaler = StandardScaler().fit(np.zeros((2, n)))
    bundle = {
        "model_state_dict": model.state_dict(),
        "scaler": scaler,
        "config": {"seq_len": 24, "hidden_size": 8, "num_layers": 1,
                   "dropout": 0.3, "arch": "lstm"},
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": 100,
        "model_type": "lstm",
    }
    torch.save(bundle, M.LSTM_MODEL_PATH)
    _write_metrics("lstm_metrics.json", {
        "auc_roc": 0.9, "n_samples": 100, "arch": "lstm",
    })

    loaded = M.load_best()
    tier, _ = M.selected_tier()
    diag = M.tier_diagnostics()
    assert loaded is None
    assert tier == "rule_based"
    assert "100" in diag["lstm"] and "500" in diag["lstm"]

    M.LSTM_MODEL_PATH.unlink(missing_ok=True)


def test_tier1_lstm_rejected_for_low_auc(monkeypatch):
    """An LSTM with 1000 samples but AUC 0.5 must NOT pass Tier 1."""
    import app.lib.model as M
    _reset_model_cache()

    import torch
    from app.lib.model_lstm import LSTMPredictor
    from sklearn.preprocessing import StandardScaler
    from app.lib.features import FEATURE_COLUMNS
    import numpy as np
    n = len(FEATURE_COLUMNS)
    model = LSTMPredictor(input_size=n, hidden_size=8, num_layers=1)
    scaler = StandardScaler().fit(np.zeros((2, n)))
    bundle = {
        "model_state_dict": model.state_dict(),
        "scaler": scaler,
        "config": {"seq_len": 24, "hidden_size": 8, "num_layers": 1,
                   "dropout": 0.3, "arch": "lstm"},
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": 1000,
        "model_type": "lstm",
    }
    torch.save(bundle, M.LSTM_MODEL_PATH)
    _write_metrics("lstm_metrics.json", {
        "auc_roc": 0.5, "n_samples": 1000, "arch": "lstm",
    })

    loaded = M.load_best()
    tier, _ = M.selected_tier()
    diag = M.tier_diagnostics()
    assert loaded is None
    assert tier == "rule_based"
    # The rejection reason must surface the AUC value so operators can
    # see why their LSTM was demoted.
    assert "0.5" in diag["lstm"]

    M.LSTM_MODEL_PATH.unlink(missing_ok=True)


def test_tier2_xgboost_rejected_for_low_auc(monkeypatch):
    """XGBoost with AUC 0.5 must NOT pass Tier 2 (XGB_MIN_AUC = 0.60)."""
    import app.lib.model as M
    import joblib
    _reset_model_cache()

    # Build a real XGB bundle on disk so Tier 2 gets exercised (the loader
    # only reports a per-tier rejection reason when a bundle actually
    # existed for that tier).
    from app.lib.features import FEATURE_COLUMNS
    from xgboost import XGBClassifier
    import numpy as np
    n, p = 600, len(FEATURE_COLUMNS)
    rng = np.random.RandomState(0)
    X = rng.rand(n, p)
    y = (rng.rand(n) > 0.5).astype(int)
    clf = XGBClassifier(n_estimators=5, max_depth=2).fit(X, y)
    joblib.dump(
        {
            "model": clf,
            "feature_columns": list(FEATURE_COLUMNS),
            "n_samples": n,
            "model_type": "xgboost",
        },
        M.XGB_MODEL_PATH,
    )

    _write_metrics("xgb_metrics.json", {
        "auc_roc": 0.5, "cv_accuracy": 0.55, "n_samples": n,
    })
    bundle = M.load_best()
    tier, _ = M.selected_tier()
    diag = M.tier_diagnostics()
    assert bundle is None
    assert tier == "rule_based"
    assert "0.5" in diag["xgboost"] or "0.55" in diag["xgboost"]

    # Clean up so the next test starts from a known state.
    M.XGB_MODEL_PATH.unlink(missing_ok=True)


def test_tier2_xgboost_accepted_with_good_metrics(monkeypatch, tmp_path):
    """XGBoost that meets the gate (n_samples≥500, AUC≥0.60) IS selected."""
    import app.lib.model as M
    import joblib

    _reset_model_cache()
    # Need a "no bundle on disk" path for LSTM so Tier 1 doesn't pass on
    # stale artefacts. We do NOT delete the LSTM file because another test
    # may have left it on disk — instead we set lstm_metrics.json to a
    # blank state that disqualifies the bundle.
    _write_metrics("lstm_metrics.json", {"auc_roc": 0.0, "n_samples": 0})

    # Build a tiny valid XGB bundle on disk.
    from app.lib.features import FEATURE_COLUMNS
    from xgboost import XGBClassifier
    import numpy as np

    n, p = 600, len(FEATURE_COLUMNS)
    rng = np.random.RandomState(0)
    X = rng.rand(n, p)
    y = (rng.rand(n) > 0.5).astype(int)
    clf = XGBClassifier(n_estimators=5, max_depth=2).fit(X, y)

    bundle = {
        "model": clf,
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": n,
        "model_type": "xgboost",
    }
    joblib.dump(bundle, M.XGB_MODEL_PATH)
    _write_metrics("xgb_metrics.json", {
        "auc_roc": 0.75, "n_samples": n, "cv_accuracy": 0.75,
    })

    loaded = M.load_best()
    tier, reason = M.selected_tier()
    assert loaded is not None
    assert tier == "xgboost"
    assert "0.75" in reason


def test_tier1_lstm_accepted_with_good_metrics(monkeypatch, tmp_path):
    """LSTM meeting Tier 1 gate IS selected."""
    import app.lib.model as M

    _reset_model_cache()
    _write_metrics("lstm_metrics.json", {
        "auc_roc": 0.75, "n_samples": 800, "arch": "lstm",
    })

    # Build a real LSTM bundle on disk so the loader can return it.
    import torch
    from app.lib.model_lstm import LSTMPredictor
    from sklearn.preprocessing import StandardScaler
    from app.lib.features import FEATURE_COLUMNS
    import numpy as np

    n = 14  # 14 features
    model = LSTMPredictor(input_size=n, hidden_size=8, num_layers=1)
    scaler = StandardScaler().fit(np.zeros((2, n)))
    bundle = {
        "model_state_dict": model.state_dict(),
        "scaler": scaler,
        "config": {"seq_len": 24, "hidden_size": 8, "num_layers": 1,
                   "dropout": 0.3, "arch": "lstm"},
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": 800,
        "model_type": "lstm",
    }
    torch.save(bundle, M.LSTM_MODEL_PATH)

    loaded = M.load_best()
    tier, reason = M.selected_tier()
    assert loaded is not None
    assert tier == "lstm"
    assert "0.75" in reason

    # Clean up so other tests aren't affected.
    M.LSTM_MODEL_PATH.unlink(missing_ok=True)


def test_lstm_outranks_xgboost_when_both_qualify(monkeypatch, tmp_path):
    """When both LSTM and XGBoost qualify their gates, LSTM wins."""
    import app.lib.model as M

    _reset_model_cache()
    _write_metrics("lstm_metrics.json", {
        "auc_roc": 0.80, "n_samples": 1000, "arch": "lstm",
    })
    _write_metrics("xgb_metrics.json", {
        "auc_roc": 0.75, "n_samples": 600, "cv_accuracy": 0.75,
    })

    # Build a real LSTM bundle on disk.
    import torch
    from app.lib.model_lstm import LSTMPredictor
    from sklearn.preprocessing import StandardScaler
    from app.lib.features import FEATURE_COLUMNS
    import numpy as np

    n = len(FEATURE_COLUMNS)
    model = LSTMPredictor(input_size=n, hidden_size=8, num_layers=1)
    scaler = StandardScaler().fit(np.zeros((2, n)))
    bundle = {
        "model_state_dict": model.state_dict(),
        "scaler": scaler,
        "config": {"seq_len": 24, "hidden_size": 8, "num_layers": 1,
                   "dropout": 0.3, "arch": "lstm"},
        "feature_columns": list(FEATURE_COLUMNS),
        "n_samples": 1000,
        "model_type": "lstm",
    }
    torch.save(bundle, M.LSTM_MODEL_PATH)

    # Also need an XGB bundle on disk for the loader.
    import joblib
    from xgboost import XGBClassifier
    n_xgb = 600
    p = len(FEATURE_COLUMNS)
    rng = np.random.RandomState(0)
    X = rng.rand(n_xgb, p)
    y = (rng.rand(n_xgb) > 0.5).astype(int)
    clf = XGBClassifier(n_estimators=5, max_depth=2).fit(X, y)
    joblib.dump(
        {
            "model": clf,
            "feature_columns": list(FEATURE_COLUMNS),
            "n_samples": n_xgb,
            "model_type": "xgboost",
        },
        M.XGB_MODEL_PATH,
    )

    loaded = M.load_best()
    tier, _ = M.selected_tier()
    assert loaded is not None
    assert tier == "lstm", "LSTM must outrank XGBoost when both qualify"

    M.LSTM_MODEL_PATH.unlink(missing_ok=True)
    M.XGB_MODEL_PATH.unlink(missing_ok=True)


def test_forecast_source_reflects_tier():
    """End-to-end: the dashboard forecast's forecast_source must match the
    tier chosen at load."""
    from app.api.services import get_forecast, invalidate_forecast_cache

    invalidate_forecast_cache(None)
    import app.lib.model as M
    M._cached_bundle = None
    M._selected_tier = None
    M._selection_reason = None

    result = get_forecast("dauin_muck", hours=4)
    tier, _ = M.selected_tier()
    # rule_based → "rule_based"; xgboost → "xgboost"; lstm → "lstm"
    assert result["forecast_source"] == tier


def test_health_endpoints_still_work():
    """The /api/v1/health endpoint must not break when the tier is rules.

    Phase 3 changed health() to call selected_tier() — make sure it
    doesn't crash when no model is loaded.
    """
    from app.api.main import health

    # Reset tier so the path is exercised.
    import app.lib.model as M
    M._cached_bundle = None
    M._selected_tier = None
    M._selection_reason = None

    response = health()
    assert response.status == "ok"
    assert response.model_loaded in ("rule_based", "lstm", "xgboost")