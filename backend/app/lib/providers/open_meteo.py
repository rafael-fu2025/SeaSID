"""
Open-Meteo providers — re-export of existing weather.py behavior.

Open-Meteo covers both the weather and marine roles via two hosts:
  - https://api.open-meteo.com/v1/forecast          (surface weather)
  - https://marine-api.open-meteo.com/v1/marine     (wave_height, sea_temp)

We split that into two provider classes so the registry can swap them
independently (e.g. weather from Open-Meteo + marine from Storm Glass).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.lib.providers.base import (
    AirQualityProvider,
    MarineProvider,
    ProviderInfo,
    WeatherProvider,
)
from app.lib.weather import fetch_forecast, fetch_archive

logger = logging.getLogger(__name__)


def _normalize_ts(value) -> datetime:
    """Open-Meteo returns tz-aware UTC datetimes; double-check."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return datetime.fromisoformat(str(value)).replace(tzinfo=timezone.utc)


class OpenMeteoWeatherProvider(WeatherProvider):
    info = ProviderInfo(
        name="open_meteo",
        version="1.0.0",
        requires_key=False,
        description="Open-Meteo Forecast API (free, no key).",
    )

    def fetch_hourly(self, lat: float, lon: float, hours: int = 48) -> list[dict]:
        # Cover as much of the requested window as possible in one call.
        # Open-Meteo's forecast endpoint supports up to ~16 days (384h) total
        # when combining past_hours + forecast_hours, so 7 days (168h) is safe.
        # Cap past_hours at 168 (7d) since the archive endpoint is the right
        # tool for anything older.
        past_hours = min(int(hours), 168)
        forecast_hours = max(1, int(hours) - past_hours)
        rows = fetch_forecast(
            lat, lon,
            past_hours=past_hours,
            forecast_hours=forecast_hours,
        )
        out = []
        for r in rows:
            out.append(
                {
                    "ts": _normalize_ts(r["ts"]),
                    "precip_mm": float(r.get("precip_mm") or 0.0),
                    "wind_max_kmh": float(r.get("wind_max_kmh") or 0.0),
                    "wind_mean_kmh": float(r.get("wind_mean_kmh") or 0.0),
                    "wave_max_m": float(r.get("wave_max_m") or 0.0),
                    "sea_temp_c": r.get("sea_temp_c"),
                    "source": self.info.name,
                }
            )
        return out


class OpenMeteoMarineProvider(MarineProvider):
    """
    Marine-only augmentation from Open-Meteo.

    Open-Meteo's marine endpoint already gives wave_height and
    sea_surface_temperature; we project it into the marine-provider
    shape and fill the remaining fields with None (period / current /
    swell require Storm Glass or similar).
    """

    info = ProviderInfo(
        name="open_meteo_marine",
        version="1.0.0",
        requires_key=False,
        description="Open-Meteo Marine API (wave_height + sea_temp only).",
    )

    def fetch_hourly(self, lat: float, lon: float, hours: int = 48) -> list[dict]:
        past_hours = min(int(hours), 168)
        forecast_hours = max(1, int(hours) - past_hours)
        rows = fetch_forecast(
            lat, lon,
            past_hours=past_hours,
            forecast_hours=forecast_hours,
        )
        out = []
        for r in rows:
            out.append(
                {
                    "ts": _normalize_ts(r["ts"]),
                    "wave_height_m": float(r.get("wave_max_m") or 0.0),
                    "wave_period_s": None,
                    "swell_height_m": None,
                    "swell_direction_deg": None,
                    "water_temp_c": r.get("sea_temp_c"),
                    "current_speed_ms": None,
                    "current_direction_deg": None,
                    "source": self.info.name,
                }
            )
        return out


class OpenMeteoAirProvider(AirQualityProvider):
    """
    Open-Meteo has no air-quality endpoint. This stub returns None so the
    registry can fall through to "no air data" without raising.
    """

    info = ProviderInfo(
        name="open_meteo_air",
        version="1.0.0",
        requires_key=False,
        description="Open-Meteo does not provide air quality; placeholder.",
    )

    def fetch_current(self, lat: float, lon: float) -> dict | None:
        logger.debug("Open-Meteo has no AQI endpoint; returning None")
        return None