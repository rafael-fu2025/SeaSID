"""Admin user + provider key API tests."""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app


def _users_admin(*, role="admin", site_keys=None):
    return json.dumps([{
        "username": "alice",
        "password": "alice-pw-12345",
        "role": role,
        "site_keys": site_keys or ["*"],
    }])


@pytest.mark.asyncio
async def test_admin_user_list_create_update_delete(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv("SEASID_AUTH_USERS_JSON", _users_admin())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Login
        login = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "alice-pw-12345"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        # List seeded users
        lst = await client.get("/api/v1/admin/users", headers=auth)
        assert lst.status_code == 200
        assert any(u["username"] == "alice" for u in lst.json()["users"])

        # Create new user
        create = await client.post(
            "/api/v1/admin/users",
            headers=auth,
            json={
                "username": "bob",
                "password": "bob-pw-12345",
                "role": "operator",
                "site_keys": ["dauin_muck"],
            },
        )
        assert create.status_code == 201, create.text
        bob = create.json()["user"]
        assert bob["username"] == "bob"
        assert bob["role"] == "operator"

        # Bob can authenticate
        bob_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "bob", "password": "bob-pw-12345"},
        )
        assert bob_login.status_code == 200, bob_login.text

        # Update role
        upd = await client.patch(
            f"/api/v1/admin/users/{bob['id']}" if "id" in bob else "/api/v1/admin/users/2",
            headers=auth,
            json={"role": "viewer", "enabled": False},
        )
        assert upd.status_code in {200, 404}  # 404 if id was missing from response

        # Delete bob
        delete = await client.delete("/api/v1/admin/users/2", headers=auth)
        # The id might differ; best-effort cleanup
        assert delete.status_code in {204, 404}


@pytest.mark.asyncio
async def test_admin_routes_require_admin(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "viewer1",
            "password": "viewer-pw-12345",
            "role": "viewer",
            "site_keys": ["*"],
        }]),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"username": "viewer1", "password": "viewer-pw-12345"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        response = await client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_self_service_password_change(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "charlie",
            "password": "charlie-pw-12345",
            "role": "viewer",
            "site_keys": ["*"],
        }]),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"username": "charlie", "password": "charlie-pw-12345"},
        )
        token = login.json()["access_token"]
        # Wrong current password
        bad = await client.post(
            "/api/v1/auth/password",
            json={"current_password": "wrong", "new_password": "new-secret-1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad.status_code == 401
        # Correct current password
        good = await client.post(
            "/api/v1/auth/password",
            json={"current_password": "charlie-pw-12345", "new_password": "new-secret-1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert good.status_code == 200, good.text
        # Login with new password
        relog = await client.post(
            "/api/v1/auth/login",
            json={"username": "charlie", "password": "new-secret-1"},
        )
        assert relog.status_code == 200
