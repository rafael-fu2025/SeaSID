"""
SQLAlchemy 2.x models and session management for SeaSID.
Uses SQLite with WAL mode enabled to prevent concurrent lock errors.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Date,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

# ── Database path ──────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "seasid.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"


# ── Engine + WAL mode ──────────────────────────────────────────────────────
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    """Enable WAL mode for better concurrent read/write performance."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency: yield a session, auto-close on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Base class ─────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Models ─────────────────────────────────────────────────────────────────
class WeatherObs(Base):
    """Hourly weather observations pulled from Open-Meteo."""
    __tablename__ = "weather_obs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    precip_mm = Column(Float, default=0.0)
    wind_max_kmh = Column(Float, default=0.0)
    wind_mean_kmh = Column(Float, default=0.0)
    wave_max_m = Column(Float, default=0.0)
    sea_temp_c = Column(Float, nullable=True)
    source = Column(String(32), nullable=True)  # e.g. "open_meteo"

    __table_args__ = (
        UniqueConstraint("site_key", "ts", name="uq_weather_obs_site_ts"),
    )


class MarineObs(Base):
    """Hourly marine augmentation: waves, swell, currents, water temperature.

    Populated by an optional secondary provider (Storm Glass) when
    SEASID_PROVIDER_MARINE=stormglass. Defaults to Open-Meteo's marine endpoint
    via OpenMeteoMarineProvider.
    """
    __tablename__ = "marine_obs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    wave_height_m = Column(Float, nullable=True)
    wave_period_s = Column(Float, nullable=True)
    swell_height_m = Column(Float, nullable=True)
    swell_direction_deg = Column(Float, nullable=True)
    water_temp_c = Column(Float, nullable=True)
    current_speed_ms = Column(Float, nullable=True)
    current_direction_deg = Column(Float, nullable=True)
    source = Column(String(32), nullable=True)

    __table_args__ = (
        UniqueConstraint("site_key", "ts", name="uq_marine_obs_site_ts"),
    )


class AirQualityObs(Base):
    """Real-time air-quality snapshots from AQICN (or compatible)."""
    __tablename__ = "air_quality_obs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    aqi = Column(Float, nullable=True)
    pm25 = Column(Float, nullable=True)
    pm10 = Column(Float, nullable=True)
    o3 = Column(Float, nullable=True)
    no2 = Column(Float, nullable=True)
    station_id = Column(Integer, nullable=True)
    station_name = Column(String(120), nullable=True)
    station_lat = Column(Float, nullable=True)
    station_lon = Column(Float, nullable=True)
    distance_km = Column(Float, nullable=True)
    quality = Column(String(16), nullable=True)  # local / regional / distant / very_distant
    source = Column(String(32), nullable=True)

    __table_args__ = (
        UniqueConstraint("site_key", "ts", name="uq_air_quality_obs_site_ts"),
    )


class TideObs(Base):
    """Hourly tide heights from WorldTides."""
    __tablename__ = "tide_obs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    height_m = Column(Float, default=0.0)

    __table_args__ = (
        UniqueConstraint("site_key", "ts", name="uq_tide_obs_site_ts"),
    )


class NoDiveLabel(Base):
    """Ground-truth labels: dive / poor_viz / no_dive."""
    __tablename__ = "no_dive_labels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    date = Column(Date, nullable=False)
    label = Column(String(20), nullable=False)  # dive, poor_viz, no_dive
    source = Column(String(50), default="manual")  # seed, operator_form, synthetic_rule, fb_<shop>
    actual_viz_m = Column(Float, nullable=True)
    actual_current = Column(String(20), nullable=True)
    comments = Column(Text, nullable=True)
    shop_name = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("site_key", "date", "source", name="uq_label_site_date_source"),
    )


class OperatorVerification(Base):
    """Submissions from the Operator Verify page."""
    __tablename__ = "operator_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    operator = Column(String(100), nullable=True)
    date = Column(Date, nullable=False)
    verdict = Column(String(20), nullable=False)
    actual_viz_m = Column(Float, nullable=True)
    actual_current = Column(String(20), nullable=True)
    comments = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # One verification per (site, date, operator). NULL operators are treated
    # as distinct by both SQLite and PostgreSQL, so anonymous submissions do
    # not collide with each other.
    __table_args__ = (
        UniqueConstraint(
            "site_key", "date", "operator",
            name="uq_opver_site_date_operator",
        ),
    )


class Alert(Base):
    """Alert history for in-app banner and idempotency."""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    site_key = Column(String(50), nullable=False, index=True)
    kind = Column(String(50), nullable=False)
    ts_hour = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    channel = Column(String(20), default="in_app")  # in_app, email
    message = Column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint("site_key", "kind", "ts_hour", name="uq_alert_site_kind_ts"),
    )


class AgentConversation(Base):
    """Agent chat history for multi-turn context."""
    __tablename__ = "agent_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String(100), nullable=False, index=True)
    site_key = Column(String(50), nullable=True)
    role = Column(String(20), nullable=False)  # user, assistant, tool
    content = Column(Text, nullable=False)
    tool_calls_json = Column(Text, nullable=True)
    ts = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Initialization ─────────────────────────────────────────────────────────
def init_db():
    """Create all tables. Safe to call multiple times (CREATE IF NOT EXISTS)."""
    Base.metadata.create_all(bind=engine)
    logger.info("Database initialized at %s", DB_PATH)
