"""
WorldTides client for hourly tide heights.

Reads a rotating encrypted key from the SeaSID database. If missing or request fails,
returns empty list and logs a warning — never raises.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

WORLDTIDES_URL = "https://www.worldtides.info/api/v3"
MAX_RETRIES = 2
BACKOFF_SECONDS = [1, 2]


def fetch_tides(lat: float, lon: float, length_seconds: int = 86400) -> list[dict]:
    """
    Fetch hourly tide heights for a location.

    Returns a list of dicts with keys: ts (datetime), height_m (float).
    Returns empty list if API key is missing or request fails.
    """
    api_key = ""
    try:
        from app.lib import provider_keys as _pk
        key_record = _pk.resolve_provider_value("tides")
        if key_record is not None:
            api_key = key_record.value
    except Exception:
        pass
    if not api_key:
        logger.warning("No enabled WorldTides database key — tide data will be zeros")
        return []

    params = {
        "heights": "",
        "lat": lat,
        "lon": lon,
        "length": length_seconds,
        "step": 3600,
        "datum": "MSL",
        "key": api_key,
    }

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(WORLDTIDES_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            if "error" in data:
                logger.warning("WorldTides API error: %s", data["error"])
                return []

            heights = data.get("heights", [])
            rows = []
            for h in heights:
                rows.append({
                    "ts": datetime.fromtimestamp(h["dt"], tz=timezone.utc),
                    "height_m": float(h.get("height", 0.0)),
                })

            logger.info("Fetched %d tide observations for (%.4f, %.4f)", len(rows), lat, lon)
            return rows

        except (requests.RequestException, ValueError, KeyError) as exc:
            wait = BACKOFF_SECONDS[attempt] if attempt < len(BACKOFF_SECONDS) else 2
            logger.warning(
                "WorldTides attempt %d/%d failed: %s — retrying in %ds",
                attempt + 1, MAX_RETRIES, exc, wait,
            )
            time.sleep(wait)

    logger.error("WorldTides: all attempts failed — tide data will be zeros")
    return []


def tides_enabled() -> bool:
    """Check whether the WorldTides provider has an enabled database key."""
    try:
        from app.lib import provider_keys as _pk
        if _pk.resolve_provider_value("tides") is not None:
            return True
    except Exception:
        pass
    return False
