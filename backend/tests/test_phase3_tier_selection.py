"""Regression tests for tiered model selection.

Audit F-B2-01: the tier gates were dead code (an unconditional early
return served the LSTM regardless of measured quality). They are now
reactivated:

    Tier 1  LSTM       — n_samples >= 500 AND honest AUC >= 0.65
    Tier 2  XGBoost    — n_samples >= 500 AND OOF AUC >= 0.60
    Tier 3  rule-based — no bundle qualified

The gates read the persisted metrics files, so these tests monkeypatch
``_read_metrics_file`` / loaders to construct each tier deterministically.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest


def _reset_model_cache():
    import app.lib.model as model

    model._cached_bundle = None
    model._selected_tier = None
    model._selection_reason = None
    model._lstm_rejection_reason = None
    model._xgb_rejection_reason = None
    model._cached_none_at = None


def _qualifying_metrics():
    return {"n_samples": 800, "auc_roc": 0.71}


@pytest.fixture()
def fake_lstm_bundle(monkeypatch):
    import app.lib.model as model
    from app.lib import model_lstm

    bundle = {
        "model": object(),  # never invoked in loader tests
        "scaler": None,
        "config": {"seq_len": 24, "arch": "lstm"},
        "feature_columns": ["f"] * 14,
        "n_samples": 800,
        "model_type": "lstm",
    }
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: bundle)
    monkeypatch.setattr(
        model, "_read_metrics_file",
        lambda path: _qualifying_metrics() if "lstm_metrics" in str(path) else {},
    )
    return bundle


def test_qualifying_lstm_is_selected(monkeypatch, fake_lstm_bundle):
    import app.lib.model as model

    _reset_model_cache()
    bundle = model.load_best()
    tier, reason = model.selected_tier()

    assert bundle is fake_lstm_bundle
    assert bundle["model_type"] == "lstm"
    assert tier == "lstm"
    assert "n_samples=800" in reason
    assert model.tier_diagnostics()["lstm"] == "qualified"


def test_unqualified_lstm_falls_through_to_rules(monkeypatch):
    """A LSTM under its gate (e.g. 104 samples, AUC 0.53) must NOT serve."""
    import app.lib.model as model
    from app.lib import model_lstm, model_xgb

    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: {
        "model": object(), "scaler": None,
        "config": {"seq_len": 24, "arch": "lstm"},
        "feature_columns": ["f"] * 14, "n_samples": 104, "model_type": "lstm",
    })
    monkeypatch.setattr(model_xgb, "load_xgb", lambda path: None)
    monkeypatch.setattr(model, "_read_metrics_file", lambda path: {})

    bundle = model.load_best()
    tier, reason = model.selected_tier()

    assert bundle is None, "an unqualified LSTM must never serve production"
    assert tier == "rule_based"
    diag = model.tier_diagnostics()
    assert "n_samples=104" in diag["lstm"]


def test_missing_lstm_falls_to_xgboost_when_qualified(monkeypatch):
    import app.lib.model as model
    from app.lib import model_lstm, model_xgb

    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: None)
    xgb_bundle = {
        "model": object(), "feature_columns": ["f"] * 14,
        "n_samples": 900, "model_type": "xgboost",
    }
    monkeypatch.setattr(model_xgb, "load_xgb", lambda path: xgb_bundle)
    monkeypatch.setattr(
        model, "_read_metrics_file",
        lambda path: _qualifying_metrics() if "xgb_metrics" in str(path) else {},
    )

    bundle = model.load_best()
    assert bundle is xgb_bundle
    assert model.selected_tier()[0] == "xgboost"


def test_rules_tier_is_cached_briefly(monkeypatch):
    """Tier 3 (rules) is cached for a short TTL, not re-scanned per request."""

    import app.lib.model as model
    from app.lib import model_lstm, model_xgb

    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: None)
    monkeypatch.setattr(model_xgb, "load_xgb", lambda path: None)

    first = model.load_best()
    assert first is None
    assert model._cached_none_at is not None

    # Within the TTL the loader must not even re-invoke the loaders.
    calls = {"n": 0}

    def counting_load(path):
        calls["n"] += 1
        return None

    monkeypatch.setattr(model_lstm, "load_lstm", counting_load)
    second = model.load_best()
    assert second is None
    assert calls["n"] == 0, "rules-tier cache should skip loader calls"


def test_predict_with_rules_bundle_uses_rule_scorer(monkeypatch, seeded_weather):
    """predict(None, …) serves the rule-based scorer instead of raising."""
    from app.lib import model as model_mod

    _reset_model_cache()
    monkeypatch.setattr(model_mod, "load_best", lambda: None)

    target = datetime.now(timezone.utc)
    p = model_mod.predict(None, "dauin_muck", target)
    assert 0.0 <= p <= 1.0
    # Rule scorer emits one of its three levels.
    assert p in (0.10, 0.45, 0.85)


def test_predict_rejects_unsupported_bundle_type():
    import app.lib.model as model

    target = datetime.now(timezone.utc)
    with pytest.raises(RuntimeError, match="Unsupported production model type"):
        model.predict({"model_type": "linear_regression"}, "dauin_muck", target)


def test_forecast_source_matches_active_tier(monkeypatch):
    """The forecast payload reports whichever tier actually served."""
    from app.api.services import get_forecast, invalidate_forecast_cache
    import app.lib.model as model
    from app.lib import model_lstm, model_xgb

    invalidate_forecast_cache(None)
    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: None)
    monkeypatch.setattr(model_xgb, "load_xgb", lambda path: None)
    monkeypatch.setattr(model, "_read_metrics_file", lambda path: {})

    result = get_forecast("dauin_muck", hours=2)

    assert result["forecast_source"] == "rule_based"
    assert result["ml_bundle_loaded"] is False
    assert all(hour["model_used"] == "rule_based" for hour in result["hours"])
    assert result["hours"][0]["p_bad"] in (0.10, 0.45, 0.85)


def test_health_reports_active_tier(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api.main import app
    import app.lib.model as model
    from app.lib import model_lstm, model_xgb

    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: None)
    monkeypatch.setattr(model_xgb, "load_xgb", lambda path: None)
    monkeypatch.setattr(model, "_read_metrics_file", lambda path: {})

    client = TestClient(app)
    response = client.get("/api/v1/health").json()

    assert response["status"] == "ok"
    assert response["selected_tier"] == "rule_based"
    assert response["model_loaded"] == "rule_based"
