"""
Tests for the weather provider registry and the extended 14-feature vector.

These tests stub out all network calls and verify:
  - The registry resolves correctly per env var.
  - Storm Glass + AQICN gracefully no-op when no key is set.
  - The feature builder emits exactly len(FEATURE_COLUMNS) values.
  - Existing 11-feature contracts are unchanged in value (positions 0-10).
  - The new marine/air fetchers return the expected DataFrame schema.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest


# ── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture
def seeded_air(monkeypatch):
    """Insert one AQICN-like snapshot."""
    from app.lib import db as db_mod
    session = db_mod.SessionLocal()
    try:
        session.add(db_mod.AirQualityObs(
            site_key="dauin_muck",
            ts=datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
            aqi=72.0,
            pm25=22.5,
            pm10=40.0,
            o3=33.0,
            no2=8.0,
            station_id=1234,
            station_name="Dauin Test Station",
            source="aqicn",
        ))
        session.commit()
    finally:
        session.close()


@pytest.fixture
def seeded_marine(monkeypatch):
    """Insert 24 hours of synthetic marine data."""
    from app.lib import db as db_mod
    rng = np.random.RandomState(123)
    base = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    session = db_mod.SessionLocal()
    try:
        for h in range(24):
            session.add(db_mod.MarineObs(
                site_key="dauin_muck",
                ts=base - timedelta(hours=23 - h),
                wave_height_m=0.8 + rng.normal(0, 0.2),
                wave_period_s=6.5 + rng.normal(0, 0.5),
                swell_height_m=0.5 + rng.normal(0, 0.1),
                swell_direction_deg=180.0,
                water_temp_c=28.0,
                current_speed_ms=0.3,
                current_direction_deg=90.0,
                source="open_meteo_marine",
            ))
        session.commit()
    finally:
        session.close()


# ── Provider construction ─────────────────────────────────────────────────

def test_open_meteo_weather_is_default(monkeypatch):
    """Without env overrides, Open-Meteo is the weather provider."""
    monkeypatch.delenv("SEASID_PROVIDER_WEATHER", raising=False)
    monkeypatch.delenv("SEASID_PROVIDER_MARINE", raising=False)
    monkeypatch.delenv("SEASID_PROVIDER_AIR", raising=False)

    from app.lib.providers import get_weather_provider, get_marine_provider, get_air_provider
    from app.lib.providers.open_meteo import (
        OpenMeteoWeatherProvider,
        OpenMeteoMarineProvider,
    )

    w = get_weather_provider()
    m = get_marine_provider()
    a = get_air_provider()

    assert isinstance(w, OpenMeteoWeatherProvider)
    assert isinstance(m, OpenMeteoMarineProvider)
    assert a is None


def test_stormglass_provider_no_key_returns_empty(monkeypatch):
    """Storm Glass without an API key returns [] and logs a warning."""
    monkeypatch.setenv("SEASID_PROVIDER_MARINE", "stormglass")
    monkeypatch.delenv("STORMGLASS_API_KEY", raising=False)
    from app.lib.providers import reset_registry, get_marine_provider
    reset_registry()

    provider = get_marine_provider()
    assert provider is not None
    assert provider.info.name == "stormglass"

    rows = provider.fetch_hourly(9.18, 123.27, hours=48)
    assert rows == []


def test_aqicn_provider_no_key_returns_none(monkeypatch):
    """AQICN without an API key returns None for fetch_current."""
    monkeypatch.setenv("SEASID_PROVIDER_AIR", "aqicn")
    monkeypatch.delenv("AQICN_API_KEY", raising=False)
    from app.lib.providers import reset_registry, get_air_provider
    reset_registry()

    provider = get_air_provider()
    assert provider is not None
    assert provider.info.name == "aqicn"

    snap = provider.fetch_current(9.18, 123.27)
    assert snap is None


def test_air_provider_disabled_when_off(monkeypatch):
    """SEASID_PROVIDER_AIR=off returns None."""
    monkeypatch.setenv("SEASID_PROVIDER_AIR", "off")
    from app.lib.providers import reset_registry, get_air_provider
    reset_registry()
    assert get_air_provider() is None


def test_registry_unknown_provider_falls_back(monkeypatch):
    """Unknown provider name falls back to Open-Meteo."""
    monkeypatch.setenv("SEASID_PROVIDER_WEATHER", "nope-not-real")
    from app.lib.providers import reset_registry, get_weather_provider
    reset_registry()
    p = get_weather_provider()
    assert p.info.name == "open_meteo"


# ── Feature vector: 11 → 14 ───────────────────────────────────────────────

def test_feature_columns_count_is_14():
    from app.lib.features import FEATURE_COLUMNS
    assert len(FEATURE_COLUMNS) == 14


def test_feature_columns_have_expected_new_names():
    from app.lib.features import FEATURE_COLUMNS
    assert "aqi_recent" in FEATURE_COLUMNS
    assert "pm25_recent" in FEATURE_COLUMNS
    assert "wave_period_s_mean" in FEATURE_COLUMNS


def test_compute_features_emits_14_values_with_defaults(seeded_weather):
    """Without marine/air data, defaults are used for cols 12-14."""
    from app.lib.features import _compute_features, FEATURE_COLUMNS

    _, rows = seeded_weather
    weather_df = pd.DataFrame([{
        "ts": r.ts,
        "precip_mm": r.precip_mm or 0.0,
        "wind_max_kmh": r.wind_max_kmh or 0.0,
        "wind_mean_kmh": r.wind_mean_kmh or 0.0,
        "wave_max_m": r.wave_max_m or 0.0,
        "sea_temp_c": r.sea_temp_c,
    } for r in rows])
    tide_df = pd.DataFrame(columns=["ts", "height_m"])
    target_ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)

    feats = _compute_features(weather_df, tide_df, "dauin_muck", target_ts)

    assert len(feats) == len(FEATURE_COLUMNS) == 14
    # Defaults when no air data
    assert feats[11] == 30.0    # aqi_recent
    assert feats[12] == 8.0     # pm25_recent
    # Defaults when no marine data
    assert feats[13] == 6.0     # wave_period_s_mean


def test_compute_features_uses_air_snapshot(seeded_weather, seeded_air):
    """When an AirQualityObs row exists, it overrides the AQI/PM2.5 defaults."""
    from app.lib.features import _compute_features, _fetch_air_snapshot

    _, rows = seeded_weather
    weather_df = pd.DataFrame([{
        "ts": r.ts,
        "precip_mm": r.precip_mm or 0.0,
        "wind_max_kmh": r.wind_max_kmh or 0.0,
        "wind_mean_kmh": r.wind_mean_kmh or 0.0,
        "wave_max_m": r.wave_max_m or 0.0,
        "sea_temp_c": r.sea_temp_c,
    } for r in rows])
    tide_df = pd.DataFrame(columns=["ts", "height_m"])
    target_ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)

    snap = _fetch_air_snapshot("dauin_muck", target_ts)
    assert snap is not None
    assert snap["aqi"] == pytest.approx(72.0)

    feats = _compute_features(weather_df, tide_df, "dauin_muck", target_ts, air_snapshot=snap)
    assert feats[11] == pytest.approx(72.0)   # aqi_recent
    assert feats[12] == pytest.approx(22.5)   # pm25_recent


def test_compute_features_uses_marine_window(seeded_weather, seeded_marine):
    """When a MarineObs window exists, wave_period_s_mean is averaged from it."""
    from app.lib.features import _compute_features, _fetch_marine_window

    _, rows = seeded_weather
    weather_df = pd.DataFrame([{
        "ts": r.ts,
        "precip_mm": r.precip_mm or 0.0,
        "wind_max_kmh": r.wind_max_kmh or 0.0,
        "wind_mean_kmh": r.wind_mean_kmh or 0.0,
        "wave_max_m": r.wave_max_m or 0.0,
        "sea_temp_c": r.sea_temp_c,
    } for r in rows])
    tide_df = pd.DataFrame(columns=["ts", "height_m"])
    target_ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)

    marine_df = _fetch_marine_window("dauin_muck", target_ts, hours=24)
    assert len(marine_df) == 24

    feats = _compute_features(
        weather_df, tide_df, "dauin_muck", target_ts, marine_24h=marine_df
    )
    # mean of ~6.5 ± noise — should be in (5.0, 8.0)
    assert 5.0 < feats[13] < 8.0


def test_legacy_eleven_feature_positions_unchanged(seeded_weather):
    """The first 11 values must match the legacy contract names."""
    from app.lib.features import FEATURE_COLUMNS

    legacy_names = [
        "precip_24h_mm", "precip_48h_mm", "precip_recent_3h",
        "wind_max_24h_kmh", "wind_mean_24h_kmh",
        "wave_max_24h_m", "sea_temp_mean_24h",
        "tide_max_24h_m", "tide_min_24h_m", "tide_range_24h_m",
        "is_muck_site",
    ]
    assert FEATURE_COLUMNS[:11] == legacy_names


# ── DB schema additions ────────────────────────────────────────────────────

def test_marine_obs_and_air_quality_obs_tables_exist():
    """Both new tables should be created by init_db."""
    from app.lib import db as db_mod
    from sqlalchemy import inspect
    inspector = inspect(db_mod.engine)
    tables = inspector.get_table_names()
    assert "marine_obs" in tables
    assert "air_quality_obs" in tables


def test_weather_obs_has_source_column():
    from app.lib import db as db_mod
    from sqlalchemy import inspect
    cols = {c["name"] for c in inspect(db_mod.engine).get_columns("weather_obs")}
    assert "source" in cols


# ── AQICN distance / opt-out ────────────────────────────────────────────────

def test_aqicn_haversine_zero_for_same_point():
    from app.lib.providers.aqicn import _haversine_km
    assert _haversine_km(9.1844, 123.2678, 9.1844, 123.2678) == pytest.approx(0.0, abs=1e-3)


def test_aqicn_haversine_dauin_to_sandakan_is_distant():
    """Dauin (9.18, 123.27) to Sandakan (5.86, 118.09) is ~ 620 km."""
    from app.lib.providers.aqicn import _haversine_km
    km = _haversine_km(9.1844, 123.2678, 5.864, 118.091)
    assert 580 < km < 700


def test_aqicn_distance_quality_buckets():
    from app.lib.providers.aqicn import _distance_quality
    assert _distance_quality(5) == "local"
    assert _distance_quality(50) == "regional"
    assert _distance_quality(250) == "distant"
    assert _distance_quality(2000) == "very_distant"
    assert _distance_quality(None) == "unknown"


def test_dauin_site_has_air_provider_disabled(monkeypatch):
    """Both anchor sites default to air_provider_disabled=True.

    The free AQICN tier has no nearby station for the Dauin coast (the nearest
    is Sandakan at ~1100 km). The opt-out flag suppresses air ingestion and
    the get_air_quality agent tool response.
    """
    from app.lib.sites import get_site
    site = get_site("dauin_muck")
    assert site is not None
    assert site.get("air_provider_disabled") is True


def test_get_air_quality_handler_disabled_for_site(monkeypatch):
    """When a site has air_provider_disabled, the agent tool returns a polite
    'not available' response instead of trying to fetch distant data."""
    from app.lib.agent_tools import get_air_quality_handler
    result = json.loads(get_air_quality_handler("dauin_muck"))
    assert result["available"] is False
    assert result["reason"] == "disabled_for_site"


def test_get_air_quality_handler_unknown_site():
    from app.lib.agent_tools import get_air_quality_handler
    result = json.loads(get_air_quality_handler("not_a_site"))
    assert "error" in result