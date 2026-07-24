"""
AQICN (World Air Quality Index) provider.

Docs:   https://aqicn.org/json-api/doc/
Auth:   encrypted SeaSID database key (free tier: 1000 calls/day, 1 call/sec)
Endpoint:
    GET https://api.waqi.info/feed/geo:{lat};{lon}/?token={key}

Returns the nearest station's real-time AQI plus per-pollutant breakdown
(PM2.5, PM10, O₃, NO₂, …) and a daily forecast.

If no API key is set the provider returns None and logs a warning.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any

import requests

from app.lib.providers.base import AirQualityProvider, ProviderInfo

logger = logging.getLogger(__name__)

AQICN_URL = "https://api.waqi.info/feed/geo:{lat};{lon}/"
TIMEOUT_SECONDS = 15
MAX_RETRIES = 3
BACKOFF_SECONDS = [1, 2, 4]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    r = 6371.0  # Earth radius in km
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _distance_quality(km: float | None) -> str:
    """Bucket a station's distance from the site into a qualitative label.

    The buckets are intentionally conservative — AQICN's free tier returns
    whichever global station is closest, which can easily be hundreds of km
    away for remote coastal sites like Dauin / Apo Island.
    """
    if km is None:
        return "unknown"
    if km < 25:
        return "local"
    if km < 100:
        return "regional"
    if km < 500:
        return "distant"
    return "very_distant"


def _extract_iaqi(iaqi: dict[str, Any] | None, key: str) -> float | None:
    """Extract a pollutant value from the AQICN `iaqi` block."""
    if not isinstance(iaqi, dict):
        return None
    node = iaqi.get(key)
    if not isinstance(node, dict):
        return None
    v = node.get("v")
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class AqicnAirProvider(AirQualityProvider):
    info = ProviderInfo(
        name="aqicn",
        version="1.0.0",
        requires_key=True,
        description="World Air Quality Index project (real-time AQI + per-pollutant breakdown).",
    )

    def __init__(self, api_key: str | None = None):
        if api_key:
            self.api_key = api_key.strip()
        else:
            self.api_key = ""
            try:
                from app.lib import provider_keys as _pk
                record = _pk.resolve_provider_value("aqicn")
                if record is not None:
                    self.api_key = record.value
            except Exception:
                pass

    def fetch_current(self, lat: float, lon: float) -> dict | None:
        if not self.api_key:
            logger.warning("No enabled AQICN database key — returning no air-quality data")
            return None

        url = AQICN_URL.format(lat=lat, lon=lon)
        params = {"token": self.api_key}

        # AQICN free tier returns whatever global station is closest.
        # For remote coastal sites this can easily be hundreds of km away.
        # We compute the great-circle distance so callers can warn the user.
        self._last_request_lat = lat
        self._last_request_lon = lon

        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(url, params=params, timeout=TIMEOUT_SECONDS)
                if resp.status_code == 429:
                    wait = BACKOFF_SECONDS[attempt] * 2
                    logger.warning("AQICN 429 — sleeping %ds", wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                payload = resp.json()
                break
            except (requests.RequestException, ValueError) as exc:
                last_exc = exc
                wait = BACKOFF_SECONDS[attempt] if attempt < len(BACKOFF_SECONDS) else 4
                logger.warning(
                    "AQICN attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    exc,
                    wait,
                )
                time.sleep(wait)
        else:
            logger.error("AQICN: all %d attempts failed: %s", MAX_RETRIES, last_exc)
            return None

        if payload.get("status") != "ok":
            logger.warning("AQICN returned status=%s: %s", payload.get("status"), payload.get("message"))
            return None

        data = payload.get("data") or {}
        aqi_raw = data.get("aqi")
        if aqi_raw is None or aqi_raw in ("-", ""):
            return None

        try:
            aqi = float(aqi_raw)
        except (TypeError, ValueError):
            return None

        iaqi = data.get("iaqi", {}) or {}
        time_node = data.get("time", {}) or {}
        iso_ts = time_node.get("iso") or time_node.get("s")
        if iso_ts:
            try:
                ts = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                ts = datetime.now(timezone.utc)
        else:
            ts = datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        city = data.get("city", {}) or {}

        # Parse the station's coordinates from the response (AQICN returns
        # them as a [lat, lon] list under city.geo).
        station_lat: float | None = None
        station_lon: float | None = None
        distance_km: float | None = None
        quality: str = "unknown"
        geo = city.get("geo")
        if isinstance(geo, list) and len(geo) >= 2:
            try:
                station_lat = float(geo[0])
                station_lon = float(geo[1])
                distance_km = round(
                    _haversine_km(lat, lon, station_lat, station_lon), 1
                )
                quality = _distance_quality(distance_km)
            except (TypeError, ValueError):
                pass

        if quality in ("distant", "very_distant"):
            logger.warning(
                "AQICN: nearest station '%s' is %.1f km from site "
                "(%s, %s) — treat as regional background only.",
                city.get("name"), distance_km, lat, lon,
            )

        return {
            "ts": ts.astimezone(timezone.utc),
            "aqi": aqi,
            "pm25": _extract_iaqi(iaqi, "pm25"),
            "pm10": _extract_iaqi(iaqi, "pm10"),
            "o3": _extract_iaqi(iaqi, "o3"),
            "no2": _extract_iaqi(iaqi, "no2"),
            "station_id": data.get("idx"),
            "station_name": city.get("name"),
            "station_lat": station_lat,
            "station_lon": station_lon,
            "distance_km": distance_km,
            "quality": quality,
            "source": self.info.name,
        }
