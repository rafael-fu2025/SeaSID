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


def _reset_model_cache():
    """Isolate from other tests: clear the tier/rules caches (audit F-B2-01)."""
    import app.lib.model as model

    model._cached_bundle = None
    model._selected_tier = None
    model._selection_reason = None
    model._lstm_rejection_reason = None
    model._xgb_rejection_reason = None
    model._cached_none_at = None


def test_fallback_when_batch_predict_crashes(monkeypatch):
    """Simulate the LSTM batch predict crashing and confirm every hour is
    served by the rule scorer, explicitly labeled (audit F-B3-02)."""
    from app.api import services
    from app.lib import model_lstm

    _reset_model_cache()

    def boom(*args, **kwargs):
        raise ValueError("simulated model crash (e.g. stale bundle)")

    # Hermetic on CI (audit F-C1): runners have no trained artifacts, so
    # load_best would honestly return None (rules tier) and never reach the
    # LSTM path this test exercises. Inject a qualifying lstm bundle instead.
    monkeypatch.setattr(
        services, "load_best",
        lambda: {"model_type": "lstm", "config": {"seq_len": 24},
                 "feature_columns": ["f"] * 14, "n_samples": 800},
    )
    # Phase 4: the batched path is what services calls first. Stub it in
    # the module where it lives, not the services re-export.
    monkeypatch.setattr(model_lstm, "predict_proba_lstm_batch", boom)
    # Also stub the per-hour branch so any code reaching it still crashes.
    monkeypatch.setattr(services, "predict", boom)
    services.invalidate_forecast_cache(None)

    result = services.get_forecast("dauin_muck", hours=6)

    assert result["fallback_hours"] == 6, "every hour should fall back"
    assert result["forecast_source"] == "lstm"

    # Per-hour shape: every hour must be flagged AND served by the rules —
    # the Phase-0 fabricated 0.5 must never come back.
    for h in result["hours"]:
        assert h["degraded_reason"] is not None
        assert h["degraded_reason"].startswith("lstm_predict_failed")
        assert h["model_used"] == "rule_based"
        assert h["degraded"] is True
        # With the (near-)empty test feature set the rules scorer yields
        # its "Low" level, never the meaningless 0.5.
        assert h["p_bad"] == 0.10


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


def test_failed_lstm_is_replaced_by_labeled_rules(monkeypatch):
    """A failed LSTM hour is served by the rule scorer with an explicit
    label — the old fabricated neutral 0.5 is banned (audit F-B3-02)."""
    from app.api import services
    from app.lib import model_lstm

    _reset_model_cache()

    def boom(*args, **kwargs):
        raise ValueError("simulated model crash")

    # Hermetic on CI (see the sibling test above).
    monkeypatch.setattr(
        services, "load_best",
        lambda: {"model_type": "lstm", "config": {"seq_len": 24},
                 "feature_columns": ["f"] * 14, "n_samples": 800},
    )
    monkeypatch.setattr(model_lstm, "predict_proba_lstm_batch", boom)
    monkeypatch.setattr(services, "predict", boom)
    services.invalidate_forecast_cache(None)

    result = services.get_forecast("dauin_muck", hours=2)

    hour = result["hours"][0]
    assert hour["model_used"] == "rule_based"
    assert hour["p_bad"] in (0.10, 0.45, 0.85)


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
    # No hour may have a *prediction* failure — predict() must succeed either
    # way (real model or rules). A `low_data_coverage` flag is acceptable and
    # honest (audit F-B1-02): it marks hours whose trailing weather window is
    # partially empty, e.g. in a fresh test DB, and is not a prediction error.
    for h in result["hours"]:
        reason = h["degraded_reason"]
        assert reason is None or reason.startswith("low_data_coverage"), (
            f"hour {h['ts']} unexpectedly fell back: {reason}"
        )
    # forecast_source is one of the three legitimate values.
    assert result["forecast_source"] in {"lstm", "xgboost", "rule_based"}, (
        f"unexpected forecast_source: {result['forecast_source']!r}"
    )
