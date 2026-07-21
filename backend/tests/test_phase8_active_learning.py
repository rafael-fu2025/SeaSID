"""Phase 8 — Active-learning suggestion engine regression tests."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest


# ── Pure-math helpers ─────────────────────────────────────────────────────

def test_binary_entropy_max_at_half():
    """p=0.5 must give the maximum 1.0 bit of uncertainty."""
    from app.lib.active_learning import binary_entropy
    assert abs(binary_entropy(0.5) - 1.0) < 1e-9


def test_binary_entropy_min_at_extremes():
    """p=0 or p=1 must give ~0 uncertainty."""
    from app.lib.active_learning import binary_entropy
    # We clamp at 1e-9 to avoid log(0); the result should be very small.
    assert binary_entropy(0.0) < 0.001
    assert binary_entropy(1.0) < 0.001


def test_binary_entropy_symmetric():
    """Binary entropy is symmetric around p=0.5."""
    from app.lib.active_learning import binary_entropy
    assert abs(binary_entropy(0.3) - binary_entropy(0.7)) < 1e-9
    assert abs(binary_entropy(0.1) - binary_entropy(0.9)) < 1e-9


def test_in_uncertainty_band_inside():
    """p in [0.35, 0.65] should return True."""
    from app.lib.active_learning import in_uncertainty_band
    assert in_uncertainty_band(0.35) is True
    assert in_uncertainty_band(0.5) is True
    assert in_uncertainty_band(0.65) is True


def test_in_uncertainty_band_outside():
    """p outside [0.35, 0.65] should return False."""
    from app.lib.active_learning import in_uncertainty_band
    assert in_uncertainty_band(0.0) is False
    assert in_uncertainty_band(0.34) is False
    assert in_uncertainty_band(0.66) is False
    assert in_uncertainty_band(1.0) is False


# ── Suggestion engine ─────────────────────────────────────────────────────

def test_suggest_active_labels_unknown_site_returns_empty():
    """Unknown site keys must return an empty list, never raise."""
    from app.lib.active_learning import suggest_active_labels
    assert suggest_active_labels("nowhere") == []


def test_suggest_active_labels_returns_list_of_dicts():
    """Suggestions must be JSON-serialisable dicts with the documented keys.

    We set up an isolated DB engine + seed 30d of weather so feature
    build succeeds for the replayed past dates. Reusing the conftest's
    autouse fixture is brittle when other tests have touched the schema.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.lib.active_learning import suggest_active_labels

    with tempfile.TemporaryDirectory() as tmpdir:
        engine = create_engine(
            f"sqlite:///{tmpdir}/al.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)

        # Seed 30d of weather so the lookback window has data.
        sess = TestSession()
        try:
            now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
            rng = np.random.RandomState(42)
            for h in range(30 * 24):
                ts = now - timedelta(hours=30 * 24 - 1 - h)
                sess.add(WeatherObs(
                    site_key="dauin_muck", ts=ts,
                    precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                    wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                    wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                    wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                    sea_temp_c=rng.normal(28.0, 1.0),
                ))
                sess.add(TideObs(
                    site_key="dauin_muck", ts=ts,
                    height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
                ))
            sess.commit()
        finally:
            sess.close()

        # Monkeypatch db module to use this engine.
        import unittest.mock as mock
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession):
            out = suggest_active_labels("dauin_muck", days=7, top_n=3)
        engine.dispose()

    assert isinstance(out, list)
    for s in out:
        assert set(s.keys()) == {
            "site_key", "date", "p_bad", "uncertainty",
            "model_source", "rank", "reason",
        }
        assert s["site_key"] == "dauin_muck"
        assert s["rank"] >= 1
        assert 0.0 <= s["p_bad"] <= 1.0
        assert 0.0 <= s["uncertainty"] <= 1.0
        assert "in the" in s["reason"]


def test_suggest_active_labels_top_n_respected():
    """At most ``top_n`` suggestions are returned."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.lib.active_learning import suggest_active_labels

    with tempfile.TemporaryDirectory() as tmpdir:
        engine = create_engine(f"sqlite:///{tmpdir}/al.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        sess = TestSession()
        try:
            now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
            rng = np.random.RandomState(42)
            for h in range(30 * 24):
                ts = now - timedelta(hours=30 * 24 - 1 - h)
                sess.add(WeatherObs(
                    site_key="dauin_muck", ts=ts,
                    precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                    wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                    wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                    wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                    sea_temp_c=rng.normal(28.0, 1.0),
                ))
                sess.add(TideObs(
                    site_key="dauin_muck", ts=ts,
                    height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
                ))
            sess.commit()
        finally:
            sess.close()
        import unittest.mock as mock
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession):
            out = suggest_active_labels("dauin_muck", days=30, top_n=2)
        engine.dispose()
    assert len(out) <= 2


def test_suggest_active_labels_only_returns_in_band():
    """Every suggestion must have p_bad in the uncertainty band."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.lib.active_learning import suggest_active_labels, UNCERTAINTY_LOW, UNCERTAINTY_HIGH

    with tempfile.TemporaryDirectory() as tmpdir:
        engine = create_engine(f"sqlite:///{tmpdir}/al.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        sess = TestSession()
        try:
            now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
            rng = np.random.RandomState(42)
            for h in range(30 * 24):
                ts = now - timedelta(hours=30 * 24 - 1 - h)
                sess.add(WeatherObs(
                    site_key="dauin_muck", ts=ts,
                    precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                    wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                    wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                    wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                    sea_temp_c=rng.normal(28.0, 1.0),
                ))
                sess.add(TideObs(
                    site_key="dauin_muck", ts=ts,
                    height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
                ))
            sess.commit()
        finally:
            sess.close()
        import unittest.mock as mock
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession):
            out = suggest_active_labels("dauin_muck", days=30, top_n=5)
        engine.dispose()
    for s in out:
        assert UNCERTAINTY_LOW <= s["p_bad"] <= UNCERTAINTY_HIGH


def test_suggest_active_labels_no_today():
    """Today must never appear — the lookback starts at offset 1."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.lib.active_learning import suggest_active_labels

    with tempfile.TemporaryDirectory() as tmpdir:
        engine = create_engine(f"sqlite:///{tmpdir}/al.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        sess = TestSession()
        try:
            now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
            rng = np.random.RandomState(42)
            for h in range(3 * 24):
                ts = now - timedelta(hours=3 * 24 - 1 - h)
                sess.add(WeatherObs(
                    site_key="dauin_muck", ts=ts,
                    precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                    wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                    wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                    wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                    sea_temp_c=rng.normal(28.0, 1.0),
                ))
                sess.add(TideObs(
                    site_key="dauin_muck", ts=ts,
                    height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
                ))
            sess.commit()
        finally:
            sess.close()
        import unittest.mock as mock
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession):
            out = suggest_active_labels("dauin_muck", days=2, top_n=3)
        engine.dispose()
    today_iso = datetime.now(timezone.utc).date().isoformat()
    for s in out:
        assert s["date"] != today_iso


# ── Cross-site summary ─────────────────────────────────────────────────────

def test_active_learning_summary_structure():
    """The summary endpoint payload must have the documented shape.

    Uses a fresh temp DB so it doesn't interfere with other tests that
    may have mutated the production DB.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    from app.lib.db import Base
    from app.lib import db as db_mod
    from app.lib.active_learning import active_learning_summary

    with tempfile.TemporaryDirectory() as tmpdir:
        engine = create_engine(f"sqlite:///{tmpdir}/al.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        import unittest.mock as mock
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession):
            summary = active_learning_summary()
        engine.dispose()
    assert "uncertainty_band" in summary
    assert "lookback_days" in summary
    assert "top_n" in summary
    assert "calibrator_method" in summary
    assert "per_site" in summary
    assert "total" in summary
    assert set(summary["per_site"].keys()) == {"dauin_muck", "apo_reef"}
    assert summary["total"] == sum(summary["per_site"].values())


# ── Filter on already-labeled dates ────────────────────────────────────────

def _isolated_db_with_module_patch():
    """Yield (engine, TestSession) and patch app.lib.db to use them."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    from app.lib.db import Base
    from app.lib import db as db_mod
    import unittest.mock as mock

    tmpdir = tempfile.mkdtemp()
    engine = create_engine(f"sqlite:///{tmpdir}/al.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)
    cm = mock.patch.object(db_mod, "SessionLocal", TestSession)
    cm2 = mock.patch.object(db_mod, "engine", engine)
    cm.start()
    cm2.start()
    try:
        yield engine, TestSession
    finally:
        cm.stop()
        cm2.stop()
        engine.dispose()


def test_already_labeled_filters_out_high_confidence():
    """A NoDiveLabel with confidence='high' must suppress the suggestion."""
    from app.lib.db import NoDiveLabel
    from app.lib.active_learning import _already_labeled

    for engine, TestSession in _isolated_db_with_module_patch():
        sess = TestSession()
        try:
            target = date(2025, 1, 1)
            sess.add(NoDiveLabel(
                site_key="dauin_muck", date=target,
                label="dive", source="test_phase8", confidence="high",
            ))
            sess.commit()
            assert _already_labeled("dauin_muck", target) is True
        finally:
            sess.close()


def test_already_labeled_does_not_block_low_confidence():
    """A NoDiveLabel with confidence='low' must NOT suppress."""
    from app.lib.db import NoDiveLabel
    from app.lib.active_learning import _already_labeled

    for engine, TestSession in _isolated_db_with_module_patch():
        sess = TestSession()
        try:
            target = date(2025, 1, 2)
            sess.add(NoDiveLabel(
                site_key="dauin_muck", date=target,
                label="dive", source="test_phase8", confidence="low",
            ))
            sess.commit()
            assert _already_labeled("dauin_muck", target) is False
        finally:
            sess.close()


def test_already_labeled_respects_operator_verification():
    """An OperatorVerification row must suppress regardless of confidence."""
    from app.lib.db import OperatorVerification
    from app.lib.active_learning import _already_labeled

    for engine, TestSession in _isolated_db_with_module_patch():
        sess = TestSession()
        try:
            target = date(2025, 1, 3)
            sess.add(OperatorVerification(
                site_key="dauin_muck", date=target,
                verdict="dive", operator="test_phase8",
            ))
            sess.commit()
            assert _already_labeled("dauin_muck", target) is True
        finally:
            sess.close()


# ── API endpoint smoke ─────────────────────────────────────────────────────

def test_api_suggestions_endpoint_returns_active_learning_response():
    """The GET /api/v1/active-learning/suggestions endpoint must return
    a properly-shaped payload via FastAPI's TestClient.

    Uses an isolated DB seeded with 30d of weather so the suggestion
    engine has something to replay.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from fastapi.testclient import TestClient
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.api.main import app
    import unittest.mock as mock

    tmpdir = tempfile.mkdtemp()
    engine = create_engine(f"sqlite:///{tmpdir}/api.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)
    sess = TestSession()
    try:
        now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        rng = np.random.RandomState(42)
        for h in range(30 * 24):
            ts = now - timedelta(hours=30 * 24 - 1 - h)
            sess.add(WeatherObs(
                site_key="dauin_muck", ts=ts,
                precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                sea_temp_c=rng.normal(28.0, 1.0),
            ))
            sess.add(TideObs(
                site_key="dauin_muck", ts=ts,
                height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
            ))
        sess.commit()
    finally:
        sess.close()
    with mock.patch.object(db_mod, "engine", engine), \
         mock.patch.object(db_mod, "SessionLocal", TestSession):
        client = TestClient(app)
        res = client.get("/api/v1/active-learning/suggestions?site=dauin_muck&days=7&top_n=3")
    engine.dispose()
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["site_key"] == "dauin_muck"
    assert body["uncertainty_band"] == [0.35, 0.65]
    assert body["lookback_days"] == 7
    assert isinstance(body["suggestions"], list)
    for s in body["suggestions"]:
        assert set(s.keys()) >= {
            "site_key", "date", "p_bad", "uncertainty",
            "model_source", "rank", "reason",
        }


def test_api_suggestions_endpoint_404_for_unknown_site():
    """Unknown sites must return 404, not an empty list."""
    from fastapi.testclient import TestClient
    from app.api.main import app
    client = TestClient(app)
    res = client.get("/api/v1/active-learning/suggestions?site=nowhere")
    assert res.status_code == 404


def test_api_summary_endpoint():
    """The GET /api/v1/active-learning/summary endpoint must return the
    cross-site snapshot."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    from fastapi.testclient import TestClient
    from app.lib.db import Base
    from app.lib import db as db_mod
    from app.api.main import app
    import unittest.mock as mock

    tmpdir = tempfile.mkdtemp()
    engine = create_engine(f"sqlite:///{tmpdir}/api.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)
    with mock.patch.object(db_mod, "engine", engine), \
         mock.patch.object(db_mod, "SessionLocal", TestSession):
        client = TestClient(app)
        res = client.get("/api/v1/active-learning/summary")
    engine.dispose()
    assert res.status_code == 200, res.text
    body = res.json()
    assert "uncertainty_band" in body
    assert "per_site" in body
    assert "total" in body


# ── Integration with /verify (confirm closes the loop) ─────────────────────

def test_verify_closes_the_active_learning_loop():
    """Submitting a /verify for a date must remove it from the active
    learning queue on the next call."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import tempfile
    import numpy as np
    from fastapi.testclient import TestClient
    from app.lib.db import Base, WeatherObs, TideObs
    from app.lib import db as db_mod
    from app.api.main import app
    from app.lib.active_learning import suggest_active_labels
    import unittest.mock as mock

    tmpdir = tempfile.mkdtemp()
    engine = create_engine(f"sqlite:///{tmpdir}/loop.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)

    sess = TestSession()
    try:
        now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        rng = np.random.RandomState(42)
        for h in range(30 * 24):
            ts = now - timedelta(hours=30 * 24 - 1 - h)
            sess.add(WeatherObs(
                site_key="dauin_muck", ts=ts,
                precip_mm=max(0.0, rng.normal(2.0, 3.0)),
                wind_max_kmh=max(0.0, rng.normal(15.0, 8.0)),
                wind_mean_kmh=max(0.0, rng.normal(10.0, 5.0)),
                wave_max_m=max(0.0, rng.normal(0.8, 0.4)),
                sea_temp_c=rng.normal(28.0, 1.0),
            ))
            sess.add(TideObs(
                site_key="dauin_muck", ts=ts,
                height_m=0.5 * np.sin(2 * np.pi * h / 12.42) + rng.normal(0, 0.05),
            ))
        sess.commit()
    finally:
        sess.close()

    with mock.patch.object(db_mod, "engine", engine), \
         mock.patch.object(db_mod, "SessionLocal", TestSession):
        sugg = suggest_active_labels("dauin_muck", days=30, top_n=10)
        in_band_dates = [s["date"] for s in sugg]
        if not in_band_dates:
            engine.dispose()
            pytest.skip("no in-band dates to test against")
        target_iso = in_band_dates[0]

        client = TestClient(app)
        res = client.post("/api/v1/verify", json={
            "site_key": "dauin_muck",
            "date": target_iso,
            "verdict": "dive",
            "no_go_reason": None,
            "confidence": "high",
            "operator": "test_phase8_loop",
            "comments": "active-learning loop test",
        })
        assert res.status_code == 200, res.text

        sugg_after = suggest_active_labels("dauin_muck", days=30, top_n=10)
        after_dates = [s["date"] for s in sugg_after]
    engine.dispose()
    assert target_iso not in after_dates