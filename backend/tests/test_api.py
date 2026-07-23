"""
Tests for the FastAPI endpoints.

Uses httpx async test client for testing.

Covers:
1. Health endpoint returns 200
2. Sites endpoint returns list of sites
3. Forecast returns valid structure
4. Verify endpoint accepts submissions
5. Labels endpoint works
6. Alerts endpoint works
"""

import sys
from datetime import date
from pathlib import Path

import json
import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.main import app
from app.lib.features import FEATURE_COLUMNS


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
class TestHealthEndpoint:
    async def test_health_returns_200(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert "selected_tier" in data
        assert "selection_reason" in data

    async def test_health_has_model_info(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/health")
        data = response.json()
        assert "model_loaded" in data


@pytest.mark.asyncio
class TestSitesEndpoint:
    async def test_list_sites(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/sites")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        keys = {s["key"] for s in data}
        assert "dauin_muck" in keys
        assert "apo_reef" in keys


@pytest.mark.asyncio
class TestForecastEndpoint:
    async def test_forecast_valid_site(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/forecast?site=dauin_muck")
        assert response.status_code == 200
        data = response.json()
        assert data["site_key"] == "dauin_muck"
        assert "hours" in data
        assert len(data["hours"]) > 0
        assert data["ml_bundle_loaded"] is False
        assert data["forecast_source"] == "rule_based"

    async def test_forecast_invalid_site(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/forecast?site=nonexistent")
        assert response.status_code == 404


@pytest.mark.asyncio
class TestVerifyEndpoint:
    async def test_submit_verification(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post("/api/v1/verify", json={
                "site_key": "dauin_muck",
                "operator": "Test Operator",
                "date": "2026-07-09",
                "verdict": "dive",
                "actual_viz_m": 15.0,
                "actual_current": "Low",
                "comments": "Test verification",
            })
        assert response.status_code == 200
        data = response.json()
        assert data["verdict"] == "dive"
        assert "id" in data


@pytest.mark.asyncio
class TestLabelsEndpoint:
    async def test_get_labels(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/labels?site=dauin_muck")
        assert response.status_code == 200
        data = response.json()
        assert "labels" in data
        assert "total" in data


@pytest.mark.asyncio
class TestAlertsEndpoint:
    async def test_get_alerts(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/alerts")
        assert response.status_code == 200
        data = response.json()
        assert "alerts" in data


@pytest.mark.asyncio
class TestExperimentsEndpoint:
    async def test_get_results_empty(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/experiments/results")
        assert response.status_code == 200
        # Should return empty results when no experiments have been run
        data = response.json()
        assert "best_model" in data


def _parse_sse_frames(body: str) -> list[dict]:
    """Tiny SSE parser — split on blank lines, decode each `data:` payload.

    Used by the /experiments/run/stream tests to assert the wire format
    the frontend (Experiments.jsx + api.js) consumes. We only care about
    the JSON inside ``data:`` frames; other SSE fields are ignored.
    """
    frames: list[dict] = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        for line in block.splitlines():
            line = line.strip()
            if not line.startswith("data: "):
                continue
            try:
                frames.append(json.loads(line[len("data: "):]))
            except json.JSONDecodeError:
                # Skip non-JSON or comment frames.
                continue
    return frames


@pytest.mark.asyncio
class TestExperimentsStreamEndpoint:
    """Regression guard for the /api/v1/experiments/run/stream SSE endpoint.

    The Experiments page (Experiments.jsx + api.js) has always POSTed to
    ``/api/v1/experiments/run/stream`` for the live progress UI. Earlier
    revisions of the backend forgot to wire this route, surfacing as an
    opaque HTTP 404 the moment an operator clicked "Run suite". These
    tests pin both the route and the wire format the page consumes.
    """

    async def test_stream_endpoint_is_registered(self):
        """The /experiments/run/stream route must exist (not 404)."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post(
                "/api/v1/experiments/run/stream",
                headers={"Accept": "text/event-stream"},
            )
        # SSE responses are 200 even when the inner event is `error`.
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

    async def test_stream_emits_error_when_no_labels(self):
        """Empty DB → first event must be {type: 'error'}."""
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post("/api/v1/experiments/run/stream")
        assert response.status_code == 200
        frames = _parse_sse_frames(response.text)
        assert frames, "expected at least one SSE frame in the response body"
        assert frames[0]["type"] == "error"
        # Same message the page renders verbatim in the error card.
        assert "No labels in database" in frames[0]["message"]

    async def test_stream_emits_status_log_metric_done_in_order(self):
        """With labels + monkeypatched suite, frames must arrive in the
        order the frontend (Experiments.jsx) expects."""
        # ── 1. Set up an isolated DB with one NoDiveLabel so the
        #        endpoint does not short-circuit on the empty-DB error.
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        import tempfile
        from app.lib.db import Base, NoDiveLabel
        from app.lib import db as db_mod
        import unittest.mock as mock

        tmpdir = tempfile.mkdtemp()
        engine = create_engine(
            f"sqlite:///{tmpdir}/exp_stream.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=engine)
        TestSession = sessionmaker(bind=engine)
        sess = TestSession()
        try:
            sess.add(NoDiveLabel(
                site_key="dauin_muck",
                date=date(2026, 6, 15),
                label="GO",
                confidence="high",
                source="test_stream",
            ))
            sess.commit()
        finally:
            sess.close()

        # ── 2. Monkeypatch the heavy bits. We don't want the test to
        #        actually train LSTM/XGBoost — just prove the endpoint
        #        wires the suite's callbacks through to SSE frames.
        fake_results = {
            "timestamp": "2026-07-22T00:00:00+00:00",
            "best_model": "xgb",
            "model_comparison": {
                "rule": {"accuracy": 0.7, "precision": 0.7, "recall": 1.0, "f1": 0.83, "auc_roc": 0.5},
                "xgb":  {"accuracy": 0.9, "precision": 0.9, "recall": 0.9, "f1": 0.9, "auc_roc": 0.9},
                "lstm": {"accuracy": 0.8, "precision": 0.8, "recall": 0.8, "f1": 0.8, "auc_roc": 0.8},
                "gru":  {"accuracy": 0.75, "precision": 0.75, "recall": 0.75, "f1": 0.75, "auc_roc": 0.75},
            },
            "ablations": {},
            "dataset": {"total_samples": 1, "train_size": 1, "val_size": 0, "test_size": 0},
        }

        from app.lib import experiments as exp_mod
        from app.lib import features as features_mod

        def _fake_suite(
            X_flat, y, X_seq, y_arr,
            label_dates=None, label_site_keys=None,
            progress_callback=None, metric_callback=None,
        ):
            # Emit one progress line + four metric events — exactly what
            # the real suite produces in production.
            if progress_callback:
                progress_callback("Running experiments on 1 samples...")
                progress_callback("  Training: XGBoost (Baseline 2)...")
            if metric_callback:
                for k, v in fake_results["model_comparison"].items():
                    metric_callback(k, v)
            return fake_results

        def _fake_features(site_key, target_ts):  # noqa: ARG001
            import pandas as pd
            return pd.DataFrame([[0.0] * len(FEATURE_COLUMNS)], columns=FEATURE_COLUMNS)

        def _fake_sequence(site_key, target_ts, window_hours=24):  # noqa: ARG001
            import numpy as np
            return np.zeros((window_hours, len(FEATURE_COLUMNS)), dtype=np.float32)

        # The endpoint imports build_features / build_sequence lazily
        # from app.lib.features inside the function body, so we patch
        # the source module — that's where the lookup happens.
        with mock.patch.object(db_mod, "engine", engine), \
             mock.patch.object(db_mod, "SessionLocal", TestSession), \
             mock.patch.object(exp_mod, "run_full_experiment_suite", side_effect=_fake_suite), \
             mock.patch.object(features_mod, "build_features", _fake_features), \
             mock.patch.object(features_mod, "build_sequence", _fake_sequence):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                response = await ac.post("/api/v1/experiments/run/stream")
        engine.dispose()

        assert response.status_code == 200
        frames = _parse_sse_frames(response.text)
        kinds = [f.get("type") for f in frames]

        # Lifecycle must be: status(loading) → status(running) →
        # (logs + metrics interleaved) → done → status(complete).
        assert kinds[0] == "status" and kinds[0] and frames[0]["stage"] == "loading"
        assert kinds[1] == "status" and frames[1]["stage"] == "running"
        assert "log" in kinds
        metric_frames = [f for f in frames if f.get("type") == "metric"]
        assert len(metric_frames) == 4
        assert {f["model"] for f in metric_frames} == {"rule", "xgb", "lstm", "gru"}
        assert kinds[-1] == "status" and frames[-1]["stage"] == "complete"
        done = [f for f in frames if f.get("type") == "done"]
        assert len(done) == 1
        assert done[0]["best_model"] == "xgb"
        # The full results payload rides on the `done` frame so the page
        # can populate the table even if it never re-fetches /results.
        assert done[0]["results"]["model_comparison"]["xgb"]["f1"] == 0.9
        # No stray `error` frames on the happy path.
        assert "error" not in kinds
