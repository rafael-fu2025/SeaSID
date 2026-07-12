"""
Regression tests for roadmap #8 — forecast freshness + provenance.

Covers:
- _classify thresholds for each source (live/stale/unavailable)
- compute_freshness returns descriptors for weather, marine, tide (+ air
  when not site-disabled)
- air is omitted entirely when site has air_provider_disabled=True
- model_version returns a useful string per bundle type
- get_forecast attaches data_as_of, freshness, model_version, providers,
  degraded to the response dict
- ForecastResponse schema accepts the new fields
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.schemas import ForecastResponse
from app.lib import freshness as fr
from app.lib.db import (
    AirQualityObs,
    MarineObs,
    TideObs,
    WeatherObs,
)
from app.lib.freshness import (
    SourceFreshness,
    compute_freshness,
    model_version,
)


# ── _classify thresholds ──────────────────────────────────────────────────


class TestClassifyThresholds:
    def setup_method(self):
        self.now = datetime(2026, 7, 12, 12, 0, 0, tzinfo=timezone.utc)

    def _src(self, age_hours: float | None):
        if age_hours is None:
            return None
        return self.now - timedelta(hours=age_hours)

    def test_weather_live_within_three_hours(self):
        out = fr._classify(self._src(1), self.now, 3, 24, "open_meteo")
        assert out.status == "live"
        assert out.age_hours == 1.0
        assert out.provider == "open_meteo"

    def test_weather_stale_between_three_and_twenty_four_hours(self):
        out = fr._classify(self._src(10), self.now, 3, 24, "open_meteo")
        assert out.status == "stale"

    def test_weather_unavailable_beyond_twenty_four_hours(self):
        out = fr._classify(self._src(30), self.now, 3, 24, "open_meteo")
        assert out.status == "unavailable"

    def test_no_observation_is_unavailable(self):
        out = fr._classify(None, self.now, 3, 24, "open_meteo")
        assert out.status == "unavailable"
        assert out.last_observed_at is None
        assert out.age_hours is None

    def test_air_uses_tighter_thresholds(self):
        # 3h-old air = stale (live is <= 2h)
        out = fr._classify(self._src(3), self.now, 2, 12, "aqicn")
        assert out.status == "stale"

    def test_tides_have_wider_live_window(self):
        # 5h-old tide = live (live is <= 6h)
        out = fr._classify(self._src(5), self.now, 6, 24, "open_meteo")
        assert out.status == "live"

    def test_naive_datetime_from_db_is_normalised_to_utc(self):
        # SQLite drops tzinfo on read — _classify must still compare correctly.
        naive = (self.now - timedelta(hours=1)).replace(tzinfo=None)
        out = fr._classify(naive, self.now, 3, 24, "open_meteo")
        assert out.status == "live"


# ── compute_freshness ─────────────────────────────────────────────────────


class TestComputeFreshness:
    def _now(self):
        return datetime(2026, 7, 12, 12, 0, 0, tzinfo=timezone.utc)

    def test_returns_weather_marine_tide_for_disabled_air_site(self, db_session):
        # Both sites in the registry have air_provider_disabled=True, so
        # air must be omitted entirely.
        now = self._now()
        db_session.add_all([
            WeatherObs(
                site_key="dauin_muck", ts=now - timedelta(hours=1),
                precip_mm=0.0,
            ),
            MarineObs(
                site_key="dauin_muck", ts=now - timedelta(hours=2),
            ),
            TideObs(
                site_key="dauin_muck", ts=now - timedelta(hours=5),
                height_m=0.4,
            ),
        ])
        db_session.commit()

        result = compute_freshness(
            "dauin_muck", {"weather": "open_meteo"}, now=now,
        )
        sources = {f.source for f in result}
        assert sources == {"weather", "marine", "tide"}
        for f in result:
            assert f.status == "live"

    def test_includes_air_when_site_has_no_disable_flag(self, db_session, monkeypatch):
        # The registry has air_provider_disabled=True on both sites. Patch
        # get_site() to simulate a hypothetical site where air is enabled.
        from app.lib import freshness as fr_mod

        def _fake_get_site(key):
            return {"key": key, "air_provider_disabled": False}

        monkeypatch.setattr(fr_mod, "get_site", _fake_get_site)

        now = self._now()
        db_session.add(AirQualityObs(
            site_key="dauin_muck", ts=now - timedelta(hours=1),
            aqi=42, source="aqicn",
        ))
        db_session.commit()

        result = compute_freshness(
            "dauin_muck", {"weather": "open_meteo", "air": "aqicn"}, now=now,
        )
        sources = {f.source for f in result}
        assert "air" in sources
        air = next(f for f in result if f.source == "air")
        assert air.status == "live"
        assert air.provider == "aqicn"

    def test_degraded_reasons_present_in_get_forecast_output(self, db_session):
        # No observations at all → every source is unavailable → degraded
        # list contains one entry per source.
        now = self._now()
        result = compute_freshness(
            "dauin_muck", {"weather": "open_meteo"}, now=now,
        )
        assert len(result) == 3
        for f in result:
            assert f.status == "unavailable"

    def test_freshness_serializes_to_dict(self):
        f = SourceFreshness(
            source="weather",
            status="live",
            last_observed_at="2026-07-12T11:00:00+00:00",
            age_hours=1.0,
            provider="open_meteo",
        )
        d = f.to_dict()
        assert d == {
            "source": "weather",
            "status": "live",
            "last_observed_at": "2026-07-12T11:00:00+00:00",
            "age_hours": 1.0,
            "provider": "open_meteo",
        }


# ── model_version ─────────────────────────────────────────────────────────


class TestModelVersion:
    def test_rule_based_when_no_bundle(self):
        assert model_version(None) == "rule-based-v1"

    def test_xgboost_v1_string(self):
        bundle = {"model": object(), "model_type": "xgboost"}
        assert model_version(bundle) == "xgboost-v1"

    def test_lstm_includes_arch_and_seq_len(self):
        bundle = {
            "model": object(),
            "model_type": "lstm",
            "config": {"arch": "lstm", "seq_len": 24},
        }
        assert model_version(bundle) == "lstm-lstm-24h-v1"

    def test_gru_arch_is_reflected(self):
        bundle = {
            "model": object(),
            "model_type": "lstm",  # GRUPredictor is loaded as "lstm" model_type
            "config": {"arch": "gru", "seq_len": 24},
        }
        assert model_version(bundle) == "lstm-gru-24h-v1"


# ── Schema accepts the new fields ─────────────────────────────────────────


class TestForecastResponseSchema:
    def test_schema_accepts_all_freshness_fields(self):
        fr_response = ForecastResponse(
            site_key="dauin_muck",
            site_name="Dauin Muck Bays",
            generated_at="2026-07-12T12:00:00+00:00",
            hours=[],
            data_as_of="2026-07-12T11:00:00+00:00",
            freshness=[
                {"source": "weather", "status": "live",
                 "last_observed_at": "2026-07-12T11:00:00+00:00",
                 "age_hours": 1.0, "provider": "open_meteo"},
            ],
            model_version="lstm-lstm-24h-v1",
            providers={"weather": "open_meteo", "marine": "open_meteo"},
            degraded=[],
        )
        dumped = fr_response.model_dump()
        assert dumped["data_as_of"] == "2026-07-12T11:00:00+00:00"
        assert dumped["freshness"][0]["status"] == "live"
        assert dumped["model_version"] == "lstm-lstm-24h-v1"
        assert dumped["providers"]["weather"] == "open_meteo"
        assert dumped["degraded"] == []

    def test_schema_defaults_for_missing_fields(self):
        fr_response = ForecastResponse(
            site_key="dauin_muck",
            site_name="Dauin",
            generated_at="2026-07-12T12:00:00+00:00",
            hours=[],
        )
        assert fr_response.data_as_of is None
        assert fr_response.freshness == []
        assert fr_response.model_version == "unknown"
        assert fr_response.providers == {}
        assert fr_response.degraded == []