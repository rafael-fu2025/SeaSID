"""Regression tests for LSTM-only production model selection."""

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


def test_production_loader_selects_lstm():
    import app.lib.model as model

    _reset_model_cache()
    bundle = model.load_best()
    tier, reason = model.selected_tier()

    assert bundle["model_type"] == "lstm"
    assert tier == "lstm"
    assert reason == "production model configured as LSTM"
    assert model.tier_diagnostics()["xgboost"].startswith("xgboost: disabled")


def test_missing_lstm_is_an_explicit_error(monkeypatch):
    import app.lib.model as model
    from app.lib import model_lstm

    _reset_model_cache()
    monkeypatch.setattr(model_lstm, "load_lstm", lambda path: None)

    with pytest.raises(RuntimeError, match="Production LSTM bundle not found"):
        model.load_best()

    assert model._selected_tier == "lstm"


def test_production_predict_rejects_non_lstm_bundle():
    import app.lib.model as model

    target = datetime.now(timezone.utc)
    with pytest.raises(RuntimeError, match="Unsupported production model type"):
        model.predict({"model_type": "xgboost"}, "dauin_muck", target)


def test_forecast_source_is_lstm():
    from app.api.services import get_forecast, invalidate_forecast_cache

    invalidate_forecast_cache(None)
    _reset_model_cache()
    result = get_forecast("dauin_muck", hours=2)

    assert result["forecast_source"] == "lstm"
    assert all(hour["model_used"] == "lstm" for hour in result["hours"])


def test_health_reports_lstm():
    from app.api.main import health

    _reset_model_cache()
    response = health()

    assert response.status == "ok"
    assert response.model_loaded == "lstm"
