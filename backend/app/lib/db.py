"""
SQLAlchemy 2.x models and session management for SeaSID.
Uses SQLite with WAL mode enabled to prevent concurrent lock errors.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
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
    inspect,
    text,
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
    # Phase 5: structured reason + confidence. ``no_go_reason`` tells the
    # trainer which physical driver mattered (visibility, current, swell,
    # weather, boat traffic, other). ``confidence`` is the operator's
    # self-reported trust in the label — used as a training weight so
    # high-confidence labels contribute more than guesses.
    no_go_reason = Column(String(20), nullable=True)  # viz, current, swell, weather, boat, other
    confidence = Column(String(8), nullable=True)      # low, med, high
    actor_id = Column(String(100), nullable=True, index=True)

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
    # Phase 5: structured reason + confidence — see NoDiveLabel docstring.
    no_go_reason = Column(String(20), nullable=True)
    confidence = Column(String(8), nullable=True)
    actor_id = Column(String(100), nullable=True, index=True)

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
    owner_id = Column(String(100), nullable=True, index=True)
    site_key = Column(String(50), nullable=True)
    role = Column(String(20), nullable=False)  # user, assistant, tool
    content = Column(Text, nullable=False)
    tool_calls_json = Column(Text, nullable=True)
    ts = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class User(Base):
    """Authentication identity managed by SeaSID (replaces env-only config).

    The ``password_hash`` is a PBKDF2-SHA256 envelope (see app.auth.hash_password).
    ``site_keys`` is a JSON list of strings; ``["*"]`` means full access.
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subject = Column(String(100), nullable=False, unique=True, index=True)
    username = Column(String(100), nullable=False, unique=True, index=True)
    role = Column(String(20), nullable=False, default="viewer")
    site_keys_json = Column(Text, nullable=False, default='["*"]')
    password_hash = Column(String(255), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    last_login_at = Column(DateTime(timezone=True), nullable=True)


class ProviderApiKey(Base):
    """Provider API key with rotation + cooldown tracking.

    ``provider`` is a logical name (``llm``, ``stormglass``, ``aqicn``,
    ``tides``, etc.). ``value_encrypted`` stores the Fernet-style envelope
    produced by :mod:`app.secret_store`. The raw value is never returned
    through the API; clients receive ``value_preview`` (last 4 chars only).
    """

    __tablename__ = "provider_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(50), nullable=False, index=True)
    label = Column(String(120), nullable=True)
    value_encrypted = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by_subject = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    error_count = Column(Integer, nullable=False, default=0)
    cooldown_until = Column(DateTime(timezone=True), nullable=True)
    total_uses = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("provider", "label", name="uq_api_key_provider_label"),
    )


class ProviderConfig(Base):
    """Non-secret settings shared by every key for one provider."""

    __tablename__ = "provider_configs"

    provider = Column(String(50), primary_key=True)
    base_url = Column(Text, nullable=True)
    updated_by_subject = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# ── Initialization ─────────────────────────────────────────────────────────
def _ensure_legacy_columns() -> None:
    """Add nullable identity columns to databases created before auth."""
    inspector = inspect(engine)
    additions = {
        "no_dive_labels": {"actor_id": "VARCHAR(100)"},
        "operator_verifications": {"actor_id": "VARCHAR(100)"},
        "agent_conversations": {"owner_id": "VARCHAR(100)"},
    }
    with engine.begin() as connection:
        for table, columns in additions.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for column, ddl in columns.items():
                if column not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def init_db():
    """Create tables and apply additive identity columns for legacy databases."""
    Base.metadata.create_all(bind=engine)
    _ensure_legacy_columns()
    logger.info("Database initialized at %s", DB_PATH)
