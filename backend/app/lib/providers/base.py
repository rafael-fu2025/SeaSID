"""
Abstract provider interfaces for environmental data sources.

Each provider returns a list of normalized observation dicts. SeaSID's
ingest layer is responsible for persisting them into the right tables.

All providers MUST:
  - Be tolerant of missing API keys (return [] and log a warning)
  - Never raise on transient HTTP errors (retry-then-swallow)
  - Return timestamps as tz-aware UTC datetimes
  - Return numbers in SeaSID's canonical units:
        precip       -> mm
        wind_speed   -> km/h
        wind_gust    -> km/h
        wave_height  -> m
        wave_period  -> seconds
        sea_temp     -> °C
        aqi          -> unitless AQI index (0..500)
        pm2_5/pm10   -> µg/m³
        o3/no2       -> µg/m³
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ProviderInfo:
    name: str
    version: str = "1.0.0"
    requires_key: bool = False
    description: str = ""


class ProviderError(RuntimeError):
    """Raised when a provider fails in a way that callers should surface."""


class WeatherProvider(ABC):
    """Hourly surface weather: precip, wind, optional sea-state."""

    info: ProviderInfo

    @abstractmethod
    def fetch_hourly(self, lat: float, lon: float, hours: int = 48) -> list[dict]:
        """
        Return a list of observation dicts with keys:
            ts (datetime UTC),
            precip_mm (float),
            wind_max_kmh (float),
            wind_mean_kmh (float),
            wave_max_m (float | None),
            sea_temp_c (float | None),
            source (str),
        """


class MarineProvider(ABC):
    """Marine-only augmentation: waves, swell, currents, water temp."""

    info: ProviderInfo

    @abstractmethod
    def fetch_hourly(self, lat: float, lon: float, hours: int = 48) -> list[dict]:
        """
        Return a list of observation dicts with keys:
            ts (datetime UTC),
            wave_height_m (float),
            wave_period_s (float | None),
            swell_height_m (float | None),
            swell_direction_deg (float | None),
            water_temp_c (float | None),
            current_speed_ms (float | None),
            current_direction_deg (float | None),
            source (str),
        """


class AirQualityProvider(ABC):
    """Hourly air-quality snapshots: AQI, PM2.5, PM10, O₃, NO₂."""

    info: ProviderInfo

    @abstractmethod
    def fetch_current(self, lat: float, lon: float) -> dict | None:
        """
        Return a single current snapshot:
            {
                "ts": datetime UTC,
                "aqi": float,
                "pm25": float | None,
                "pm10": float | None,
                "o3": float | None,
                "no2": float | None,
                "station_id": int | None,
                "station_name": str | None,
                "source": str,
            }
        Returns None if no data is available.
        """