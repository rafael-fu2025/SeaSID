"""User store: DB-backed users with seeded defaults + admin CRUD.

Replaces the env-only loader in :mod:`app.auth.configured_users` when the
``users`` table is non-empty, and seeds the table from the env loader on
first boot so existing setups keep working.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from app.lib import db as _db
except Exception:  # pragma: no cover
    _db = None  # type: ignore[assignment]


logger = logging.getLogger("seasid.user_store")

VALID_ROLES = {"viewer", "operator", "data_steward", "admin"}

_SEED_LOCK = threading.Lock()
_SEEDED = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_db():
    if _db is None:
        raise RuntimeError("Database module is not importable")
    return _db


@dataclass(frozen=True)
class StoredUser:
    subject: str
    username: str
    role: str
    site_keys: tuple[str, ...]
    enabled: bool
    last_login_at: datetime | None = None

    def as_user_info(self) -> dict:
        return {
            "subject": self.subject,
            "username": self.username,
            "role": self.role,
            "site_keys": list(self.site_keys),
            "enabled": self.enabled,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
        }


def _parse_site_keys(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ("*",)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return ("*",)
    if not isinstance(data, list) or not data:
        return ("*",)
    return tuple(str(item) for item in data) or ("*",)


def _row_to_user(row) -> StoredUser:
    return StoredUser(
        subject=row.subject,
        username=row.username,
        role=row.role,
        site_keys=_parse_site_keys(row.site_keys_json),
        enabled=bool(row.enabled),
        last_login_at=row.last_login_at,
    )


def list_users() -> list[dict]:
    db = _ensure_db()
    with db.SessionLocal() as session:
        rows = session.query(db.User).order_by(db.User.username.asc()).all()
        return [_row_to_user(r).as_user_info() | {"id": r.id} for r in rows]


def get_user_by_username(username: str) -> StoredUser | None:
    if not username:
        return None
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = (
            session.query(db.User)
            .filter(db.User.username == username)
            .one_or_none()
        )
        return _row_to_user(row) if row else None


def get_user_by_subject(subject: str) -> StoredUser | None:
    if not subject:
        return None
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = (
            session.query(db.User)
            .filter(db.User.subject == subject)
            .one_or_none()
        )
        return _row_to_user(row) if row else None


def create_user(
    *,
    username: str,
    password: str,
    role: str,
    site_keys: list[str] | tuple[str, ...] = ("*",),
    subject: str | None = None,
    enabled: bool = True,
    password_hash: str | None = None,
) -> StoredUser:
    from app.auth import hash_password
    if not username:
        raise ValueError("username is required")
    role = (role or "viewer").lower()
    if role not in VALID_ROLES:
        raise ValueError(f"Unknown role: {role!r}")
    if not password and not password_hash:
        raise ValueError("password or password_hash is required")
    db = _ensure_db()
    hashed = password_hash or hash_password(password)
    now = _utcnow()
    with db.SessionLocal() as session:
        if session.query(db.User).filter(db.User.username == username).first():
            raise ValueError(f"User {username!r} already exists")
        row = db.User(
            subject=subject or username,
            username=username,
            role=role,
            site_keys_json=json.dumps(list(site_keys) or ["*"]),
            password_hash=hashed,
            enabled=enabled,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return _row_to_user(row)


def update_user(user_id: int, **changes) -> StoredUser | None:
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = session.get(db.User, user_id)
        if row is None:
            return None
        if "role" in changes:
            new_role = (changes["role"] or "").lower()
            if new_role not in VALID_ROLES:
                raise ValueError(f"Unknown role: {new_role!r}")
            row.role = new_role
        if "site_keys" in changes:
            row.site_keys_json = json.dumps(list(changes["site_keys"]) or ["*"])
        if "enabled" in changes:
            row.enabled = bool(changes["enabled"])
        if "subject" in changes:
            row.subject = changes["subject"]
        if "password" in changes and changes["password"]:
            from app.auth import hash_password
            row.password_hash = hash_password(changes["password"])
        row.updated_at = _utcnow()
        session.commit()
        session.refresh(row)
        return _row_to_user(row)


def delete_user(user_id: int) -> bool:
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = session.get(db.User, user_id)
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True


def change_password(username: str, current_password: str, new_password: str) -> bool:
    from app.auth import verify_password, hash_password
    if not username or not new_password or len(new_password) < 8:
        raise ValueError("New password must be at least 8 characters")
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = (
            session.query(db.User)
            .filter(db.User.username == username)
            .one_or_none()
        )
        if row is None:
            return False
        if not verify_password(current_password, None, row.password_hash):
            return False
        row.password_hash = hash_password(new_password)
        row.updated_at = _utcnow()
        session.commit()
        return True


def record_login(subject: str) -> None:
    if not subject:
        return
    db = _ensure_db()
    with db.SessionLocal() as session:
        row = (
            session.query(db.User).filter(db.User.subject == subject).one_or_none()
        )
        if row is None:
            return
        row.last_login_at = _utcnow()
        session.commit()


def seed_from_auth_loader(auth_users: Iterable) -> int:
    """Populate the user table from ``auth_users`` when the DB has none.

    Idempotent across processes: each call checks the DB and only inserts
    when the user table is empty. Safe to call repeatedly in tests.
    """
    db = _ensure_db()
    with db.SessionLocal() as session:
        existing = session.query(db.User).count()
        if existing:
            return 0
    inserted = 0
    for record in auth_users:
        username = getattr(record, "username", None) or ""
        if not username:
            continue
        password = getattr(record, "password", None)
        password_hash = getattr(record, "password_hash", None)
        if not password and not password_hash:
            continue
        # ``create_user`` accepts a placeholder password here as long as
        # password_hash is supplied; we filtered both-missing records above.
        try:
            create_user(
                subject=getattr(record, "subject", None) or username,
                username=username,
                password=password or "x-unused-placeholder",
                password_hash=password_hash,
                role=getattr(record, "role", "viewer"),
                site_keys=tuple(getattr(record, "site_keys", ("*",))),
                enabled=True,
            )
            inserted += 1
        except ValueError:
            # username collision or validation failure; skip silently
            continue
    return inserted


# Trick: type-only import for type checkers (Iterables without runtime dep)
from typing import Iterable  # noqa: E402
