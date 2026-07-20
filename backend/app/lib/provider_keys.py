"""Provider API key store with rotation + cooldown.

A small wrapper around :mod:`app.lib.db` that:

  * loads or creates the master encryption key via :mod:`app.secret_store`,
  * stores credentials exclusively in the project database,
  * stores non-secret per-provider configuration separately from key rows,
  * exposes :func:`pick_provider_key` for round-robin rotation with
    per-key cooldown and error tracking,
  * exposes :func:`list_provider_keys` and CRUD helpers used by the
    admin endpoints.

The raw API value is encrypted at rest and never returned by listing
endpoints; the caller receives ``value_preview`` containing only the last
four characters.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from app.secret_store import decrypt_str, encrypt, load_or_create_master_key

try:  # pragma: no cover -- imported lazily so docs builds still work
    from app.lib import db as _db
except Exception:  # pragma: no cover
    _db = None  # type: ignore[assignment]


logger = logging.getLogger("seasid.provider_keys")

PROVIDER_LABELS: dict[str, str] = {
    "llm": "LLM provider (OpenAI-compatible)",
    "stormglass": "Stormglass marine provider",
    "aqicn": "AQICN air-quality provider",
    "tides": "WorldTides tide-heights provider",
    # Credentials supplied to the MiniMax web-search MCP. Reuses the same
    # key as the LLM provider by default; admins can override here if they
    # want a dedicated key for the MCP subprocess.
    "mcp_minimax": "MiniMax web-search MCP (key shared with LLM by default)",
}
PROVIDER_ALIASES = {"openai": "llm"}

DEFAULT_COOLDOWN = timedelta(minutes=5)
MAX_RECENT_ERRORS = 3


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    """Return ``value`` as a UTC-aware datetime, tolerating naive values.

    SQLite strips timezone info on read even from ``DateTime(timezone=True)``
    columns, so values that were written via ``_utcnow()`` come back naive.
    SeaSID populates these columns with UTC-aware timestamps, so a naive
    read-back can be safely assumed to be UTC. Aware values are projected
    into UTC so callers can compare against ``_utcnow()`` without raising
    ``TypeError: can't compare offset-naive and offset-aware datetimes``.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ensure_db():
    if _db is None:
        raise RuntimeError("Database module is not importable")
    return _db


@dataclass(frozen=True)
class ProviderKey:
    """Decrypted provider key ready for use."""

    id: int
    provider: str
    label: str | None
    value: str
    last_used_at: datetime | None = None
    last_error_at: datetime | None = None
    error_count: int = 0


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "label": row.label,
        "value_encrypted": row.value_encrypted,
        "enabled": bool(row.enabled),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "last_used_at": row.last_used_at,
        "last_error_at": row.last_error_at,
        "last_error": row.last_error,
        "error_count": row.error_count or 0,
        "cooldown_until": row.cooldown_until,
        "total_uses": row.total_uses or 0,
        "created_by_subject": row.created_by_subject,
    }


def _master_key() -> bytes:
    return load_or_create_master_key("SEASID_DB_ENCRYPTION_KEY")


def _decrypt_value(envelope: str) -> str:
    return decrypt_str(envelope, _master_key())


def _encrypt_value(value: str) -> str:
    return encrypt(value, _master_key())


def canonical_provider(provider: str) -> str:
    normalized = (provider or "").strip().lower()
    return PROVIDER_ALIASES.get(normalized, normalized)


def _require_supported_provider(provider: str) -> str:
    canonical = canonical_provider(provider)
    if canonical not in PROVIDER_LABELS:
        supported = ", ".join(PROVIDER_LABELS)
        raise ValueError(f"Unsupported provider '{provider}'. Choose one of: {supported}")
    return canonical


def mask_value(value: str) -> str:
    """Return a masked preview suitable for display in admin UI."""
    if not value:
        return ""
    tail = value[-4:] if len(value) >= 4 else value
    return f"***{tail}"


def list_provider_keys(provider: str | None = None) -> list[dict[str, Any]]:
    """List DB rows, optionally filtered by provider. Never returns plaintext."""
    db = _ensure_db()
    with db.SessionLocal() as session:
        query = session.query(db.ProviderApiKey)
        if provider:
            query = query.filter(db.ProviderApiKey.provider == canonical_provider(provider))
        rows = query.order_by(db.ProviderApiKey.provider, db.ProviderApiKey.id).all()
        out = []
        for row in rows:
            try:
                plaintext = _decrypt_value(row.value_encrypted)
            except Exception:
                plaintext = ""
            out.append({
                "id": row.id,
                "provider": row.provider,
                "label": row.label,
                "value_preview": mask_value(plaintext) or "(invalid)",
                "enabled": bool(row.enabled),
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
                "last_error_at": row.last_error_at.isoformat() if row.last_error_at else None,
                "last_error": row.last_error,
                "error_count": row.error_count or 0,
                "cooldown_until": row.cooldown_until.isoformat() if row.cooldown_until else None,
                "total_uses": row.total_uses or 0,
                "created_by_subject": row.created_by_subject,
            })
        return out


def create_provider_key(
    *,
    provider: str,
    label: str | None,
    value: str,
    enabled: bool = True,
    created_by_subject: str | None = None,
) -> dict[str, Any]:
    provider = _require_supported_provider(provider)
    if not value:
        raise ValueError("value is required")
    db = _ensure_db()
    envelope = _encrypt_value(value)
    now = _utcnow()
    with db.SessionLocal() as session:
        row = db.ProviderApiKey(
            provider=provider,
            label=label,
            value_encrypted=envelope,
            enabled=enabled,
            created_by_subject=created_by_subject,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return list_provider_keys(provider=provider)[-1]


def update_provider_key(key_id: int, **changes: Any) -> dict[str, Any] | None:
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = session.get(db.ProviderApiKey, key_id)
        if row is None:
            return None
        for attr, new_value in changes.items():
            if attr == "value":
                row.value_encrypted = _encrypt_value(new_value)
                row.last_error_at = None
                row.last_error = None
                row.error_count = 0
                row.cooldown_until = None
            elif attr in {"label", "enabled", "cooldown_until", "error_count"}:
                setattr(row, attr, new_value)
            else:
                continue
        row.updated_at = _utcnow()
        session.commit()
        session.refresh(row)
        return next(
            (item for item in list_provider_keys(provider=row.provider) if item["id"] == row.id),
            None,
        )


def delete_provider_key(key_id: int) -> bool:
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = session.get(db.ProviderApiKey, key_id)
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True


def pick_provider_key(
    provider: str,
    *,
    exclude_ids: Iterable[int] | None = None,
) -> ProviderKey | None:
    """Return the next usable key for ``provider``.

    Selects among enabled keys with cooldown_until <= now. Prefers the
    least-recently-used key (LRU on ``last_used_at``) and skips rows that
    have hit MAX_RECENT_ERRORS recent consecutive errors.
    """
    provider = _require_supported_provider(provider)
    db = _ensure_db()
    excluded = set(exclude_ids or ())
    now = _utcnow()
    with db.SessionLocal() as session:
        rows = (
            session.query(db.ProviderApiKey)
            .filter(db.ProviderApiKey.provider == provider)
            .filter(db.ProviderApiKey.enabled.is_(True))
            .order_by(db.ProviderApiKey.last_used_at.is_(None).desc(),
                      db.ProviderApiKey.last_used_at.asc(),
                      db.ProviderApiKey.id.asc())
            .all()
        )
        for row in rows:
            if row.id in excluded:
                continue
            cooldown_until = _as_utc(row.cooldown_until)
            if cooldown_until and cooldown_until > now:
                continue
            if (row.error_count or 0) >= MAX_RECENT_ERRORS:
                continue
            try:
                value = _decrypt_value(row.value_encrypted)
            except Exception as exc:
                logger.warning("Skipping provider=%s key id=%s: decrypt failed: %s",
                               provider, row.id, exc)
                continue
            row.last_used_at = now
            row.total_uses = (row.total_uses or 0) + 1
            row.last_error = None
            session.commit()
            session.refresh(row)
            return ProviderKey(
                id=row.id,
                provider=row.provider,
                label=row.label,
                value=value,
                last_used_at=row.last_used_at,
                last_error_at=row.last_error_at,
                error_count=row.error_count or 0,
            )
    return None


def resolve_provider_value(provider: str) -> ProviderKey | None:
    """Return the next usable database key for a provider."""
    return pick_provider_key(provider)


def mark_provider_error(key_id: int, error: str, cooldown: timedelta | None = None) -> None:
    if not key_id:
        return
    db = _ensure_db()
    cooldown_until = _utcnow() + (cooldown or DEFAULT_COOLDOWN)
    with db.SessionLocal() as session:
        row = session.get(db.ProviderApiKey, key_id)
        if row is None:
            return
        row.last_error_at = _utcnow()
        row.last_error = error[:500]
        row.error_count = (row.error_count or 0) + 1
        row.cooldown_until = cooldown_until
        session.commit()


def clear_provider_error(key_id: int) -> None:
    if not key_id:
        return
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = session.get(db.ProviderApiKey, key_id)
        if row is None:
            return
        row.last_error_at = None
        row.last_error = None
        row.error_count = 0
        row.cooldown_until = None
        session.commit()


def list_provider_configs() -> dict[str, dict[str, Any]]:
    """Return one shared configuration record for every supported provider."""
    db = _ensure_db()
    with db.SessionLocal() as session:
        rows = {row.provider: row for row in session.query(db.ProviderConfig).all()}
        return {
            provider: {
                "provider": provider,
                "base_url": rows[provider].base_url if provider in rows else None,
                "updated_at": (
                    rows[provider].updated_at.isoformat()
                    if provider in rows and rows[provider].updated_at
                    else None
                ),
                "updated_by_subject": (
                    rows[provider].updated_by_subject if provider in rows else None
                ),
            }
            for provider in PROVIDER_LABELS
        }


def get_provider_config(provider: str) -> dict[str, Any]:
    canonical = _require_supported_provider(provider)
    return list_provider_configs()[canonical]


def update_provider_config(
    provider: str,
    *,
    base_url: str | None,
    updated_by_subject: str | None = None,
) -> dict[str, Any]:
    canonical = _require_supported_provider(provider)
    if canonical != "llm" and base_url:
        raise ValueError("Only the LLM provider supports a custom base URL")
    normalized_url = (base_url or "").strip() or None
    if normalized_url and not normalized_url.startswith(("http://", "https://")):
        raise ValueError("Base URL must start with http:// or https://")

    db = _ensure_db()
    now = _utcnow()
    with db.SessionLocal() as session:
        row = session.get(db.ProviderConfig, canonical)
        if row is None:
            row = db.ProviderConfig(provider=canonical, created_at=now)
            session.add(row)
        row.base_url = normalized_url
        row.updated_by_subject = updated_by_subject
        row.updated_at = now
        session.commit()
    return get_provider_config(canonical)


def normalize_legacy_provider_rows() -> dict[str, int]:
    """Merge legacy ``openai`` rows into the canonical ``llm`` provider.

    Duplicate values are removed; distinct values are preserved with unique
    labels so existing installations end up with one provider and many keys.
    """
    db = _ensure_db()
    migrated = 0
    deduplicated = 0
    with db.SessionLocal() as session:
        rows = session.query(db.ProviderApiKey).order_by(db.ProviderApiKey.id).all()
        for row in rows:
            target_provider = canonical_provider(row.provider)
            target_label = row.label
            if row.label == "bootstrapped-from-env" or row.created_by_subject == "bootstrap":
                target_label = "migrated-key"

            collision = (
                session.query(db.ProviderApiKey)
                .filter(db.ProviderApiKey.provider == target_provider)
                .filter(db.ProviderApiKey.label == target_label)
                .filter(db.ProviderApiKey.id != row.id)
                .first()
            )
            if collision is not None:
                try:
                    same_value = (
                        _decrypt_value(collision.value_encrypted)
                        == _decrypt_value(row.value_encrypted)
                    )
                except Exception:
                    same_value = False
                if same_value:
                    session.delete(row)
                    session.flush()
                    deduplicated += 1
                    continue
                target_label = f"{target_label or 'key'}-{row.id}"

            if row.provider != target_provider or row.label != target_label:
                row.provider = target_provider
                row.label = target_label
                row.updated_at = _utcnow()
                session.flush()
                migrated += 1
        session.commit()
    return {"migrated": migrated, "deduplicated": deduplicated}


# ── MCP key helpers ───────────────────────────────────────────────────────
#
# The MiniMax web-search MCP needs an API key in its environment. The
# reference project passes MINIMAX_API_KEY directly to the spawned
# subprocess. SeaSID already manages LLM provider keys encrypted in the
# database; the MCP subprocess should reuse those instead of taking a
# separate .env secret.
#
# Resolution order (first hit wins):
#   1. An enabled row in provider_api_keys with provider="mcp_minimax"
#      — admins can override if they want a dedicated MCP key.
#   2. The same DB row as the LLM provider (i.e. provider="llm"), so the
#      MCP shares the credential already in use for chat completions.
#   3. The MINIMAX_API_KEY env var (bootstrap fallback for dev).
#   4. None — caller logs and skips MCP boot.
#
# `key_id` is the decrypted-key record id (or None when from .env) so the
# MCP bookkeeping can call mark_provider_error on transport failures.

def resolve_mcp_minimax_key() -> tuple[str | None, int | None]:
    """Return ``(api_key, key_id)`` for the MiniMax web-search MCP.

    ``key_id`` is non-None when the value came from a row in the encrypted
    provider-keys table so :func:`mark_provider_error` can attribute
    transport failures back to that row. When the value comes from the
    ``MINIMAX_API_KEY`` env var (bootstrap), ``key_id`` is ``None``.
    """
    try:
        # 1) Dedicated mcp_minimax row.
        record = pick_provider_key("mcp_minimax")
    except Exception:
        record = None
    if record is not None:
        return record.value, record.id

    # 2) Reuse the LLM row.
    try:
        record = pick_provider_key("llm")
    except Exception:
        record = None
    if record is not None:
        return record.value, record.id

    # 3) Env-var bootstrap.
    import os

    env_key = os.getenv("MINIMAX_API_KEY", "").strip()
    if env_key and not env_key.startswith("sk-minimax-your-key"):
        return env_key, None

    return None, None

