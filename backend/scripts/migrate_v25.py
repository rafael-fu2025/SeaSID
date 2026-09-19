"""v2.5 schema migration — audit_log table (audit F-B3-13).

Adds a structured audit trail for sensitive actions: admin user/key
mutations, provider-key reveals, alert runs, experiment runs.

Idempotent: safe to re-run.

Run with:
    python -m scripts.migrate_v25
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging

from app.lib import db as db_mod

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("migrate_v25")


def main() -> None:
    log.info("v2.5 schema migration starting…")
    # AuditEvent is declared in Base.metadata, so create_all is idempotent
    # and only adds the table when missing.
    db_mod.Base.metadata.create_all(bind=db_mod.engine)
    log.info("v2.5 schema migration complete (audit_log ready).")


if __name__ == "__main__":
    main()
