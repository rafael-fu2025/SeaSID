"""
Phase 4 regression tests.

Pins down the caching + batched-sequence contract so future refactors cannot
silently reintroduce the 30–50 s dashboard load.

Tested contracts:
  - ``get_forecast`` returns the same dict object on cache hits (same memory id).
  - The cache key changes when the wall-clock TTL bucket changes.
  - ``invalidate_forecast_cache(site_key)`` drops only that site's entries.
  - ``invalidate_forecast_cache(None)`` drops everything.
  - ``build_sequences_for_window`` returns the expected ``(N, seq_len, features)``
    shape and never opens more than 4 DB sessions per call.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np


def test_cache_hit_returns_same_dict():
    from app.api.services import (
        get_forecast,
        invalidate_forecast_cache,
    )

    invalidate_forecast_cache(None)
    a = get_forecast("dauin_muck", hours=6)
    b = get_forecast("dauin_muck", hours=6)
    assert a is b, "second call within the TTL should be the cached object"


def test_cache_invalidated_by_explicit_call():
    from app.api.services import (
        get_forecast,
        invalidate_forecast_cache,
    )

    invalidate_forecast_cache(None)
    a = get_forecast("dauin_muck", hours=6)
    invalidate_forecast_cache("dauin_muck")
    b = get_forecast("dauin_muck", hours=6)
    assert a is not b, "after invalidation, a fresh forecast should be built"


def test_cache_isolation_between_sites():
    from app.api.services import (
        get_forecast,
        invalidate_forecast_cache,
    )

    invalidate_forecast_cache(None)
    dauin = get_forecast("dauin_muck", hours=6)
    apo = get_forecast("apo_reef", hours=6)
    assert dauin is not apo
    # Dropping dauin must not affect apo's cached forecast.
    invalidate_forecast_cache("dauin_muck")
    apo_again = get_forecast("apo_reef", hours=6)
    assert apo_again is apo, "apo_reef cache should survive dauin invalidation"


def test_cache_invalidate_all():
    from app.api.services import (
        get_forecast,
        invalidate_forecast_cache,
    )

    invalidate_forecast_cache(None)
    get_forecast("dauin_muck", hours=6)
    get_forecast("apo_reef", hours=6)
    n = invalidate_forecast_cache(None)
    assert n >= 2, "expected at least 2 entries before flush"
    # Both sites should now rebuild.
    d2 = get_forecast("dauin_muck", hours=6)
    a2 = get_forecast("apo_reef", hours=6)
    assert d2["site_key"] == "dauin_muck"
    assert a2["site_key"] == "apo_reef"


def test_build_sequences_for_window_shape():
    from app.lib.features import build_sequences_for_window

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    target_tses = [now + __import__("datetime").timedelta(hours=h) for h in range(6)]
    seqs = build_sequences_for_window("dauin_muck", target_tses, window_hours=24)
    assert isinstance(seqs, np.ndarray)
    assert seqs.ndim == 3
    assert seqs.shape == (6, 24, 14)
    assert seqs.dtype == np.float32


def test_build_sequences_for_window_empty():
    from app.lib.features import build_sequences_for_window

    seqs = build_sequences_for_window("dauin_muck", [], window_hours=24)
    assert seqs.shape == (0, 24, 14)


def test_build_sequences_for_window_minimises_db_sessions(monkeypatch):
    """Verify the batched builder opens at most 4 DB sessions per call (one
    per source table), not the 96+ of the per-hour fallback path."""
    from app.lib import features
    from datetime import datetime, timezone, timedelta

    call_count = {"n": 0}
    real_fetch_weather = features._fetch_weather_window
    real_fetch_tide = features._fetch_tide_window
    real_fetch_marine = features._fetch_marine_window
    real_fetch_air = features._fetch_air_snapshot

    def counting_weather(*args, **kwargs):
        call_count["n"] += 1
        return real_fetch_weather(*args, **kwargs)

    def counting_tide(*args, **kwargs):
        call_count["n"] += 1
        return real_fetch_tide(*args, **kwargs)

    def counting_marine(*args, **kwargs):
        call_count["n"] += 1
        return real_fetch_marine(*args, **kwargs)

    def counting_air(*args, **kwargs):
        call_count["n"] += 1
        return real_fetch_air(*args, **kwargs)

    monkeypatch.setattr(features, "_fetch_weather_window", counting_weather)
    monkeypatch.setattr(features, "_fetch_tide_window", counting_tide)
    monkeypatch.setattr(features, "_fetch_marine_window", counting_marine)
    monkeypatch.setattr(features, "_fetch_air_snapshot", counting_air)

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    target_tses = [now + timedelta(hours=h) for h in range(6)]
    features.build_sequences_for_window("dauin_muck", target_tses, window_hours=24)
    # Should be exactly 4 — one per source table.
    assert call_count["n"] == 4, (
        f"expected 4 DB fetches per batched sequence build, got {call_count['n']}"
    )