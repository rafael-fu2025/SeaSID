"""v2.1 schema migration — adds the new columns/tables introduced in this revision.

Idempotent: safe to re-run. Run with:
    python -m scripts.migrate_v21
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
from sqlalchemy import inspect, text

from app.lib import db as db_mod

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("migrate_v21")


def column_exists(table: str, column: str) -> bool:
    cols = {c["name"] for c in inspect(db_mod.engine).get_columns(table)}
    return column in cols


def table_exists(table: str) -> bool:
    return table in inspect(db_mod.engine).get_table_names()


def add_column_if_missing(table: str, column: str, ddl: str) -> None:
    if column_exists(table, column):
        log.info("column %s.%s already exists — skipping", table, column)
        return
    log.info("adding column %s.%s", table, column)
    with db_mod.engine.begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def main() -> None:
    log.info("v2.1 schema migration starting…")

    # 1) Ensure all tables exist (covers marine_obs + air_quality_obs if the DB predates them)
    db_mod.init_db()

    # 2) Backfill columns on pre-existing tables
    add_column_if_missing("weather_obs", "source", "VARCHAR(32)")
    add_column_if_missing("air_quality_obs", "station_lat", "FLOAT")
    add_column_if_missing("air_quality_obs", "station_lon", "FLOAT")
    add_column_if_missing("air_quality_obs", "distance_km", "FLOAT")
    add_column_if_missing("air_quality_obs", "quality", "VARCHAR(16)")

    # 3) Verify
    inspector = inspect(db_mod.engine)
    log.info("tables: %s", sorted(inspector.get_table_names()))
    log.info("weather_obs columns: %s",
             sorted(c["name"] for c in inspector.get_columns("weather_obs")))

    log.info("v2.1 schema migration complete")


if __name__ == "__main__":
    main()