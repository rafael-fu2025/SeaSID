"""
Feature engineering for SeaSID.

14 features derived from weather_obs + marine_obs + air_quality_obs + tide_obs.
Single source of truth — used by both training and inference.

Layout (additive — the first 11 are unchanged for backward compatibility):

 1.  precip_24h_mm       sum, 24h (mm)
 2.  precip_48h_mm       sum, 48h (mm)
 3.  precip_recent_3h    sum, last 3h (mm)
 4.  wind_max_24h_kmh    max, 24h (km/h)
 5.  wind_mean_24h_kmh   mean, 24h (km/h)
 6.  wave_max_24h_m      max, 24h (m)
 7.  sea_temp_mean_24h   mean, 24h (°C)
 8.  tide_max_24h_m      max, 24h (m)
 9.  tide_min_24h_m      min, 24h (m)
10.  tide_range_24h_m    max − min, 24h (m)
11.  is_muck_site        1 if site.type == "muck", else 0
12.  aqi_recent          AQICN AQI (current snapshot)
13.  pm25_recent         AQICN PM2.5 (µg/m³)
14.  wave_period_s_mean  mean dominant wave period over 24h (seconds)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.lib import db
from app.lib.sites import is_muck_site

logger = logging.getLogger(__name__)

FEATURE_COLUMNS = [
    "precip_24h_mm",         # sum, 24h (mm)
    "precip_48h_mm",         # sum, 48h (mm)
    "precip_recent_3h",      # sum, last 3h (mm)
    "wind_max_24h_kmh",      # max, 24h (km/h)
    "wind_mean_24h_kmh",     # mean, 24h (km/h)
    "wave_max_24h_m",        # max, 24h (m)
    "sea_temp_mean_24h",     # mean, 24h (°C)
    "tide_max_24h_m",        # max, 24h (m)
    "tide_min_24h_m",        # min, 24h (m)
    "tide_range_24h_m",      # max - min, 24h (m)
    "is_muck_site",          # 1 if site.type == "muck", else 0
    # ── Extensions (v2.1) ──────────────────────────────────────────────
    "aqi_recent",            # AQICN AQI (current snapshot)
    "pm25_recent",           # AQICN PM2.5 (µg/m³)
    "wave_period_s_mean",    # mean dominant wave period over 24h (seconds)
]


def build_features(site_key: str, target_ts: datetime) -> pd.DataFrame:
    """
    Return a 1-row DataFrame with FEATURE_COLUMNS in order.
    Used by XGBoost (single snapshot) and rule-based scoring.
    """
    if target_ts.tzinfo is None:
        target_ts = target_ts.replace(tzinfo=timezone.utc)

    # Fetch data for the rolling windows
    weather_48h = _fetch_weather_window(site_key, target_ts, hours=48)
    tide_24h = _fetch_tide_window(site_key, target_ts, hours=24)
    marine_24h = _fetch_marine_window(site_key, target_ts, hours=24)
    air_snapshot = _fetch_air_snapshot(site_key, target_ts)

    # Compute features
    features = _compute_features(
        weather_48h, tide_24h, site_key, target_ts,
        marine_24h=marine_24h,
        air_snapshot=air_snapshot,
    )

    df = pd.DataFrame([features], columns=FEATURE_COLUMNS)
    return df


def build_features_for_window(
    site_key: str,
    target_tses: list[datetime],
) -> pd.DataFrame:
    """
    Vectorized feature builder — fetches the union of all rolling windows once,
    then computes features for every target_ts. Avoids the N+1 query pattern of
    calling build_features() in a loop.
    """
    if not target_tses:
        return pd.DataFrame(columns=FEATURE_COLUMNS)

    # Normalize timezones
    norm = []
    for ts in target_tses:
        if ts.tzinfo is None:
            norm.append(ts.replace(tzinfo=timezone.utc))
        else:
            norm.append(ts)

    start = min(norm) - pd.Timedelta(hours=48)
    end = max(norm)

    weather_df = _fetch_weather_window(site_key, end, hours=int((end - start).total_seconds() // 3600))
    start_tide = min(norm) - pd.Timedelta(hours=24)
    tide_df = _fetch_tide_window(site_key, end, hours=int((end - start_tide).total_seconds() // 3600))
    marine_df = _fetch_marine_window(site_key, end, hours=int((end - start_tide).total_seconds() // 3600))
    # Air quality is a single snapshot — fetch once and reuse.
    air_snapshot = _fetch_air_snapshot(site_key, end)

    rows = []
    for ts in norm:
        try:
            f = _compute_features(
                weather_df, tide_df, site_key, ts,
                marine_24h=marine_df,
                air_snapshot=air_snapshot,
            )
        except Exception:
            f = [0.0] * len(FEATURE_COLUMNS)
        rows.append(f)

    return pd.DataFrame(rows, columns=FEATURE_COLUMNS)


def build_sequence(
    site_key: str,
    target_ts: datetime,
    window_hours: int = 24,
) -> np.ndarray:
    """
    Return a (window_hours, len(FEATURE_COLUMNS)) array for LSTM input.
    Each row is the feature vector for one hour in the lookback window.
    """
    if target_ts.tzinfo is None:
        target_ts = target_ts.replace(tzinfo=timezone.utc)

    sequence = []
    for h in range(window_hours, 0, -1):
        ts = target_ts - timedelta(hours=h)
        row = build_features(site_key, ts)
        sequence.append(row.values[0])

    return np.array(sequence, dtype=np.float32)


def build_features_from_arrays(
    weather_df: pd.DataFrame,
    tide_df: pd.DataFrame,
    site_key: str,
    target_ts: datetime,
    marine_df: pd.DataFrame | None = None,
    air_snapshot: dict | None = None,
) -> pd.DataFrame:
    """
    Build features from pre-loaded DataFrames instead of querying the DB.
    Useful for batch training where data is already in memory.

    weather_df columns: ts, precip_mm, wind_max_kmh, wind_mean_kmh, wave_max_m, sea_temp_c
    tide_df columns:    ts, height_m
    marine_df columns:  ts, wave_height_m, wave_period_s, swell_height_m, ...
    """
    target_ts = _to_naive_utc(target_ts)

    # Normalize incoming ts columns to tz-naive UTC to keep comparisons legal.
    weather_df = weather_df.copy()
    tide_df = tide_df.copy()
    if marine_df is not None:
        marine_df = marine_df.copy()
        if "ts" in marine_df.columns:
            marine_df["ts"] = _normalize_ts_column(marine_df["ts"])
    if "ts" in weather_df.columns:
        weather_df["ts"] = _normalize_ts_column(weather_df["ts"])
    if "ts" in tide_df.columns:
        tide_df["ts"] = _normalize_ts_column(tide_df["ts"])

    # Filter to relevant windows
    ts_24h_ago = target_ts - pd.Timedelta(hours=24)
    ts_48h_ago = target_ts - pd.Timedelta(hours=48)
    ts_3h_ago = target_ts - pd.Timedelta(hours=3)

    w48 = weather_df[(weather_df["ts"] >= ts_48h_ago) & (weather_df["ts"] <= target_ts)]
    w24 = weather_df[(weather_df["ts"] >= ts_24h_ago) & (weather_df["ts"] <= target_ts)]
    w3 = weather_df[(weather_df["ts"] >= ts_3h_ago) & (weather_df["ts"] <= target_ts)]
    t24 = tide_df[(tide_df["ts"] >= ts_24h_ago) & (tide_df["ts"] <= target_ts)]
    if marine_df is not None and len(marine_df) > 0:
        m24 = marine_df[(marine_df["ts"] >= ts_24h_ago) & (marine_df["ts"] <= target_ts)]
    else:
        m24 = None

    features = _compute_features_from_dfs(
        w24, w48, w3, t24, site_key,
        marine_24h=m24,
        air_snapshot=air_snapshot,
    )
    return pd.DataFrame([features], columns=FEATURE_COLUMNS)


# ── Internal helpers ───────────────────────────────────────────────────────

def _to_naive_utc(ts) -> "pd.Timestamp":
    """Convert any datetime-like to a tz-naive pandas Timestamp in UTC.

    Pandas 3.x enforces strict dtype equality for `>=`/`<=`. The DB returns
    tz-aware datetimes; pandas coerces to datetime64[us, UTC]; cutoff values
    are tz-aware datetime objects. Normalizing both sides to tz-naive UTC
    gives consistent comparisons.
    """
    out = pd.Timestamp(ts)
    if out.tzinfo is not None:
        out = out.tz_convert("UTC").tz_localize(None)
    return out


def _normalize_ts_column(series: pd.Series) -> pd.Series:
    """Return a tz-naive UTC datetime64 Series (no-op if already naive)."""
    if series.empty:
        return series
    if pd.api.types.is_datetime64_any_dtype(series):
        if getattr(series.dt, "tz", None) is not None:
            return series.dt.tz_convert("UTC").dt.tz_localize(None)
        return series
    converted = pd.to_datetime(series, utc=True, errors="coerce")
    return converted.dt.tz_convert("UTC").dt.tz_localize(None)



def _fetch_weather_window(
    site_key: str,
    target_ts: datetime,
    hours: int,
) -> pd.DataFrame:
    """Query weather_obs for the last `hours` before target_ts."""
    start = target_ts - timedelta(hours=hours)
    session = db.SessionLocal()
    try:
        rows = (
            session.query(db.WeatherObs)
            .filter(db.WeatherObs.site_key == site_key)
            .filter(db.WeatherObs.ts >= start)
            .filter(db.WeatherObs.ts <= target_ts)
            .order_by(db.WeatherObs.ts)
            .all()
        )
        if not rows:
            logger.warning("No weather data for %s in [%s, %s]", site_key, start, target_ts)
            return pd.DataFrame(columns=["ts", "precip_mm", "wind_max_kmh", "wind_mean_kmh", "wave_max_m", "sea_temp_c"])

        return pd.DataFrame([
            {
                "ts": _to_naive_utc(r.ts),
                "precip_mm": r.precip_mm or 0.0,
                "wind_max_kmh": r.wind_max_kmh or 0.0,
                "wind_mean_kmh": r.wind_mean_kmh or 0.0,
                "wave_max_m": r.wave_max_m or 0.0,
                "sea_temp_c": r.sea_temp_c,
            }
            for r in rows
        ])
    finally:
        session.close()


def _fetch_tide_window(
    site_key: str,
    target_ts: datetime,
    hours: int,
) -> pd.DataFrame:
    """Query tide_obs for the last `hours` before target_ts."""
    start = target_ts - timedelta(hours=hours)
    session = db.SessionLocal()
    try:
        rows = (
            session.query(db.TideObs)
            .filter(db.TideObs.site_key == site_key)
            .filter(db.TideObs.ts >= start)
            .filter(db.TideObs.ts <= target_ts)
            .order_by(db.TideObs.ts)
            .all()
        )
        if not rows:
            return pd.DataFrame(columns=["ts", "height_m"])

        return pd.DataFrame([
            {"ts": _to_naive_utc(r.ts), "height_m": r.height_m or 0.0}
            for r in rows
        ])
    finally:
        session.close()


def _fetch_marine_window(
    site_key: str,
    target_ts: datetime,
    hours: int = 24,
) -> pd.DataFrame:
    """Query marine_obs for the last `hours` before target_ts.

    Returns an empty DataFrame with the expected schema when no rows exist.
    """
    start = target_ts - timedelta(hours=hours)
    expected_cols = [
        "ts", "wave_height_m", "wave_period_s",
        "swell_height_m", "swell_direction_deg",
        "water_temp_c", "current_speed_ms", "current_direction_deg",
    ]
    session = db.SessionLocal()
    try:
        rows = (
            session.query(db.MarineObs)
            .filter(db.MarineObs.site_key == site_key)
            .filter(db.MarineObs.ts >= start)
            .filter(db.MarineObs.ts <= target_ts)
            .order_by(db.MarineObs.ts)
            .all()
        )
        if not rows:
            return pd.DataFrame(columns=expected_cols)
        return pd.DataFrame([
            {
                "ts": _to_naive_utc(r.ts),
                "wave_height_m": r.wave_height_m,
                "wave_period_s": r.wave_period_s,
                "swell_height_m": r.swell_height_m,
                "swell_direction_deg": r.swell_direction_deg,
                "water_temp_c": r.water_temp_c,
                "current_speed_ms": r.current_speed_ms,
                "current_direction_deg": r.current_direction_deg,
            }
            for r in rows
        ])
    finally:
        session.close()


def _fetch_air_snapshot(site_key: str, target_ts: datetime) -> dict | None:
    """Fetch the most recent air-quality snapshot at-or-before target_ts."""
    session = db.SessionLocal()
    try:
        row = (
            session.query(db.AirQualityObs)
            .filter(db.AirQualityObs.site_key == site_key)
            .filter(db.AirQualityObs.ts <= target_ts)
            .order_by(db.AirQualityObs.ts.desc())
            .first()
        )
        if row is None:
            return None
        return {
            "aqi": row.aqi,
            "pm25": row.pm25,
            "pm10": row.pm10,
            "o3": row.o3,
            "no2": row.no2,
            "ts": _to_naive_utc(row.ts),
            "station_name": row.station_name,
        }
    finally:
        session.close()


def _compute_features(
    weather_48h: pd.DataFrame,
    tide_24h: pd.DataFrame,
    site_key: str,
    target_ts: datetime,
    marine_24h: pd.DataFrame | None = None,
    air_snapshot: dict | None = None,
) -> list[float]:
    """Compute the 14 features from weather + tide + marine + air DataFrames.

    marine_24h and air_snapshot are optional — when None, sensible defaults
    are used (background AQI / PM2.5 and a 6-second tropical-swell period).
    """
    target_ts = _to_naive_utc(target_ts)
    ts_24h_ago = target_ts - pd.Timedelta(hours=24)
    ts_3h_ago = target_ts - pd.Timedelta(hours=3)

    # Split weather into windows
    if len(weather_48h) > 0 and "ts" in weather_48h.columns:
        w24 = weather_48h[weather_48h["ts"] >= ts_24h_ago]
        w3 = weather_48h[weather_48h["ts"] >= ts_3h_ago]
        w48 = weather_48h
    else:
        w24 = weather_48h
        w3 = weather_48h
        w48 = weather_48h

    return _compute_features_from_dfs(
        w24, w48, w3, tide_24h, site_key,
        marine_24h=marine_24h,
        air_snapshot=air_snapshot,
    )


def _compute_features_from_dfs(
    w24: pd.DataFrame,
    w48: pd.DataFrame,
    w3: pd.DataFrame,
    t24: pd.DataFrame,
    site_key: str,
    marine_24h: pd.DataFrame | None = None,
    air_snapshot: dict | None = None,
) -> list[float]:
    """Compute 14 features from pre-filtered DataFrames.

    The first 11 columns match the legacy v2 contract; columns 12-14 are new
    (aqi_recent, pm25_recent, wave_period_s_mean). Old models trained on 11
    features will simply ignore the last three values when sliced, and will
    fall back to climatological defaults when those fields are absent.
    """
    # Precipitation
    precip_24h = w24["precip_mm"].sum() if len(w24) > 0 else 0.0
    precip_48h = w48["precip_mm"].sum() if len(w48) > 0 else 0.0
    precip_3h = w3["precip_mm"].sum() if len(w3) > 0 else 0.0

    # Wind
    wind_max_24h = w24["wind_max_kmh"].max() if len(w24) > 0 else 0.0
    wind_mean_24h = w24["wind_mean_kmh"].mean() if len(w24) > 0 else 0.0

    # Waves
    wave_max_24h = w24["wave_max_m"].max() if len(w24) > 0 else 0.0

    # Sea temperature (use 7-day climatology mean if missing)
    if len(w24) > 0 and "sea_temp_c" in w24.columns:
        temps = w24["sea_temp_c"].dropna()
        sea_temp_mean = temps.mean() if len(temps) > 0 else 28.0  # climatology default
    else:
        sea_temp_mean = 28.0

    # Tides
    if len(t24) > 0:
        tide_max = t24["height_m"].max()
        tide_min = t24["height_m"].min()
        tide_range = tide_max - tide_min
    else:
        tide_max = 0.0
        tide_min = 0.0
        tide_range = 0.0

    # Site type flag
    muck_flag = 1.0 if is_muck_site(site_key) else 0.0

    # ── Extensions (v2.1) ─────────────────────────────────────────────
    # Air quality — fall back to background tropical marine values if missing.
    if air_snapshot is not None:
        aqi_recent = float(air_snapshot.get("aqi") or 0.0)
        pm25_recent = float(air_snapshot.get("pm25") or 0.0)
    else:
        aqi_recent = 30.0   # "Good" baseline
        pm25_recent = 8.0   # µg/m³ marine background

    # Wave period — mean dominant period over the 24h window.
    if marine_24h is not None and len(marine_24h) > 0 and "wave_period_s" in marine_24h.columns:
        periods = marine_24h["wave_period_s"].dropna()
        wave_period_mean = float(periods.mean()) if len(periods) > 0 else 6.0
    else:
        # Tropical swell default.
        wave_period_mean = 6.0

    return [
        float(precip_24h),
        float(precip_48h),
        float(precip_3h),
        float(wind_max_24h),
        float(wind_mean_24h),
        float(wave_max_24h),
        float(sea_temp_mean),
        float(tide_max),
        float(tide_min),
        float(tide_range),
        float(muck_flag),
        float(aqi_recent),
        float(pm25_recent),
        float(wave_period_mean),
    ]
