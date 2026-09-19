"""v2.4 schema migration — observation-table provenance columns.

Audit F-B1-17: every observation table gains provenance so bad backfills
are auditable and purgable:

  - ``ingested_at`` (TIMESTAMP, nullable) on weather_obs, marine_obs,
    air_quality_obs, tide_obs — distinguishes "observed at hour X" from
    "landed in the DB much later".
  - ``source`` (VARCHAR(32), nullable) on tide_obs — the other three tables
    already carried it.

All columns are nullable so existing rows remain valid. Idempotent: safe
to re-run (columns detected via PRAGMA table_info).

Run with:
    python -m scripts.migrate_v24
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from sqlalchemy import inspect, text

from app.lib import db as db_mod

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("migrate_v24")


def column_exists(table: str, column: str) -> bool:
    """Return True if ``column`` is already defined on ``table``."""
    inspector = inspect(db_mod.engine)
    if table not in inspector.get_table_names():
        return False
    cols = {c["name"] for c in inspector.get_columns(table)}
    return column in cols


def add_column(table: str, column: str, ddl_type: str) -> None:
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
    log.info("v2.4 schema migration starting…")
    for table in ("weather_obs", "marine_obs", "air_quality_obs", "tide_obs"):
        add_column(table, "ingested_at", "TIMESTAMP")
    add_column("tide_obs", "source", "VARCHAR(32)")
    add_column("operator_verifications", "shop_name", "VARCHAR(100)")
    log.info("v2.4 schema migration complete.")


if __name__ == "__main__":
    main()
