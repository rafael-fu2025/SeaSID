"""Provider API key admin endpoint tests + rotation tests."""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.main import app


def _admin_users():
    return json.dumps([{
        "username": "admin1",
        "password": "admin-pw-12345",
        "role": "admin",
        "site_keys": ["*"],
    }])


@pytest.mark.asyncio
async def test_admin_api_key_lifecycle(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "admin1",
            "password": "admin-pw-12345",
            "role": "admin",
            "site_keys": ["*"],
        }]),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = (await client.post(
            "/api/v1/auth/login",
            json={"username": "admin1", "password": "admin-pw-12345"},
        )).json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        # Create two LLM keys
        k1 = await client.post(
            "/api/v1/admin/api-keys",
            headers=auth,
            json={"provider": "llm", "label": "primary", "value": "sk-test-AAAA"},
        )
        assert k1.status_code == 201
        k1 = k1.json()["key"]

        k2 = await client.post(
            "/api/v1/admin/api-keys",
            headers=auth,
            json={"provider": "llm", "label": "backup", "value": "sk-test-BBBB"},
        )
        assert k2.status_code == 201
        k2 = k2.json()["key"]

        # List should expose only preview, never the raw value
        lst = await client.get("/api/v1/admin/api-keys", headers=auth)
        assert lst.status_code == 200
        body = lst.json()
        all_keys = body["keys"]
        raw_blob = json.dumps(all_keys)
        assert "sk-test-AAAA" not in raw_blob
        assert "sk-test-BBBB" not in raw_blob
        assert any(k["value_preview"].endswith("AAAA") for k in all_keys)
        assert body["configs"]["llm"]["base_url"] is None

        config_update = await client.patch(
            "/api/v1/admin/provider-configs/llm",
            headers=auth,
            json={"base_url": "https://llm.example.test/v1"},
        )
        assert config_update.status_code == 200
        assert config_update.json()["config"]["base_url"] == "https://llm.example.test/v1"

        updated_list = await client.get("/api/v1/admin/api-keys", headers=auth)
        assert updated_list.json()["configs"]["llm"]["base_url"] == "https://llm.example.test/v1"

        # Disable backup; rotation should now skip it
        update = await client.patch(
            f"/api/v1/admin/api-keys/{k2['id']}",
            headers=auth,
            json={"enabled": False},
        )
        assert update.status_code == 200

        # Delete
        delete = await client.delete(
            f"/api/v1/admin/api-keys/{k1['id']}",
            headers=auth,
        )
        assert delete.status_code == 204


@pytest.mark.asyncio
async def test_admin_api_key_non_admin_forbidden(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "operator1",
            "password": "op-pw-12345",
            "role": "operator",
            "site_keys": ["*"],
        }]),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = (await client.post(
            "/api/v1/auth/login",
            json={"username": "operator1", "password": "op-pw-12345"},
        )).json()["access_token"]
        response = await client.get(
            "/api/v1/admin/api-keys",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 403


def test_secret_store_roundtrip():
    from app.secret_store import encrypt, decrypt_str
    key = "x" * 32
    envelope = encrypt("hello-secret-value", key)
    assert decrypt_str(envelope, key) == "hello-secret-value"


def test_secret_store_rejects_wrong_key():
    import pytest as _pytest
    from app.secret_store import encrypt, decrypt_str
    with _pytest.raises(ValueError):
        decrypt_str(encrypt("payload", "a" * 32), "b" * 32)


def test_provider_keys_pick_rotates_and_skips_disabled(db_session, monkeypatch):
    """The rotation helper should round-robin among enabled keys.

    Uses the auto-use ``db_session`` fixture so we exercise the real
    SQLAlchemy Session + SQL flow rather than a brittle mock.
    """
    from app.lib import provider_keys, db as _db
    from app.lib.user_store import _parse_site_keys  # noqa: F401

    # Two LLM keys: one enabled, one disabled.
    a = _db.ProviderApiKey(
        provider="llm",
        label="primary",
        value_encrypted=provider_keys._encrypt_value("sk-test-AAAA"),
        enabled=True,
    )
    b = _db.ProviderApiKey(
        provider="llm",
        label="backup",
        value_encrypted=provider_keys._encrypt_value("sk-test-BBBB"),
        enabled=False,
    )
    db_session.add_all([a, b])
    db_session.commit()
    db_session.refresh(a)
    db_session.refresh(b)

    picked = provider_keys.pick_provider_key("llm")
    assert picked is not None
    assert picked.id == a.id, "disabled key should be skipped"
    assert picked.value == "sk-test-AAAA"

    # Mark the active one as recently errored past the threshold.
    a.error_count = 10  # >= MAX_RECENT_ERRORS=3
    db_session.commit()

    picked_again = provider_keys.pick_provider_key("llm")
    # Only backup remains but it's disabled; nothing usable.
    assert picked_again is None

    updated = provider_keys.update_provider_key(a.id, value="sk-test-UPDATED")
    assert updated is not None
    recovered = provider_keys.pick_provider_key("llm")
    assert recovered is not None
    assert recovered.id == a.id
    assert recovered.value == "sk-test-UPDATED"


def test_pick_provider_key_tolerates_naive_cooldown_until_from_sqlite(db_session):
    """SQLite strips timezone info on read; pick_provider_key must not
    raise ``TypeError: can't compare offset-naive and offset-aware
    datetimes`` when ``cooldown_until`` is in the future but naive.
    """
    from datetime import datetime, timedelta, timezone
    from app.lib import provider_keys, db as _db

    future_utc = datetime.now(timezone.utc) + timedelta(minutes=5)
    future_naive = future_utc.replace(tzinfo=None)
    row = _db.ProviderApiKey(
        provider="llm",
        label="cooling-down",
        value_encrypted=provider_keys._encrypt_value("sk-cooling"),
        enabled=True,
        cooldown_until=future_naive,
        error_count=0,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    # The row is still on cooldown; pick_provider_key must skip it without
    # raising the offset-naive vs offset-aware TypeError. There are no
    # other usable keys so the result is None.
    picked = provider_keys.pick_provider_key("llm")
    assert picked is None

    # _as_utc must round-trip naive values through to aware UTC.
    normalized = provider_keys._as_utc(future_naive)
    assert normalized is not None
    assert normalized.tzinfo is not None
    assert normalized == future_utc


def test_provider_keys_never_fall_back_to_environment(monkeypatch):
    from app.lib import provider_keys

    monkeypatch.setenv("OPENAI_API_KEY", "sk-must-not-be-used")
    assert provider_keys.resolve_provider_value("llm") is None


def test_multiple_enabled_keys_rotate_within_one_provider():
    from app.lib import provider_keys

    first = provider_keys.create_provider_key(
        provider="llm",
        label="primary",
        value="sk-primary",
    )
    second = provider_keys.create_provider_key(
        provider="llm",
        label="backup",
        value="sk-backup",
    )

    picked_first = provider_keys.pick_provider_key("llm")
    picked_second = provider_keys.pick_provider_key("llm")

    assert picked_first is not None and picked_first.id == first["id"]
    assert picked_second is not None and picked_second.id == second["id"]


def test_legacy_openai_rows_merge_into_one_llm_provider(db_session):
    from app.lib import db as _db
    from app.lib import provider_keys

    db_session.add_all([
        _db.ProviderApiKey(
            provider="llm",
            label="bootstrapped-from-env",
            value_encrypted=provider_keys._encrypt_value("sk-first"),
            enabled=True,
            created_by_subject="bootstrap",
        ),
        _db.ProviderApiKey(
            provider="openai",
            label="bootstrapped-from-env",
            value_encrypted=provider_keys._encrypt_value("sk-second"),
            enabled=True,
            created_by_subject="bootstrap",
        ),
    ])
    db_session.commit()

    result = provider_keys.normalize_legacy_provider_rows()
    rows = provider_keys.list_provider_keys()

    assert result["migrated"] == 2
    assert {row["provider"] for row in rows} == {"llm"}
    assert len(rows) == 2
    assert len({row["label"] for row in rows}) == 2

@pytest.mark.asyncio
async def test_admin_api_key_reveal_returns_decrypted_value(monkeypatch):
    """POST /admin/api-keys/{id}/reveal should return the plaintext, not the preview."""
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "admin1",
            "password": "admin-pw-12345",
            "role": "admin",
            "site_keys": ["*"],
        }]),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = (await client.post(
            "/api/v1/auth/login",
            json={"username": "admin1", "password": "admin-pw-12345"},
        )).json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        created = await client.post(
            "/api/v1/admin/api-keys",
            headers=auth,
            json={"provider": "llm", "label": "primary", "value": "sk-plaintext-secret-7777"},
        )
        assert created.status_code == 201
        key_id = created.json()["key"]["id"]

        # Reveal returns the plaintext
        reveal = await client.post(
            f"/api/v1/admin/api-keys/{key_id}/reveal",
            headers=auth,
        )
        assert reveal.status_code == 200
        body = reveal.json()
        assert body["id"] == key_id
        assert body["value"] == "sk-plaintext-secret-7777"
        assert body["value_preview"].endswith("7777")
        assert reveal.headers["cache-control"] == "no-store"

        # List still masks the value
        listed_resp = await client.get("/api/v1/admin/api-keys", headers=auth)
        assert listed_resp.status_code == 200
        raw_blob = json.dumps(listed_resp.json())
        assert "sk-plaintext-secret-7777" not in raw_blob


@pytest.mark.asyncio
async def test_admin_api_key_reveal_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setenv("SEASID_AUTH_ENABLED", "true")
    monkeypatch.setenv("SEASID_AUTH_SECRET", "s" * 40)
    monkeypatch.setenv(
        "SEASID_AUTH_USERS_JSON",
        json.dumps([{
            "username": "operator1",
            "password": "op-pw-12345",
            "role": "operator",
            "site_keys": ["*"],
        }]),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = (await client.post(
            "/api/v1/auth/login",
            json={"username": "operator1", "password": "op-pw-12345"},
        )).json()["access_token"]
        response = await client.post(
            "/api/v1/admin/api-keys/1/reveal",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 403
