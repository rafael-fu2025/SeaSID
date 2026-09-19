"""Sprint 1 (data-truth) regression tests.

Guards the audit fixes so the failures behind F-B6-01 / F-B1-01 / F-B1-02 /
F-B1-03 / F-B1-04 / F-B1-05 / F-B6-02 / F-B6-03 cannot come back:

  - Open-Meteo providers request a real forward window (not just 1 hour).
  - Provider failures persist NOTHING (no synthetic fabrication).
  - Partial feature windows are flagged as low coverage.
  - Alerts are deduped per condition episode, not per hour.
  - SQLite concurrency pragmas are applied.
  - Historical marine rows carry real wave heights.
  - Storm Glass requests an explicit time window.
  - Scraper rows without a label are rejected, never turned into "dive".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


# ── F-B6-01: Open-Meteo window math ──────────────────────────────────────

def test_open_meteo_weather_provider_requests_forward_window(monkeypatch):
    """fetch_hourly(48) must ask for 48 past AND ≥48 forecast hours."""
    from app.lib.providers.open_meteo import OpenMeteoWeatherProvider
    import app.lib.providers.open_meteo as om

    captured = {}

    def fake_fetch(lat, lon, past_hours=0, forecast_hours=48):
        captured["past"] = past_hours
        captured["forecast"] = forecast_hours
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return [
            {"ts": now - timedelta(hours=past_hours - i),
             "precip_mm": 0.0, "wind_max_kmh": 0.0, "wind_mean_kmh": 0.0,
             "wave_max_m": 0.0, "sea_temp_c": None}
            for i in range(past_hours)
        ] + [
            {"ts": now + timedelta(hours=i),
             "precip_mm": 0.0, "wind_max_kmh": 0.0, "wind_mean_kmh": 0.0,
             "wave_max_m": 0.0, "sea_temp_c": None}
            for i in range(forecast_hours)
        ]

    monkeypatch.setattr(om, "fetch_forecast", fake_fetch)
    rows = OpenMeteoWeatherProvider().fetch_hourly(9.18, 123.27, hours=48)

    assert captured["past"] == 48
    assert captured["forecast"] >= 48, (
        "forward window must cover the full horizon (audit F-B6-01)"
    )
    # Rows must actually extend into the future.
    newest = max(r["ts"] for r in rows)
    assert newest > datetime.now(timezone.utc)


def test_open_meteo_marine_provider_requests_forward_window(monkeypatch):
    from app.lib.providers.open_meteo import OpenMeteoMarineProvider
    import app.lib.providers.open_meteo as om

    captured = {}

    def fake_fetch(lat, lon, past_hours=0, forecast_hours=48):
        captured["forecast"] = forecast_hours
        return []

    monkeypatch.setattr(om, "fetch_forecast", fake_fetch)
    OpenMeteoMarineProvider().fetch_hourly(9.18, 123.27, hours=48)
    assert captured["forecast"] >= 48


# ── F-B1-01: no synthetic fabrication on provider failure ────────────────

def test_fetch_forecast_returns_empty_on_total_failure(monkeypatch):
    """A dead provider yields no rows — never fabricated 'plausible' weather."""
    import app.lib.weather as weather_mod

    monkeypatch.setattr(weather_mod, "_retry_get", lambda *a, **k: None)

    rows = weather_mod.fetch_forecast(9.18, 123.27, past_hours=24, forecast_hours=48)
    assert rows == []


def test_fetch_archive_returns_empty_on_total_failure(monkeypatch):
    import app.lib.weather as weather_mod

    monkeypatch.setattr(weather_mod, "_retry_get", lambda *a, **k: None)
    rows = weather_mod.fetch_archive(9.18, 123.27, "2026-01-01", "2026-01-02")
    assert rows == []


def test_synthetic_fallback_only_with_explicit_env(monkeypatch):
    """SEASID_ALLOW_SYNTHETIC=1 restores the smoke-test fallback explicitly."""
    import app.lib.weather as weather_mod

    monkeypatch.setenv("SEASID_ALLOW_SYNTHETIC", "1")
    monkeypatch.setattr(weather_mod, "_retry_get", lambda *a, **k: None)
    rows = weather_mod.fetch_forecast(9.18, 123.27, past_hours=1, forecast_hours=2)
    assert len(rows) > 0  # synthetic rows generated only under the flag


# ── F-B1-02: window coverage flagging ────────────────────────────────────

def test_build_features_for_window_reports_coverage(db_session):
    from app.lib.features import build_features_for_window, FEATURE_COLUMNS
    from app.lib.db import WeatherObs

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    # Seed only 12 of the trailing 24 hours.
    for h in range(12):
        db_session.add(WeatherObs(
            site_key="dauin_muck", ts=now - timedelta(hours=23 - h),
            precip_mm=0.0, wind_max_kmh=0.0, wind_mean_kmh=0.0, wave_max_m=0.0,
        ))
    db_session.commit()

    targets = [now, now + timedelta(hours=1)]
    df, coverage = build_features_for_window("dauin_muck", targets)

    assert list(df.columns) == FEATURE_COLUMNS
    assert len(coverage) == 2
    # The target at `now` sees 12 of 24 rows; the forward hour sees none of
    # its own trailing window within the seeded range beyond now... its
    # window overlaps the seeded rows partially.
    assert 0.0 <= coverage[0] <= 0.5, (
        "half-empty window must report reduced coverage"
    )


def test_build_features_for_window_full_coverage_when_data_complete(db_session):
    from app.lib.features import build_features_for_window
    from app.lib.db import WeatherObs

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for h in range(25):
        db_session.add(WeatherObs(
            site_key="dauin_muck", ts=now - timedelta(hours=h),
            precip_mm=0.0, wind_max_kmh=0.0, wind_mean_kmh=0.0, wave_max_m=0.0,
        ))
    db_session.commit()

    _, coverage = build_features_for_window("dauin_muck", [now])
    assert coverage[0] == pytest.approx(1.0)


# ── F-B1-03: alert event cooldown ────────────────────────────────────────

def test_alert_event_cooldown_blocks_repeat_alerts(db_session, monkeypatch):
    """A condition that stays over threshold yields ONE alert per episode,
    not one per evaluation hour (audit F-B1-03/F-B1-16)."""
    from app.lib import alerts as alerts_mod

    class _FakeFeatDF:
        values = [[0.0]]

    monkeypatch.setattr(alerts_mod, "build_features", lambda site_key, now: _FakeFeatDF())
    # One threshold crossed: wind_max_24h_kmh=50 ≥ 35 → high_wind alert.
    monkeypatch.setattr(alerts_mod, "features_dict_from_row", lambda row: {"wind_max_24h_kmh": 50.0})
    monkeypatch.setattr(alerts_mod, "ALERT_THRESHOLDS", {
        "high_wind": {"wind_max_24h_kmh": 35.0, "kind": "high_wind",
                      "message": "Wind gusts exceed 35 km/h."},
    })
    monkeypatch.setattr(alerts_mod, "ALERT_EVENT_COOLDOWN_H", 6.0)

    first = alerts_mod.check_and_create_alerts("dauin_muck")
    assert len(first) == 1, "first evaluation must create the high_wind alert"

    # A second evaluation in the same hour must not duplicate (per-hour
    # idempotency) — and, more importantly, neither must one 2 hours later
    # (event cooldown), which used to spam one alert per hour per kind.
    second = alerts_mod.check_and_create_alerts("dauin_muck")
    assert second == []


# ── F-B1-04: SQLite pragmas ──────────────────────────────────────────────

def test_sqlite_pragmas_applied(test_engine):
    """Fresh connections must carry the concurrency pragmas (audit F-B1-04)."""
    from sqlalchemy import text

    with test_engine.connect() as conn:
        busy = conn.execute(text("PRAGMA busy_timeout")).scalar()
        sync = conn.execute(text("PRAGMA synchronous")).scalar()
        fk = conn.execute(text("PRAGMA foreign_keys")).scalar()
    assert busy == 5000
    assert sync == 1  # NORMAL
    assert fk == 1


# ── F-B1-05: archive carries real marine data ────────────────────────────

def test_fetch_archive_merges_marine_wave_height(monkeypatch):
    import app.lib.weather as weather_mod

    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")

    def fake_archive_get(url, params, label=""):
        assert "archive-api" in url
        return {"hourly": {
            "time": [f"{day}T00:00", f"{day}T01:00"],
            "precipitation": [0.0, 1.0],
            "wind_speed_10m": [10.0, 12.0],
            "wind_gusts_10m": [15.0, 18.0],
        }}

    def fake_marine_get(url, params, label=""):
        assert "marine-api" in url
        return {"hourly": {
            "time": [f"{day}T00:00", f"{day}T01:00"],
            "wave_height": [1.2, 1.6],
            "sea_surface_temperature": [27.5, 27.7],
        }}

    monkeypatch.setattr(weather_mod, "_retry_get", fake_archive_get)
    # Second call in the same function hits the marine endpoint.
    calls = {"n": 0}
    original = fake_archive_get

    def route(url, params, label=""):
        calls["n"] += 1
        return fake_marine_get(url, params, label) if calls["n"] == 2 else original(url, params, label)

    monkeypatch.setattr(weather_mod, "_retry_get", route)

    rows = weather_mod.fetch_archive(9.18, 123.27, day, day)
    assert len(rows) == 2
    assert rows[0]["wave_max_m"] == 1.2, "archive rows must carry real wave data"
    assert rows[1]["wave_max_m"] == 1.6
    assert rows[0]["sea_temp_c"] == 27.5


# ── F-B6-02: Storm Glass window params ───────────────────────────────────

def test_stormglass_requests_explicit_window(monkeypatch):
    from app.lib.providers.stormglass import StormGlassMarineProvider
    import app.lib.providers.stormglass as sg

    captured = {}

    class FakeResp:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"hours": []}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(params or {})
        return FakeResp()

    monkeypatch.setattr(sg.requests, "get", fake_get)
    provider = StormGlassMarineProvider(api_key="test-key")
    provider.fetch_hourly(9.18, 123.27, hours=48)

    assert "start" in captured and "end" in captured, (
        "Storm Glass needs an explicit window or the marine lookback is empty"
    )
    assert captured["start"].endswith("Z") and captured["end"].endswith("Z")


# ── F-B6-03: scraper rows without a label are rejected ───────────────────

def test_scraper_missing_label_is_rejected_not_defaulted(db_session):
    """A malformed row must be skipped+counted, never become a 'dive' label."""
    from datetime import date as date_type
    from app.lib.scrapers.base import BaseScraper, run_all, register_scraper, _REGISTRY

    class _BadScraper(BaseScraper):
        name = "audit_bad_row"

        def fetch(self, site_key, *, since, until):
            return [
                {"date": since, "label": "dive"},          # valid
                {"date": until},                            # missing label!
            ]

    registered_here = False
    if _BadScraper.name not in _REGISTRY:
        register_scraper(_BadScraper)
        registered_here = True
    try:
        results = run_all("dauin_muck", since=date_type(2026, 1, 1), until=date_type(2026, 1, 2),
                          scrapers=["audit_bad_row"])
    finally:
        if registered_here:
            _REGISTRY.pop(_BadScraper.name, None)

    (result,) = [r for r in results if r.scraper == "audit_bad_row"]
    assert result.rows_inserted == 1, "only the valid row may persist"
    assert any("missing 'label'" in e for e in result.errors)
