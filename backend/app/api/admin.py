"""Admin API: manage users and provider API keys.

These endpoints are gated to ``admin`` role only; non-admins receive 403.
The raw API key value is **never** returned by list/get endpoints; clients
receive ``value_preview`` containing only the last four characters of the
decrypted value.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.schemas import (
    ApiKeyCreate,
    ApiKeyUpdate,
    ProviderConfigUpdate,
    UserCreate,
    UserUpdate,
)
from app.auth import (
    Principal,
    ensure_role,
    get_current_principal,
)
from app.lib.user_store import (
    create_user,
    delete_user,
    get_user_by_username,
    list_users as db_list_users,
    update_user as db_update_user,
)

try:
    from app.lib import provider_keys as pkeys
except Exception:  # pragma: no cover
    pkeys = None  # type: ignore[assignment]


logger = logging.getLogger("seasid.admin")


def _reset_provider_registry() -> None:
    try:
        from app.lib.providers.registry import reset_registry

        reset_registry()
    except Exception:
        logger.debug("Provider registry reset skipped", exc_info=True)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _require_admin(principal: Principal) -> None:
    ensure_role(principal, "admin")


def _ensure_not_self(user_id: int, principal: Principal) -> None:
    """Audit F-B3-14: an admin must not disable/delete/demote themselves."""
    from app.lib.user_store import list_users

    me = next((u for u in list_users() if u["subject"] == principal.subject), None)
    if me is not None and me["id"] == user_id:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail="You cannot change or delete your own admin account — ask another admin.",
        )


# ── Users ───────────────────────────────────────────────────────────────
@router.get("/users")
def list_users(principal: Principal = Depends(get_current_principal)) -> dict:
    _require_admin(principal)
    return {"users": db_list_users()}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user_route(
    payload: UserCreate,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    _require_admin(principal)
    if get_user_by_username(payload.username):
        raise HTTPException(status_code=409, detail="Username already exists")
    try:
        user = create_user(
            username=payload.username,
            password=payload.password,
            role=payload.role,
            site_keys=payload.site_keys,
            subject=payload.subject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    from app.lib import audit
    audit.record("admin.user.created", actor=principal.subject,
                 detail={"username": user.username, "role": user.role})
    return {"user": _user_to_out(user)}


@router.patch("/users/{user_id}")
def update_user_route(
    user_id: int,
    payload: UserUpdate,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    _require_admin(principal)
    _ensure_not_self(user_id, principal)
    changes: dict[str, Any] = {}
    if payload.role is not None:
        changes["role"] = payload.role
    if payload.site_keys is not None:
        changes["site_keys"] = payload.site_keys
    if payload.enabled is not None:
        changes["enabled"] = payload.enabled
    if payload.password:
        changes["password"] = payload.password
    if payload.subject:
        changes["subject"] = payload.subject
    try:
        user = db_update_user(user_id, **changes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    from app.lib import audit
    audit.record("admin.user.updated", actor=principal.subject,
                 detail={"user_id": user_id, "changes": sorted(changes)})
    return {"user": _user_to_out(user)}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_route(
    user_id: int,
    principal: Principal = Depends(get_current_principal),
) -> None:
    _require_admin(principal)
    _ensure_not_self(user_id, principal)
    deleted = delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    from app.lib import audit
    audit.record("admin.user.deleted", actor=principal.subject, detail={"user_id": user_id})


def _user_to_out(user) -> dict:
    # Pydantic-friendly flat shape mirroring UserOut but tolerant of admin
    # details that we don\'t want to expose (id, password_hash).
    return {
        "subject": user.subject,
        "username": user.username,
        "role": user.role,
        "site_keys": list(user.site_keys),
        "enabled": user.enabled,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


# ── Provider API keys ───────────────────────────────────────────────────
@router.get("/api-keys")
def list_api_keys(principal: Principal = Depends(get_current_principal)) -> dict:
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    rows = pkeys.list_provider_keys()
    return {
        "providers": _providers_summary(rows),
        "configs": pkeys.list_provider_configs(),
        "keys": rows,
    }


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreate,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    try:
        record = pkeys.create_provider_key(
            provider=payload.provider,
            label=payload.label,
            value=payload.value,
            enabled=payload.enabled,
            created_by_subject=principal.subject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _reset_provider_registry()
    from app.lib import audit
    audit.record("admin.api_key.created", actor=principal.subject,
                 detail={"provider": payload.provider, "key_id": record.get("id")})
    return {"key": record}


@router.patch("/provider-configs/{provider}")
def update_provider_config(
    provider: str,
    payload: ProviderConfigUpdate,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    try:
        config = pkeys.update_provider_config(
            provider,
            base_url=payload.base_url,
            updated_by_subject=principal.subject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"config": config}


@router.patch("/api-keys/{key_id}")
def update_api_key(
    key_id: int,
    payload: ApiKeyUpdate,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    changes: dict[str, Any] = {}
    if payload.label is not None:
        changes["label"] = payload.label
    if payload.enabled is not None:
        changes["enabled"] = payload.enabled
    if payload.value:
        changes["value"] = payload.value
    record = pkeys.update_provider_key(key_id, **changes)
    if record is None:
        raise HTTPException(status_code=404, detail="API key not found")
    _reset_provider_registry()
    from app.lib import audit
    audit.record("admin.api_key.updated", actor=principal.subject, detail={"key_id": key_id})
    return {"key": record}


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_api_key(
    key_id: int,
    principal: Principal = Depends(get_current_principal),
) -> None:
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    if not pkeys.delete_provider_key(key_id):
        raise HTTPException(status_code=404, detail="API key not found")
    _reset_provider_registry()
    from app.lib import audit
    audit.record("admin.api_key.deleted", actor=principal.subject, detail={"key_id": key_id})


@router.post("/api-keys/{key_id}/test")
def test_api_key(
    key_id: int,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    """Decrypt a key and report that it is parseable. Does not call the provider."""
    _require_admin(principal)
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    keys = [k for k in pkeys.list_provider_keys() if k["id"] == key_id]
    if not keys:
        raise HTTPException(status_code=404, detail="API key not found")
    return {
        "ok": True,
        "key": keys[0],
        "preview": keys[0]["value_preview"],
    }


@router.post("/api-keys/{key_id}/reveal")
def reveal_api_key(
    key_id: int,
    response: Response,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    """Return the decrypted plaintext value of one key.

    Admin-only. The plaintext is never returned by the list endpoint; this
    on-demand reveal exists so the admin can copy the key into another
    tool. The audit logging is delegated to the standard access log.
    """
    _require_admin(principal)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    if pkeys is None:
        raise HTTPException(status_code=503, detail="Provider keys store unavailable")
    keys = [k for k in pkeys.list_provider_keys() if k["id"] == key_id]
    if not keys:
        raise HTTPException(status_code=404, detail="API key not found")
    # We need the real (decrypted) value for the reveal endpoint; bypass
    # the masked list helper and call the underlying decrypt directly.
    from app.lib import db as _db
    with _db.SessionLocal() as session:
        row = session.get(_db.ProviderApiKey, key_id)
        if row is None:
            raise HTTPException(status_code=404, detail="API key not found")
        from app.secret_store import decrypt_str, load_or_create_master_key
        try:
            value = decrypt_str(row.value_encrypted, load_or_create_master_key())
        except Exception:
            raise HTTPException(status_code=500, detail="Could not decrypt value")
    from app.lib import audit
    audit.record("admin.api_key.revealed", actor=principal.subject, detail={"key_id": key_id})
    return {
        "id": key_id,
        "provider": keys[0]["provider"],
        "label": keys[0].get("label"),
        "value": value,
        "value_preview": keys[0]["value_preview"],
    }


@router.post("/model/reload")
def reload_model(
    request: Request,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    """Reload the ML bundle + calibrator after a retrain (audit F-B2-07).

    Train scripts call this after saving new artifacts so the running API
    picks them up without a restart. Accepts an admin principal OR the
    ``SEASID_RELOAD_TOKEN`` header (scripts run outside the user store).
    """
    from fastapi import HTTPException
    import os

    token = request.headers.get("X-Reload-Token", "")
    expected = os.getenv("SEASID_RELOAD_TOKEN", "").strip()
    is_admin = principal.role == "admin"
    if not is_admin and not (expected and token == expected):
        raise HTTPException(status_code=403, detail="Admin role or reload token required")

    from app.lib.model import reload as model_reload, reload_calibrator, selected_tier
    from app.api.services import invalidate_forecast_cache

    model_reload()
    reload_calibrator()
    invalidate_forecast_cache(None)
    tier, reason = selected_tier()
    from app.lib import audit
    audit.record("admin.model.reloaded", actor=principal.subject, detail={"tier": tier})
    return {"ok": True, "selected_tier": tier, "reason": reason}


@router.get("/audit")
def list_audit_events(
    limit: int = 200,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    """Most recent audit events (admin; audit F-B3-13)."""
    _require_admin(principal)
    from app.lib import audit
    return {"events": audit.recent(limit=min(max(limit, 1), 1000))}


def _providers_summary(rows: list[dict]) -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for row in rows:
        provider = row["provider"]
        bucket = summary.setdefault(provider, {"count": 0, "enabled": 0})
        bucket["count"] += 1
        if row.get("enabled"):
            bucket["enabled"] += 1
    for provider, meta in pkeys.PROVIDER_LABELS.items():
        summary.setdefault(provider, {"count": 0, "enabled": 0, "label": meta})
    for provider, bucket in summary.items():
        bucket["label"] = pkeys.PROVIDER_LABELS.get(provider, provider)
    return summary
