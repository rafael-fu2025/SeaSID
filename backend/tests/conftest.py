"""
Test fixtures for SeaSID backend tests.
"""

import asyncio
import gc
import os
import socket as _socket
import sys
import tempfile
import time
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

import pandas as pd
import numpy as np
import pytest

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# Patch socket.socketpair with a retry wrapper.
#
# On Windows, asyncio creates a self-pipe via socket.socketpair() the first
# time each event loop is constructed. socket.socketpair() falls back to a
# loop that does ``socket.bind(('127.0.0.1', 0))`` to grab an ephemeral
# TCP port; that bind intermittently fails with WinError 10013 once earlier
# tests have churned sockets/handles (especially after SQLite's WAL mode
# leaves transient file handles). A short retry rides out the race without
# touching test code.
if sys.platform == "win32":
    _original_socketpair = _socket.socketpair

    def _retrying_socketpair(*args, **kwargs):
        last_err: Exception | None = None
        for _ in range(10):
            try:
                return _original_socketpair(*args, **kwargs)
            except (PermissionError, OSError) as exc:
                last_err = exc
                gc.collect()
                time.sleep(0.1)
        assert last_err is not None
        raise last_err

    _socket.socketpair = _retrying_socketpair

    # Defensive: if a loop was created when socketpair() still failed (or
    # was retried mid-init), the proactor loop instance may lack
    # ``_ssock``. Subsequent close() then crashes with
    # "AttributeError: 'ProactorEventLoop' object has no attribute '_ssock'".
    # Patch _close_self_pipe so the teardown is a no-op when the self-pipe
    # never finished constructing. Python 3.14 renamed the class to
    # BaseProactorEventLoop; patch whichever variant is available.
    import asyncio.proactor_events as _proactor

    _ProactorCls = getattr(
        _proactor, "ProactorEventLoop", None
    ) or getattr(_proactor, "BaseProactorEventLoop", None)

    if _ProactorCls is not None:
        _original_close_self_pipe = _ProactorCls._close_self_pipe

        def _safe_close_self_pipe(self):  # noqa: ANN001 - proactor ducktype
            if not hasattr(self, "_ssock") or self._ssock is None:
                return
            try:
                _original_close_self_pipe(self)
            except (AttributeError, OSError):
                pass

        _ProactorCls._close_self_pipe = _safe_close_self_pipe


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

    # Cleanup — order matters on Windows:
    #   1. drop_all releases schema-bound locks
    #   2. engine.dispose() closes every pooled connection
    #   3. gc.collect() forces finalizers to run so file handles are
    #      released before we try to delete the SQLite file
    #   4. unlink the file (retry-safe to ride out any lingering lock)
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()
    gc.collect()

    for _ in range(5):
        try:
            test_db_path.unlink(missing_ok=True)
            break
        except PermissionError:
            gc.collect()
            time.sleep(0.05)


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
