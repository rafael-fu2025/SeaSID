"""Audit event log (audit F-B3-13).

Sensitive actions — admin user/key mutations, key reveal, alert runs,
experiment runs — are recorded as structured events so deployments get a
tamper-evident trail beyond generic HTTP access logs. Failures to record
must never break the action itself.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger("seasid.audit")


def record(action: str, actor: str | None = None, detail: dict | None = None) -> None:
    """Persist one audit event. Best-effort: logs and swallows DB errors."""
    try:
        from app.lib import db

        session = db.SessionLocal()
        try:
            session.add(db.AuditEvent(
                action=action,
                actor=actor,
                detail_json=json.dumps(detail or {}, default=str),
                ts=datetime.now(timezone.utc),
            ))
            session.commit()
        finally:
            session.close()
    except Exception:
        logger.warning("Failed to record audit event %r", action, exc_info=True)


def recent(limit: int = 200) -> list[dict]:
    """Return the most recent audit events (newest first)."""
    from app.lib import db

    session = db.SessionLocal()
    try:
        rows = (
            session.query(db.AuditEvent)
            .order_by(db.AuditEvent.ts.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "ts": r.ts.isoformat() if r.ts else None,
                "action": r.action,
                "actor": r.actor,
                "detail": json.loads(r.detail_json) if r.detail_json else {},
            }
            for r in rows
        ]
    finally:
        session.close()
