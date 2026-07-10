"""
Weather/marine/air-quality provider registry.

A "provider" is any external service that returns environmental observations.
SeaSID ships with three:

  - Open-Meteo (free, no key, primary — see backend/app/lib/weather.py)
  - Storm Glass  (optional, marine-augmented)
  - AQICN        (optional, air quality)

Providers are selected at runtime via environment variables:

  SEASID_PROVIDER_WEATHER=open_meteo          # default
  SEASID_PROVIDER_MARINE=open_meteo           # default; set to "stormglass" to enable
  SEASID_PROVIDER_AIR=off                     # default; set to "aqicn" to enable

API keys (when required):
  STORMGLASS_API_KEY=...
  AQICN_API_KEY=...
"""

from app.lib.providers.base import (
    ProviderInfo,
    WeatherProvider,
    MarineProvider,
    AirQualityProvider,
    ProviderError,
)
from app.lib.providers.registry import (
    get_weather_provider,
    get_marine_provider,
    get_air_provider,
    reset_registry,
    active_providers,
)

__all__ = [
    "ProviderInfo",
    "WeatherProvider",
    "MarineProvider",
    "AirQualityProvider",
    "ProviderError",
    "get_weather_provider",
    "get_marine_provider",
    "get_air_provider",
    "reset_registry",
    "active_providers",
]