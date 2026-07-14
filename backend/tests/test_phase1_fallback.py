"""
Phase 1 regression tests.

Pins down the rule-based fallback behaviour so the "always 50%" bug
(Phase 0 finding: silent except-clause returning 0.5) cannot come back.

NOTE: Phase 2 (LSTM retrained on 14 features) and Phase 4 (batched
sequence inference) changed how predict() is called from inside
``services.get_forecast``. The batched path runs first; if it crashes,
every hour falls back to rules. These tests cover the batched crash
plus the legacy feature-build failure.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest


def test_fallback_when_batch_predict_crashes(monkeypatch):
    """Simulate the LSTM batch predict crashing and confirm every hour falls back."""
    from app.api import services
    from app.lib import model_lstm

    def boom(*args, **kwargs):
        raise ValueError("simulated model crash (e.g. stale bundle)")

    # Phase 4: the batched path is what services calls first. Stub it in
    # the module where it lives, not the services re-export.
    monkeypatch.setattr(model_lstm, "predict_proba_lstm_batch", boom)
    # Also stub the per-hour branch so any code reaching it still crashes.
    monkeypatch.setattr(services, "predict", boom)
    services.invalidate_forecast_cache(None)

    result = services.get_forecast("dauin_muck", hours=6)

    assert result["fallback_hours"] == 6, "every hour should fall back"
    assert result["forecast_source"].endswith("rules_fallback"), (
        f"expected forecast_source to declare fallback, got {result['forecast_source']!r}"
    )

    # Per-hour shape: every hour must have a real (non-Unknown, non-0.5) value.
    for h in result["hours"]:
        assert h["degraded_reason"] is not None
        assert "ValueError" in h["degraded_reason"]
        assert h["model_used"] == "rules_fallback"
        # The hard-coded 0.5 fallback is gone. Either p_bad is a real
        # number (0.10 / 0.45 / 0.85 from the rule scorer). In our test
        # environment predict() always crashes, so it must equal a rule
        # value — never the meaningless 0.5 that caused the original bug.
        assert h["p_bad"] in (0.10, 0.45, 0.85)
        assert h["viz_label"] != "Unknown" or h["risk"] == "Unknown"


def test_fallback_does_not_swallow_feature_build_failure(monkeypatch):
    """If even features fail, we still emit a per-hour entry (just labelled Unknown)."""
    from app.api import services

    def boom(*args, **kwargs):
        raise RuntimeError("database is on fire")

    # Crash the per-hour feature build path so the outer except runs.
    monkeypatch.setattr(services, "build_features_for_window", boom)
    monkeypatch.setattr(services, "build_features", boom)

    result = services.get_forecast("dauin_muck", hours=3)

    assert len(result["hours"]) == 3
    for h in result["hours"]:
        assert h["risk"] == "Unknown"
        assert h["degraded_reason"] is not None
        assert "RuntimeError" in h["degraded_reason"]


def test_fallback_p_bad_matches_rules_for_real_features(monkeypatch):
    """Sanity: with real features and a predict() crash, p_bad equals the rule value."""
    from app.api import services
    from app.lib import model_lstm
    from app.lib.features import build_features
    from app.lib.scoring import features_dict_from_row, p_bad_from_rules

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    real_features = build_features("dauin_muck", now)
    fd = features_dict_from_row(real_features.values[0])
    expected = p_bad_from_rules(fd)

    def boom(*args, **kwargs):
        raise ValueError("simulated model crash")

    monkeypatch.setattr(model_lstm, "predict_proba_lstm_batch", boom)
    monkeypatch.setattr(services, "predict", boom)
    services.invalidate_forecast_cache(None)

    result = services.get_forecast("dauin_muck", hours=2)

    # First hour's p_bad must match the rule-based value (within rounding).
    assert result["hours"][0]["p_bad"] == pytest.approx(round(expected, 3))


def test_no_fallback_when_predict_succeeds():
    """Sanity check: when nothing is stubbed, the dashboard should not
    crash and should produce real (non-0.5) probabilities.

    Phase 2 retrained the LSTM on the current 14-feature schema, so
    predict() no longer raises the schema-mismatch ValueError. Phase 3
    introduced tier-based selection — the LSTM is currently rejected by
    its tier gate (n_samples=104 < 500), so the system correctly serves
    the rule-based scorer. Either source is acceptable as long as the
    predictions are real and ``degraded_reason is None``.

    If this test ever starts failing on ``p_bad == 0.5`` for every hour,
    the Phase-0 silent-fallback bug has regressed.
    """
    from app.api import services

    services.invalidate_forecast_cache(None)
    result = services.get_forecast("dauin_muck", hours=4)

    # Predictions must not be the constant 0.5 (Phase-0 silent fallback).
    p_bads = [h["p_bad"] for h in result["hours"]]
    assert not all(round(p, 3) == 0.5 for p in p_bads), (
        "every hour fell back to 0.5 — Phase-0 symptom has regressed."
    )
    # And no hour should have a degraded_reason — predict() must succeed
    # either way (real model or rules).
    for h in result["hours"]:
        assert h["degraded_reason"] is None, (
            f"hour {h['ts']} unexpectedly fell back: {h['degraded_reason']}"
        )
    # forecast_source is one of the three legitimate values.
    assert result["forecast_source"] in {"lstm", "xgboost", "rule_based"}, (
        f"unexpected forecast_source: {result['forecast_source']!r}"
    )