"""
Storm Glass marine weather provider.

Docs:   https://docs.stormglass.io/
Auth:   STORMGLASS_API_KEY  (free tier: 50 requests/day, 10/day/hour per IP)
Hourly endpoint:
    GET https://api.stormglass.io/v2/weather/point
        ?lat={lat}&lon={lon}&params=waveHeight,wavePeriod,seaLevel,...

Storm Glass aggregates ~15 global sources (NOAA, Météo-France, DWD, etc.)
and returns per-source values plus a "noaa" consolidated field. We use the
NOAA source by default, falling back to the first non-null per-parameter.

Free tier notes:
  - 50 req/day total; 10/hr
  - cache aggressively on the caller side (SeaSID re-ingests every 6h)
  - if no key is set the provider silently returns []
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

import requests

from app.lib.providers.base import (
    MarineProvider,
    ProviderInfo,
    ProviderError,
)

logger = logging.getLogger(__name__)

STORMGLASS_URL = "https://api.stormglass.io/v2/weather/point"
REQUESTED_PARAMS = (
    "waveHeight",
    "wavePeriod",
    "swellHeight",
    "swellDirection",
    "waterTemperature",
    "currentSpeed",
    "currentDirection",
)
MAX_RETRIES = 3
BACKOFF_SECONDS = [1, 2, 4]
TIMEOUT_SECONDS = 15
DEFAULT_SOURCE = "noaa"


def _pick_value(per_source: dict, fallback_sources: tuple[str, ...] = ("noaa", "sg", "icon", "ecmwf")):
    """Storm Glass returns {param: {source: value, ...}}; pick the preferred source."""
    if not isinstance(per_source, dict):
        return None
    for src in fallback_sources:
        v = per_source.get(src)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    # last resort: any numeric value
    for v in per_source.values():
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


class StormGlassMarineProvider(MarineProvider):
    info = ProviderInfo(
        name="stormglass",
        version="1.0.0",
        requires_key=True,
        description="Storm Glass marine forecast (wave, swell, currents, water temp).",
    )

    def __init__(self, api_key: str | None = None):
        self.api_key = (api_key or os.getenv("STORMGLASS_API_KEY", "")).strip()

    def fetch_hourly(self, lat: float, lon: float, hours: int = 48) -> list[dict]:
        if not self.api_key:
            logger.warning("STORMGLASS_API_KEY not set — returning empty marine data")
            return []

        params = {
            "lat": lat,
            "lng": lon,  # Storm Glass uses `lng`, not `lon` (verified via 422 error)
            "params": ",".join(REQUESTED_PARAMS),
            # Hourly granularity, no minutely. Default is 1h step.
        }

        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(
                    STORMGLASS_URL,
                    params=params,
                    headers={"Authorization": self.api_key},
                    timeout=TIMEOUT_SECONDS,
                )
                if resp.status_code == 429:
                    # Rate-limited — back off harder.
                    wait = BACKOFF_SECONDS[attempt] * 3
                    logger.warning("StormGlass 429 — sleeping %ds", wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except (requests.RequestException, ValueError) as exc:
                last_exc = exc
                wait = BACKOFF_SECONDS[attempt] if attempt < len(BACKOFF_SECONDS) else 4
                logger.warning(
                    "StormGlass attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    exc,
                    wait,
                )
                time.sleep(wait)
        else:
            logger.error("StormGlass: all %d attempts failed: %s", MAX_RETRIES, last_exc)
            return []

        hours_data = data.get("hours", [])
        rows: list[dict] = []
        for h in hours_data:
            try:
                ts = datetime.fromisoformat(h["time"].replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            except (KeyError, ValueError) as exc:
                logger.warning("StormGlass: bad timestamp in payload: %s", exc)
                continue

            rows.append(
                {
                    "ts": ts.astimezone(timezone.utc),
                    "wave_height_m": _pick_value(h.get("waveHeight", {})),
                    "wave_period_s": _pick_value(h.get("wavePeriod", {})),
                    "swell_height_m": _pick_value(h.get("swellHeight", {})),
                    "swell_direction_deg": _pick_value(h.get("swellDirection", {})),
                    "water_temp_c": _pick_value(h.get("waterTemperature", {})),
                    "current_speed_ms": _pick_value(h.get("currentSpeed", {})),
                    "current_direction_deg": _pick_value(h.get("currentDirection", {})),
                    "source": self.info.name,
                }
            )

        logger.info("Fetched %d marine hours from StormGlass for (%.4f, %.4f)", len(rows), lat, lon)
        return rows