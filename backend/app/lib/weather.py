"""
Open-Meteo weather client with retry, fallback, and archive support.

Endpoints used:
  - Forecast: https://api.open-meteo.com/v1/forecast
  - Marine:   https://marine-api.open-meteo.com/v1/marine
  - Archive:  https://archive-api.open-meteo.com/v1/archive
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

logger = logging.getLogger(__name__)

# ── Retry config ───────────────────────────────────────────────────────────
MAX_RETRIES = 3
BACKOFF_SECONDS = [1, 2, 4]


def _retry_get(url: str, params: dict, label: str = "") -> dict | None:
    """GET with exponential backoff. Returns JSON dict or None on total failure."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            wait = BACKOFF_SECONDS[attempt] if attempt < len(BACKOFF_SECONDS) else 4
            logger.warning(
                "%s attempt %d/%d failed: %s — retrying in %ds",
                label, attempt + 1, MAX_RETRIES, exc, wait,
            )
            time.sleep(wait)
    logger.error("%s: all %d attempts failed", label, MAX_RETRIES)
    return None


# ── Forecast (live, next 48h) ──────────────────────────────────────────────
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"


def fetch_forecast(
    lat: float,
    lon: float,
    past_hours: int = 0,
    forecast_hours: int = 48,
) -> list[dict]:
    """
    Pull hourly forecast from Open-Meteo, covering a precise hour-aligned window.

    Window returned: ``[now - past_hours, now + forecast_hours)`` continuous,
    no day-boundary truncation. Replaces the older ``forecast_days`` parameter
    which silently truncated to ``[today 00:00 UTC, ...]`` and produced rows
    that were "past today" mixed with "future today" — making lookback queries
    in the dashboard return empty DataFrames for any hour outside today's
    daylight.

    Args:
        lat, lon: site coordinates.
        past_hours: how many hours before "now" to include (0 = forecast only).
        forecast_hours: how many hours after "now" to include (default 48).

    Returns:
        List of dicts (one per hour) with keys:
        ts, precip_mm, wind_max_kmh, wind_mean_kmh, wave_max_m, sea_temp_c
        Falls back to synthetic data if the API is unreachable.
    """
    past_hours = max(0, int(past_hours))
    forecast_hours = max(1, int(forecast_hours))

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation,wind_speed_10m,wind_gusts_10m",
        "past_hours": past_hours,
        "forecast_hours": forecast_hours,
        "timezone": "UTC",
    }
    data = _retry_get(FORECAST_URL, params, label="Open-Meteo Forecast")

    # Try marine endpoint for wave_height + sea_surface_temperature
    marine_params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "wave_height,sea_surface_temperature",
        "past_hours": past_hours,
        "forecast_hours": forecast_hours,
        "timezone": "UTC",
    }
    marine_data = _retry_get(MARINE_URL, marine_params, label="Open-Meteo Marine")

    if data is None:
        logger.warning("Forecast API failed — using synthetic fallback")
        return _synthetic_forecast(lat, lon, past_hours, forecast_hours)

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    wind_speed = hourly.get("wind_speed_10m", [])
    wind_gusts = hourly.get("wind_gusts_10m", [])

    # Marine data (may be None)
    marine_hourly = (marine_data or {}).get("hourly", {})
    wave_height = marine_hourly.get("wave_height", [])
    sea_temp = marine_hourly.get("sea_surface_temperature", [])

    rows = []
    for i, t in enumerate(times):
        rows.append({
            "ts": datetime.fromisoformat(t).replace(tzinfo=timezone.utc),
            "precip_mm": _safe_float(precip, i),
            "wind_max_kmh": _safe_float(wind_gusts, i),
            "wind_mean_kmh": _safe_float(wind_speed, i),
            "wave_max_m": _safe_float(wave_height, i),
            "sea_temp_c": _safe_float(sea_temp, i, default=None),
        })

    logger.info(
        "Fetched %d forecast hours for (%.4f, %.4f): past=%dh forecast=%dh",
        len(rows), lat, lon, past_hours, forecast_hours,
    )
    return rows


# ── Archive (historical, up to 90 days) ───────────────────────────────────
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
MARINE_ARCHIVE_URL = "https://marine-api.open-meteo.com/v1/marine"  # supports past_days


def fetch_archive(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
) -> list[dict]:
    """
    Pull historical hourly weather from Open-Meteo Archive API.
    start_date / end_date format: 'YYYY-MM-DD'.
    Returns same shape as fetch_forecast.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation,wind_speed_10m,wind_gusts_10m",
        "start_date": start_date,
        "end_date": end_date,
        "timezone": "UTC",
    }
    data = _retry_get(ARCHIVE_URL, params, label="Open-Meteo Archive")

    if data is None:
        logger.warning("Archive API failed — using synthetic fallback")
        return _synthetic_archive(lat, lon, start_date, end_date)

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    wind_speed = hourly.get("wind_speed_10m", [])
    wind_gusts = hourly.get("wind_gusts_10m", [])

    rows = []
    for i, t in enumerate(times):
        rows.append({
            "ts": datetime.fromisoformat(t).replace(tzinfo=timezone.utc),
            "precip_mm": _safe_float(precip, i),
            "wind_max_kmh": _safe_float(wind_gusts, i),
            "wind_mean_kmh": _safe_float(wind_speed, i),
            "wave_max_m": 0.0,   # archive may not have marine data
            "sea_temp_c": None,
        })

    logger.info("Fetched %d archive hours for (%.4f, %.4f) [%s → %s]",
                len(rows), lat, lon, start_date, end_date)
    return rows


# ── Synthetic fallback ─────────────────────────────────────────────────────

def _synthetic_forecast(
    lat: float,
    lon: float,
    past_hours: int = 0,
    forecast_hours: int = 48,
) -> list[dict]:
    """Deterministic synthetic weather seeded by (lat, lon, date) for reproducibility."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(hours=past_hours)
    return _generate_synthetic(lat, lon, start, past_hours + forecast_hours)


def _synthetic_archive(lat: float, lon: float, start_date: str, end_date: str) -> list[dict]:
    """Synthetic archive data for when the API is unavailable."""
    start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
    hours = int((end - start).total_seconds() / 3600) + 24  # include end day
    return _generate_synthetic(lat, lon, start, hours)


def _generate_synthetic(lat: float, lon: float, start: datetime, n_hours: int) -> list[dict]:
    """Generate reproducible synthetic weather data."""
    rows = []
    for h in range(n_hours):
        ts = start + timedelta(hours=h)
        seed_str = f"{lat:.4f}_{lon:.4f}_{ts.isoformat()}"
        seed = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
        rng = np.random.RandomState(seed)

        rows.append({
            "ts": ts,
            "precip_mm": max(0.0, rng.normal(2.0, 4.0)),
            "wind_max_kmh": max(0.0, rng.normal(15.0, 10.0)),
            "wind_mean_kmh": max(0.0, rng.normal(10.0, 6.0)),
            "wave_max_m": max(0.0, rng.normal(0.8, 0.5)),
            "sea_temp_c": rng.normal(28.0, 1.5),
        })
    return rows


# ── Helpers ────────────────────────────────────────────────────────────────

def _safe_float(arr: list, idx: int, default: float = 0.0) -> float | None:
    """Safely extract a float from an array, returning default if out of range or None."""
    if idx < len(arr) and arr[idx] is not None:
        try:
            return float(arr[idx])
        except (TypeError, ValueError):
            return default
    return default
