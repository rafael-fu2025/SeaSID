"""v2.2 schema migration — adds the operator_verifications unique constraint.

Idempotent: safe to re-run. Run with:
    python -m scripts.migrate_v22

Background
----------
Roadmap item 14 (SeaSID next-move backlog) requires a unique constraint on
``operator_verifications`` so duplicate submissions by the same operator for
the same site+date are caught at the database layer. SQLite and PostgreSQL
both treat NULL values as distinct in unique constraints, so anonymous
operators (``operator IS NULL``) do not collide with each other.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from sqlalchemy import inspect, text

from app.lib import db as db_mod

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("migrate_v22")


def constraint_exists(table: str, name: str) -> bool:
    inspector = inspect(db_mod.engine)
    if table not in inspector.get_table_names():
        return False
    for uq in inspector.get_unique_constraints(table):
        if uq.get("name") == name:
            return True
    return False


def main() -> None:
    log.info("v2.2 schema migration starting…")
    table = "operator_verifications"
    constraint = "uq_opver_site_date_operator"

    if constraint_exists(table, constraint):
        log.info("%s already exists on %s — skipping", constraint, table)
        return

    # The migration is a no-op when Base.metadata.create_all() has already
    # created the constraint on a fresh database. We only need the explicit
    # ALTER when the table predates the constraint.
    if table not in inspect(db_mod.engine).get_table_names():
        log.info("table %s does not exist yet — init_db will create it with the constraint", table)
        return

    log.info("adding %s on %s", constraint, table)
    try:
        with db_mod.engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX {constraint} "
                    f"ON {table} (site_key, date, operator)"
                )
            )
    except Exception as exc:
        log.error("migration failed: %s", exc)
        raise

    log.info("v2.2 schema migration complete.")


if __name__ == "__main__":
    main()