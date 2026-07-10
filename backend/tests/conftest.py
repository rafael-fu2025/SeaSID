"""
Test fixtures for SeaSID backend tests.
"""

import os
import sys
import tempfile
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

import pandas as pd
import numpy as np
import pytest

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.db import Base, engine, SessionLocal, WeatherObs, TideObs, NoDiveLabel, init_db
from app.lib.features import FEATURE_COLUMNS


@pytest.fixture(autouse=True)
def _setup_test_db(tmp_path, monkeypatch):
    """Create a fresh in-memory-like test database for each test."""
    test_db_path = tmp_path / "test_seasid.db"
    test_url = f"sqlite:///{test_db_path}"

    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker

    test_engine = create_engine(test_url, connect_args={"check_same_thread": False})

    @event.listens_for(test_engine, "connect")
    def _set_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    Base.metadata.create_all(bind=test_engine)
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    # Monkeypatch the db module to use the test engine/session
    import app.lib.db as db_mod
    monkeypatch.setattr(db_mod, "engine", test_engine)
    monkeypatch.setattr(db_mod, "SessionLocal", TestSession)

    yield test_engine, TestSession

    # Cleanup
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


@pytest.fixture
def db_session(_setup_test_db):
    """Provide a test DB session."""
    _, TestSession = _setup_test_db
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seeded_weather(db_session):
    """Insert 48 hours of synthetic weather data for dauin_muck."""
    now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    rows = []
    rng = np.random.RandomState(42)

    for h in range(48):
        ts = now - timedelta(hours=47 - h)
        obs = WeatherObs(
            site_key="dauin_muck",
            ts=ts,
            precip_mm=max(0.0, rng.normal(2.0, 3.0)),
            wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
            wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
            wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
            sea_temp_c=rng.normal(28.0, 1.0),
        )
        db_session.add(obs)
        rows.append(obs)

    db_session.commit()
    return now, rows


@pytest.fixture
def seeded_tides(db_session):
    """Insert 24 hours of synthetic tide data for dauin_muck."""
    now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    rows = []
    rng = np.random.RandomState(42)

    for h in range(24):
        ts = now - timedelta(hours=23 - h)
        tide = TideObs(
            site_key="dauin_muck",
            ts=ts,
            height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
        )
        db_session.add(tide)
        rows.append(tide)

    db_session.commit()
    return now, rows


@pytest.fixture
def toy_feature_matrix():
    """Create a small feature matrix for model testing."""
    rng = np.random.RandomState(42)
    n_samples = 30
    X = pd.DataFrame(
        rng.rand(n_samples, len(FEATURE_COLUMNS)),
        columns=FEATURE_COLUMNS,
    )
    # Scale features to realistic ranges
    X["precip_24h_mm"] *= 50
    X["precip_48h_mm"] *= 80
    X["precip_recent_3h"] *= 15
    X["wind_max_24h_kmh"] *= 60
    X["wind_mean_24h_kmh"] *= 30
    X["wave_max_24h_m"] *= 3
    X["sea_temp_mean_24h"] = X["sea_temp_mean_24h"] * 5 + 25
    X["tide_max_24h_m"] *= 2
    X["tide_min_24h_m"] = X["tide_min_24h_m"] * -1
    X["tide_range_24h_m"] = X["tide_max_24h_m"] - X["tide_min_24h_m"]
    X["is_muck_site"] = (rng.rand(n_samples) > 0.5).astype(float)

    # Binary labels: roughly 40% no-go
    y = pd.Series((rng.rand(n_samples) > 0.6).astype(int), name="label")

    return X, y
