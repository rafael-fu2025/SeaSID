"""
Phase 5 regression tests — richer label schema.

Pins down the new ``no_go_reason`` and ``confidence`` fields on both
``NoDiveLabel`` and ``OperatorVerification`` tables, the migration's
behaviour, and the verify-request path through Pydantic + the service
layer.

Tested contracts:
  - Migration ``migrate_v23`` is idempotent — running it twice doesn't fail.
  - After migration, both tables have the new columns (nullable).
  - ``VerifyRequest`` accepts the new optional fields.
  - ``submit_verification`` persists the fields onto both the verification
    row and the NoDiveLabel row.
  - When verdict != "dive" and the operator doesn't supply a reason, the
    service defaults ``no_go_reason="other"`` so the trainer has signal.
  - When verdict == "dive" and no reason is supplied, ``no_go_reason``
    stays None.
  - When no confidence is supplied, it defaults to ``"med"``.
  - ``get_labels`` surfaces the new fields on its ``labels`` entries.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_migrate_v23_idempotent():
    """Running migrate_v23 twice must not raise."""
    from scripts import migrate_v23
    # First call adds columns.
    migrate_v23.main()
    # Second call is a no-op (column_exists returns True).
    migrate_v23.main()


def test_columns_present_after_migration():
    """Both tables expose no_go_reason + confidence columns."""
    from sqlalchemy import inspect
    from app.lib import db as db_mod

    inspector = inspect(db_mod.engine)
    for table in ("no_dive_labels", "operator_verifications"):
        cols = {c["name"] for c in inspector.get_columns(table)}
        assert "no_go_reason" in cols, f"{table} missing no_go_reason"
        assert "confidence" in cols, f"{table} missing confidence"


def test_verify_request_accepts_new_fields():
    """VerifyRequest schema permits the new optional fields."""
    from app.api.schemas import VerifyRequest
    req = VerifyRequest(
        site_key="dauin_muck",
        date="2026-07-13",
        verdict="no_dive",
        actual_viz_m=3.0,
        actual_current="High",
        no_go_reason="current",
        confidence="high",
    )
    assert req.no_go_reason == "current"
    assert req.confidence == "high"


def test_verify_request_new_fields_optional():
    """Existing call sites that don't pass the new fields must keep working."""
    from app.api.schemas import VerifyRequest
    req = VerifyRequest(
        site_key="dauin_muck",
        date="2026-07-13",
        verdict="dive",
    )
    assert req.no_go_reason is None
    assert req.confidence is None


def test_submit_verification_persists_new_fields():
    """End-to-end: POST /verify with the new fields lands on both tables."""
    from datetime import date as _date
    from app.api import services
    from app.lib import db as db_mod

    # Use a unique date so we don't collide with existing rows.
    today = _date.today()
    site = "dauin_muck"
    operator = "phase5_test_user"

    payload = {
        "site_key": site,
        "operator": operator,
        "date": today.isoformat(),
        "verdict": "no_dive",
        "actual_viz_m": 3.0,
        "actual_current": "High",
        "no_go_reason": "current",
        "confidence": "high",
        "comments": "phase5 test",
    }

    # Clean any pre-existing test rows. OperatorVerification has a unique
    # constraint on (site, date, operator); NoDiveLabel has a unique
    # constraint on (site, date, source) and our service writes
    # source=f"operator_{operator}".
    session = db_mod.SessionLocal()
    try:
        session.query(db_mod.OperatorVerification).filter(
            db_mod.OperatorVerification.site_key == site,
            db_mod.OperatorVerification.date == today,
            db_mod.OperatorVerification.operator == operator,
        ).delete(synchronize_session=False)
        session.query(db_mod.NoDiveLabel).filter(
            db_mod.NoDiveLabel.site_key == site,
            db_mod.NoDiveLabel.date == today,
            db_mod.NoDiveLabel.source == f"operator_{operator}",
        ).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()

    result = services.submit_verification(payload)
    assert result["no_go_reason"] == "current"
    assert result["confidence"] == "high"

    # Both the verification and the label must carry the new fields.
    session = db_mod.SessionLocal()
    try:
        ver = (
            session.query(db_mod.OperatorVerification)
            .filter(
                db_mod.OperatorVerification.site_key == site,
                db_mod.OperatorVerification.date == today,
                db_mod.OperatorVerification.operator == operator,
            )
            .one()
        )
        assert ver.no_go_reason == "current"
        assert ver.confidence == "high"

        lbl = (
            session.query(db_mod.NoDiveLabel)
            .filter(
                db_mod.NoDiveLabel.site_key == site,
                db_mod.NoDiveLabel.date == today,
                db_mod.NoDiveLabel.source == f"operator_{operator}",
            )
            .one()
        )
        assert lbl.no_go_reason == "current"
        assert lbl.confidence == "high"
    finally:
        session.close()


def test_submit_verification_defaults_reason_for_non_dive():
    """Verdict != "dive" with no reason → defaults to "other"."""
    from datetime import date as _date
    from app.api import services
    from app.lib import db as db_mod

    today = _date.today()
    site = "dauin_muck"
    operator = "phase5_default_reason"

    payload = {
        "site_key": site,
        "operator": operator,
        "date": today.isoformat(),
        "verdict": "poor_viz",
        "actual_viz_m": 5.0,
        # Note: no no_go_reason supplied.
    }

    session = db_mod.SessionLocal()
    try:
        session.query(db_mod.OperatorVerification).filter(
            db_mod.OperatorVerification.site_key == site,
            db_mod.OperatorVerification.date == today,
            db_mod.OperatorVerification.operator == operator,
        ).delete(synchronize_session=False)
        session.query(db_mod.NoDiveLabel).filter(
            db_mod.NoDiveLabel.site_key == site,
            db_mod.NoDiveLabel.date == today,
            db_mod.NoDiveLabel.source == f"operator_{operator}",
        ).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()

    result = services.submit_verification(payload)
    assert result["no_go_reason"] == "other"
    assert result["confidence"] == "med"  # default confidence


def test_submit_verification_keeps_reason_null_for_dive():
    """Verdict == "dive" with no reason → stays None (not "other")."""
    from datetime import date as _date
    from app.api import services
    from app.lib import db as db_mod

    today = _date.today()
    site = "apo_reef"
    operator = "phase5_clean_dive"

    payload = {
        "site_key": site,
        "operator": operator,
        "date": today.isoformat(),
        "verdict": "dive",
        "actual_viz_m": 18.0,
        # No no_go_reason, no confidence.
    }

    session = db_mod.SessionLocal()
    try:
        session.query(db_mod.OperatorVerification).filter(
            db_mod.OperatorVerification.site_key == site,
            db_mod.OperatorVerification.date == today,
            db_mod.OperatorVerification.operator == operator,
        ).delete(synchronize_session=False)
        session.query(db_mod.NoDiveLabel).filter(
            db_mod.NoDiveLabel.site_key == site,
            db_mod.NoDiveLabel.date == today,
            db_mod.NoDiveLabel.source == f"operator_{operator}",
        ).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()

    result = services.submit_verification(payload)
    assert result["no_go_reason"] is None
    assert result["confidence"] == "med"


def test_get_labels_surfaces_new_fields():
    """The labels endpoint must surface the Phase 5 fields on each row.

    The conftest wipes the DB between tests, so we insert a single row
    first and then verify the API response carries the new keys.
    """
    from datetime import date as _date
    from app.api import services
    from app.lib import db as db_mod

    site = "dauin_muck"
    operator = "phase5_get_labels_user"

    payload = {
        "site_key": site,
        "operator": operator,
        "date": _date.today().isoformat(),
        "verdict": "poor_viz",
        "actual_viz_m": 6.0,
        "no_go_reason": "viz",
        "confidence": "high",
    }
    services.submit_verification(payload)

    result = services.get_labels(site, limit=5)
    assert "labels" in result
    assert result["total"] >= 1
    for entry in result["labels"]:
        assert "no_go_reason" in entry, "labels entries must include no_go_reason"
        assert "confidence" in entry, "labels entries must include confidence"
    # The row we just inserted must be in the response.
    ours = [e for e in result["labels"] if e["source"] == f"operator_{operator}"]
    assert len(ours) == 1
    assert ours[0]["no_go_reason"] == "viz"
    assert ours[0]["confidence"] == "high"