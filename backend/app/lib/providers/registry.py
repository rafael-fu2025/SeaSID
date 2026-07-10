"""
Provider registry — picks a concrete provider per role based on env vars.

Roles:
  - weather:   surface weather (precip, wind, basic waves)
  - marine:    marine augmentation (wave period, swell, currents, water temp)
  - air:       air quality (AQI, PM2.5, PM10, O₃, NO₂)

Selection is per-role so you can mix-and-match:
  SEASID_PROVIDER_WEATHER=open_meteo
  SEASID_PROVIDER_MARINE=stormglass
  SEASID_PROVIDER_AIR=aqicn

Set any role to "off" to disable it entirely.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from app.lib.providers.base import (
    AirQualityProvider,
    MarineProvider,
    ProviderInfo,
    WeatherProvider,
)
from app.lib.providers.open_meteo import (
    OpenMeteoAirProvider,
    OpenMeteoMarineProvider,
    OpenMeteoWeatherProvider,
)
from app.lib.providers.stormglass import StormGlassMarineProvider
from app.lib.providers.aqicn import AqicnAirProvider

logger = logging.getLogger(__name__)


def _select(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip().lower()


def _build_weather(name: str) -> Optional[WeatherProvider]:
    if name in ("", "off", "none"):
        return None
    if name in ("open_meteo", "open-meteo", "default"):
        return OpenMeteoWeatherProvider()
    logger.warning("Unknown weather provider '%s' — falling back to Open-Meteo", name)
    return OpenMeteoWeatherProvider()


def _build_marine(name: str) -> Optional[MarineProvider]:
    if name in ("", "off", "none"):
        return None
    if name == "open_meteo":
        return OpenMeteoMarineProvider()
    if name == "stormglass":
        provider = StormGlassMarineProvider()
        if not provider.api_key:
            logger.warning(
                "SEASID_PROVIDER_MARINE=stormglass but STORMGLASS_API_KEY is empty — "
                "marine provider will return empty data."
            )
        return provider
    logger.warning("Unknown marine provider '%s' — falling back to Open-Meteo Marine", name)
    return OpenMeteoMarineProvider()


def _build_air(name: str) -> Optional[AirQualityProvider]:
    if name in ("", "off", "none"):
        return None
    if name == "aqicn":
        provider = AqicnAirProvider()
        if not provider.api_key:
            logger.warning(
                "SEASID_PROVIDER_AIR=aqicn but AQICN_API_KEY is empty — "
                "air provider will return None."
            )
        return provider
    logger.warning("Unknown air provider '%s' — air data disabled", name)
    return None


# ── Module-level singletons (lazy) ─────────────────────────────────────────
_weather: Optional[WeatherProvider] = None
_marine: Optional[MarineProvider] = None
_air: Optional[AirQualityProvider] = None
_weather_name: Optional[str] = None
_marine_name: Optional[str] = None
_air_name: Optional[str] = None


def get_weather_provider() -> WeatherProvider:
    """Return the configured weather provider (default: Open-Meteo)."""
    global _weather, _weather_name
    name = _select("SEASID_PROVIDER_WEATHER", "open_meteo")
    if _weather is None or name != _weather_name:
        _weather = _build_weather(name)
        _weather_name = name
    if _weather is None:
        # Always have a working default.
        _weather = OpenMeteoWeatherProvider()
    return _weather


def get_marine_provider() -> Optional[MarineProvider]:
    """Return the configured marine provider (may be None if disabled)."""
    global _marine, _marine_name
    name = _select("SEASID_PROVIDER_MARINE", "open_meteo")
    if _marine is None or name != _marine_name:
        _marine = _build_marine(name)
        _marine_name = name
    return _marine


def get_air_provider() -> Optional[AirQualityProvider]:
    """Return the configured air-quality provider (may be None if disabled)."""
    global _air, _air_name
    name = _select("SEASID_PROVIDER_AIR", "off")
    if _air is None or name != _air_name:
        _air = _build_air(name)
        _air_name = name
    return _air


def reset_registry() -> None:
    """Force re-resolution of all providers. Useful for tests."""
    global _weather, _marine, _air, _weather_name, _marine_name, _air_name
    _weather = _marine = _air = None
    _weather_name = _marine_name = _air_name = None


def active_providers() -> dict[str, ProviderInfo]:
    """Return info about which providers are currently configured."""
    out: dict[str, ProviderInfo] = {}
    w = get_weather_provider()
    if w is not None:
        out["weather"] = w.info
    m = get_marine_provider()
    if m is not None:
        out["marine"] = m.info
    a = get_air_provider()
    if a is not None:
        out["air"] = a.info
    return out