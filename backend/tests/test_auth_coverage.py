"""Auth-coverage regression tests (audit F-B3-01 / F-C1-01).

Two layers:

1. **Structural** — every ``/api/v1`` route must either be in the public
   allow-list or carry the ``get_current_principal`` dependency. This makes
   "someone forgot the Depends()" structurally impossible to merge.
2. **Behavioral** — with authentication *enabled*, anonymous requests get
   401 on every protected route, a viewer gets 403 on operator/admin routes,
   and an admin gets through. The main suite runs with auth disabled; this
   file is the one place that exercises the enabled path.
"""
from __future__ import annotations

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.main import app
from app.auth import get_current_principal

# Routes reachable without a token, by design.
PUBLIC_PATHS = {
    "/api/v1/health",
    "/api/v1/sites",
    "/api/v1/auth/login",
}


def _v1_routes() -> list[APIRoute]:
    return [
        r for r in app.routes
        if isinstance(r, APIRoute) and r.path.startswith("/api/v1")
    ]


def _is_guarded(route: APIRoute) -> bool:
    for dep in route.dependencies:
        if getattr(dep, "call", None) is get_current_principal:
            return True
    # fastapi also surfaces security dependencies via dependant
    dependant = getattr(route, "dependant", None)
    if dependant is not None:
        for dep in dependant.dependencies:
            if getattr(dep, "call", None) is get_current_principal:
                return True
    return False


def test_every_v1_route_is_public_or_auth_guarded():
    """No /api/v1 route may ship without auth or an explicit public listing."""
    unguarded = [
        f"{sorted(r.methods)[0]} {r.path}"
        for r in _v1_routes()
        if r.path not in PUBLIC_PATHS and not _is_guarded(r)
    ]
    assert unguarded == [], (
        "routes missing authentication dependency (audit F-B3-01): "
        + ", ".join(unguarded)
    )


def test_public_routes_exist():
    """The allow-list must stay minimal — guard against accidental additions."""
    paths = {r.path for r in _v1_routes()}
    extra = PUBLIC_PATHS - paths
    assert extra == set(), f"public allow-list references missing routes: {extra}"


# ── Behavioral: auth enabled end-to-end ───────────────────────────────────

@pytest.fixture()
def auth_client(db_session, monkeypatch):
    """TestClient with authentication enabled and two DB users seeded."""
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "x" * 32)
    monkeypatch.setenv("SEASID_AUTH_REQUIRE_EXPLICIT_USERS", "true")
    monkeypatch.setenv("SEASID_RATELIMIT_ENABLED", "false")

    from app.lib.user_store import create_user
    try:
        create_user(username="cov-viewer", password="viewer-pass-1", role="viewer")
    except ValueError:
        pass
    try:
        create_user(username="cov-admin", password="admin-pass-1", role="admin")
    except ValueError:
        pass

    with TestClient(app) as client:
        yield client


def _login(client: TestClient, username: str, password: str) -> dict:
    res = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_anonymous_requests_are_denied_on_protected_routes(auth_client):
    client = auth_client

    assert client.get("/api/v1/forecast?site=dauin_muck").status_code == 401
    assert client.get("/api/v1/labels").status_code == 401
    assert client.get("/api/v1/alerts").status_code == 401
    assert client.get("/api/v1/experiments/results").status_code == 401
    assert client.get("/api/v1/active-learning/suggestions?site=dauin_muck").status_code == 401
    assert client.post("/api/v1/ingest", json={"site_key": "dauin_muck"}).status_code == 401
    assert client.post("/api/v1/alerts/run").status_code == 401
    assert client.post("/api/v1/experiments/run").status_code == 401
    assert client.post(
        "/api/v1/agent/chat", json={"message": "hi"},
    ).status_code == 401
    assert client.get("/api/v1/agent/briefing?site=dauin_muck").status_code == 401

    # Health, sites, and login stay public.
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/sites").status_code == 200


def test_viewer_cannot_reach_operator_or_admin_routes(auth_client):
    client = auth_client
    headers = _login(client, "cov-viewer", "viewer-pass-1")

    # Read routes a viewer may use.
    assert client.get("/api/v1/labels", headers=headers).status_code == 200
    # Operator+ routes deny viewers.
    assert client.post(
        "/api/v1/ingest", headers=headers, json={"site_key": "dauin_muck"},
    ).status_code == 403
    assert client.post("/api/v1/alerts/run", headers=headers).status_code == 403
    assert client.post("/api/v1/experiments/run", headers=headers).status_code == 403
    assert client.post(
        "/api/v1/verify", headers=headers,
        json={"site_key": "dauin_muck", "date": "2026-01-01", "verdict": "dive"},
    ).status_code == 403
    # Admin routes deny viewers.
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 403
    assert client.get("/api/v1/admin/api-keys", headers=headers).status_code == 403


def test_admin_can_reach_admin_routes(auth_client):
    client = auth_client
    headers = _login(client, "cov-admin", "admin-pass-1")
    assert client.get("/api/v1/admin/users", headers=headers).status_code == 200
    assert client.get("/api/v1/admin/audit", headers=headers).status_code == 200


def test_disabled_user_token_is_rejected(auth_client, db_session, monkeypatch):
    """A token issued before the account was disabled must stop working
    within one request (audit F-B4-05)."""
    client = auth_client
    headers = _login(client, "cov-viewer", "viewer-pass-1")

    # Sanity: token works.
    assert client.get("/api/v1/labels", headers=headers).status_code == 200

    # Disable the account directly in the store.
    from app.lib.user_store import list_users, update_user
    (user,) = [u for u in list_users() if u["username"] == "cov-viewer"]
    update_user(user["id"], enabled=False)

    assert client.get("/api/v1/labels", headers=headers).status_code == 401
