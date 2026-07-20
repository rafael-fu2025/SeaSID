"""Authentication and authorization regression tests."""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app
from app.lib import db


def _users(*, role: str = "admin", site_keys: list[str] | None = None) -> str:
    return json.dumps([{
        "username": "alice",
        "password": "correct horse battery staple",
        "role": role,
        "site_keys": site_keys or ["*"],
    }])


@pytest.mark.asyncio
async def test_protected_route_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/forecast?site=dauin_muck")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_returns_token_and_me_returns_identity(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users(role="operator"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse battery staple"},
        )
        assert login_response.status_code == 200
        payload = login_response.json()
        assert payload["token_type"] == "bearer"
        assert payload["user"]["role"] == "operator"

        me_response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )

    assert me_response.status_code == 200
    assert me_response.json()["username"] == "alice"


@pytest.mark.asyncio
async def test_viewer_cannot_submit_verification(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users(role="viewer"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse battery staple"},
        )
        token = login_response.json()["access_token"]
        response = await client.post(
            "/api/v1/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "site_key": "dauin_muck",
                "date": "2026-07-19",
                "verdict": "dive",
            },
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_authenticated_verification_uses_token_identity(monkeypatch, db_session):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users(role="operator"))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse battery staple"},
        )
        token = login_response.json()["access_token"]
        response = await client.post(
            "/api/v1/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "site_key": "dauin_muck",
                "operator": "spoofed name",
                "date": "2026-07-19",
                "verdict": "dive",
            },
        )

    assert response.status_code == 200
    verification = db_session.query(db.OperatorVerification).one()
    assert verification.operator == "alice"
    assert verification.actor_id == "alice"


@pytest.mark.asyncio
async def test_site_scope_is_enforced(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users(role="operator", site_keys=["dauin_muck"]))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse battery staple"},
        )
        token = login_response.json()["access_token"]
        response = await client.get(
            "/api/v1/forecast?site=apo_reef",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_site_scoped_user_cannot_request_all_alerts(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users(role="viewer", site_keys=["dauin_muck"]))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse battery staple"},
        )
        token = login_response.json()["access_token"]
        response = await client.get(
            "/api/v1/alerts",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_dev_default_credentials_bootstrap_login(monkeypatch):
    """Without any user config the built-in dev defaults let each role log in."""
    for key in (
        "SEASID_AUTH_USERS_JSON",
        "SEASID_ADMIN_USERNAME",
        "SEASID_ADMIN_PASSWORD",
        "SEASID_AUTH_SECRET",
        "SEASID_AUTH_REQUIRE_EXPLICIT_USERS",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")

    expected = [
        ("admin", "admin-dev", "admin", ("*",)),
        ("steward", "steward-dev", "data_steward", ("*",)),
        ("dauin-operator", "operator-dev", "operator", ("dauin_muck",)),
        ("reef-operator", "operator-dev", "operator", ("apo_reef",)),
        ("viewer", "viewer-dev", "viewer", ("*",)),
    ]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for username, password, role, site_keys in expected:
            response = await client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": password},
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["user"]["username"] == username
            assert body["user"]["role"] == role
            assert tuple(body["user"]["site_keys"]) == site_keys


@pytest.mark.asyncio
async def test_dev_defaults_disabled_when_explicit_users_required(monkeypatch):
    """SEASID_AUTH_REQUIRE_EXPLICIT_USERS=true suppresses the default fallback."""
    for key in (
        "SEASID_AUTH_USERS_JSON",
        "SEASID_ADMIN_USERNAME",
        "SEASID_ADMIN_PASSWORD",
        "SEASID_AUTH_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_REQUIRE_EXPLICIT_USERS", "true")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin-dev"},
        )

    # Without any configured users the login route refuses the attempt (401).
    assert response.status_code in {401, 503}


@pytest.mark.asyncio
async def test_dev_defaults_token_works_for_protected_route(monkeypatch):
    """A token minted from the dev defaults is accepted by a protected route."""
    for key in (
        "SEASID_AUTH_USERS_JSON",
        "SEASID_ADMIN_USERNAME",
        "SEASID_ADMIN_PASSWORD",
        "SEASID_AUTH_SECRET",
        "SEASID_AUTH_REQUIRE_EXPLICIT_USERS",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"username": "viewer", "password": "viewer-dev"},
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        me = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert me.status_code == 200
    assert me.json()["username"] == "viewer"
    assert me.json()["role"] == "viewer"
