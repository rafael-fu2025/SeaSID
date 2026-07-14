"""v2.3 schema migration — adds no_go_reason + confidence to label tables.

Phase 5 (richer label schema): every operator verification (and the
corresponding NoDiveLabel row) gains two new structured fields:

  - ``no_go_reason`` (TEXT, nullable) — which physical driver mattered:
        viz, current, swell, weather, boat, other
  - ``confidence``   (TEXT, nullable) — operator's self-reported trust:
        low, med, high

Both columns are nullable so existing rows remain valid. The migration
uses ``ALTER TABLE ... ADD COLUMN`` which is supported on every SQLite
version we target (>= 3.35).

Idempotent: safe to re-run. Detect columns via ``PRAGMA table_info``.

Run with:
    python -m scripts.migrate_v23
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from sqlalchemy import inspect, text

from app.lib import db as db_mod

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("migrate_v23")


def column_exists(table: str, column: str) -> bool:
    """Return True if ``column`` is already defined on ``table``."""
    inspector = inspect(db_mod.engine)
    if table not in inspector.get_table_names():
        return False
    cols = {c["name"] for c in inspector.get_columns(table)}
    return column in cols


def add_column(table: str, column: str, ddl_type: str = "VARCHAR(20)") -> None:
    """Run an ``ALTER TABLE ADD COLUMN`` for one column. Idempotent."""
    if column_exists(table, column):
        log.info("%s.%s already exists — skipping", table, column)
        return
    if table not in inspect(db_mod.engine).get_table_names():
        log.info("table %s does not exist yet — init_db will create it with the column", table)
        return
    log.info("adding %s.%s (%s)", table, column, ddl_type)
    try:
        with db_mod.engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
    except Exception as exc:
        log.error("failed to add %s.%s: %s", table, column, exc)
        raise


def main() -> None:
    log.info("v2.3 schema migration starting…")
    # The two new columns on each of the two tables.
    add_column("no_dive_labels", "no_go_reason", "VARCHAR(20)")
    add_column("no_dive_labels", "confidence", "VARCHAR(8)")
    add_column("operator_verifications", "no_go_reason", "VARCHAR(20)")
    add_column("operator_verifications", "confidence", "VARCHAR(8)")
    log.info("v2.3 schema migration complete.")


if __name__ == "__main__":
    main()