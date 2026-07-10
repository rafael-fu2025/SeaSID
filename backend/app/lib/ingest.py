"""
One-shot data ingestion: pull weather + marine + air + tides for a site and store in DB.

Usage:
    python -m scripts.ingest --site dauin_muck --hours 48
    Or import and call: ingest_site("dauin_muck", hours=48)

The ingest path goes through the provider registry (see app.lib.providers),
so each role (weather/marine/air) can be swapped via environment variables
without touching this module.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from app.lib import db
from app.lib.sites import get_site
from app.lib.providers import (
    get_air_provider,
    get_marine_provider,
    get_weather_provider,
)
from app.lib.tides import fetch_tides

logger = logging.getLogger(__name__)


def _persist_weather(site_key: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    session = db.SessionLocal()
    inserted = 0
    try:
        for row in rows:
            stmt = sqlite_upsert(db.WeatherObs).values(
                site_key=site_key,
                ts=row["ts"],
                precip_mm=row.get("precip_mm", 0.0),
                wind_max_kmh=row.get("wind_max_kmh", 0.0),
                wind_mean_kmh=row.get("wind_mean_kmh", 0.0),
                wave_max_m=row.get("wave_max_m", 0.0),
                sea_temp_c=row.get("sea_temp_c"),
                source=row.get("source"),
            ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
            session.execute(stmt)
            inserted += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return inserted


def _persist_marine(site_key: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    session = db.SessionLocal()
    inserted = 0
    try:
        for row in rows:
            stmt = sqlite_upsert(db.MarineObs).values(
                site_key=site_key,
                ts=row["ts"],
                wave_height_m=row.get("wave_height_m"),
                wave_period_s=row.get("wave_period_s"),
                swell_height_m=row.get("swell_height_m"),
                swell_direction_deg=row.get("swell_direction_deg"),
                water_temp_c=row.get("water_temp_c"),
                current_speed_ms=row.get("current_speed_ms"),
                current_direction_deg=row.get("current_direction_deg"),
                source=row.get("source"),
            ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
            session.execute(stmt)
            inserted += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return inserted


def _persist_air(site_key: str, snapshot: dict | None) -> int:
    if snapshot is None:
        return 0
    session = db.SessionLocal()
    try:
        stmt = sqlite_upsert(db.AirQualityObs).values(
            site_key=site_key,
            ts=snapshot["ts"],
            aqi=snapshot.get("aqi"),
            pm25=snapshot.get("pm25"),
            pm10=snapshot.get("pm10"),
            o3=snapshot.get("o3"),
            no2=snapshot.get("no2"),
            station_id=snapshot.get("station_id"),
            station_name=snapshot.get("station_name"),
            station_lat=snapshot.get("station_lat"),
            station_lon=snapshot.get("station_lon"),
            distance_km=snapshot.get("distance_km"),
            quality=snapshot.get("quality"),
            source=snapshot.get("source"),
        ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
        session.execute(stmt)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return 1


def ingest_site(site_key: str, hours: int = 48) -> dict:
    """
    Pull weather + marine + air + tide data for a site and insert into DB.
    Uses INSERT OR IGNORE to handle duplicates gracefully.

    Returns a dict with row counts per source.
    """
    site = get_site(site_key)
    if site is None:
        raise ValueError(f"Unknown site key: {site_key}")

    lat, lon = site["lat"], site["lon"]

    weather_provider = get_weather_provider()
    weather_rows = weather_provider.fetch_hourly(lat, lon, hours=hours)
    weather_inserted = _persist_weather(site_key, weather_rows)

    marine_inserted = 0
    marine_provider = get_marine_provider()
    if marine_provider is not None:
        marine_rows = marine_provider.fetch_hourly(lat, lon, hours=hours)
        marine_inserted = _persist_marine(site_key, marine_rows)

    air_inserted = 0
    site_record = get_site(site_key)
    if site_record and site_record.get("air_provider_disabled"):
        logger.info("Air-quality disabled for site=%s — skipping", site_key)
    else:
        air_provider = get_air_provider()
        if air_provider is not None:
            snapshot = air_provider.fetch_current(lat, lon)
            air_inserted = _persist_air(site_key, snapshot)

    # ── Tides ──────────────────────────────────────────────────────────
    tide_rows = fetch_tides(lat, lon, length_seconds=hours * 3600)
    tide_inserted = 0

    session = db.SessionLocal()
    try:
        for row in tide_rows:
            stmt = sqlite_upsert(db.TideObs).values(
                site_key=site_key,
                ts=row["ts"],
                height_m=row["height_m"],
            ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
            session.execute(stmt)
            tide_inserted += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    logger.info(
        "Ingested site=%s: weather=%d marine=%d air=%d tide=%d",
        site_key, weather_inserted, marine_inserted, air_inserted, tide_inserted,
    )
    return {
        "weather_rows": weather_inserted,
        "marine_rows": marine_inserted,
        "air_rows": air_inserted,
        "tide_rows": tide_inserted,
    }


def ingest_archive(site_key: str, start_date: str, end_date: str) -> dict:
    """
    Pull historical weather from Open-Meteo Archive and store in DB.
    Used by expand_dataset.py for training data expansion.

    Returns {"weather_rows": int}.
    """
    from app.lib.weather import fetch_archive

    site = get_site(site_key)
    if site is None:
        raise ValueError(f"Unknown site key: {site_key}")

    lat, lon = site["lat"], site["lon"]
    weather_rows = fetch_archive(lat, lon, start_date, end_date)
    inserted = 0

    session = db.SessionLocal()
    try:
        for row in weather_rows:
            stmt = sqlite_upsert(db.WeatherObs).values(
                site_key=site_key,
                ts=row["ts"],
                precip_mm=row["precip_mm"],
                wind_max_kmh=row["wind_max_kmh"],
                wind_mean_kmh=row["wind_mean_kmh"],
                wave_max_m=row["wave_max_m"],
                sea_temp_c=row["sea_temp_c"],
            ).on_conflict_do_nothing(index_elements=["site_key", "ts"])
            session.execute(stmt)
            inserted += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    logger.info(
        "Archive ingested site=%s: %d weather rows [%s → %s]",
        site_key, inserted, start_date, end_date,
    )
    return {"weather_rows": inserted}
