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

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.main import app


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

    async def test_forecast_invalid_site(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/forecast?site=nonexistent")
        assert response.status_code == 404

    async def test_forecast_accepts_horizon(self, monkeypatch):
        from app.api import main as api_main

        captured = {}

        def fake_get_forecast(site_key, hours=48):
            captured.update(site_key=site_key, hours=hours)
            return {
                "site_key": site_key,
                "site_name": "Dauin Muck",
                "generated_at": "2026-07-15T00:00:00+00:00",
                "hours": [],
                "optimal_window": None,
            }

        monkeypatch.setattr(api_main, "get_forecast", fake_get_forecast)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/forecast?site=dauin_muck&hours=24")

        assert response.status_code == 200
        assert captured == {"site_key": "dauin_muck", "hours": 24}

    async def test_forecast_rejects_horizon_above_48(self):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.get("/api/v1/forecast?site=dauin_muck&hours=49")
        assert response.status_code == 422


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
