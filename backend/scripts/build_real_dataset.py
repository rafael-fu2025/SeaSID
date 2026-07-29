"""
scripts/build_real_dataset.py — Build a real multi-year training dataset.

Implements Phase 1 + Phase 2 of the "Accurate Dive Model Rebuild" plan:

  1. Back up seasid.db (safety — this run mutates weather/marine rows).
  2. Ingest real hourly weather + marine (waves, period, sea temp) from the
     Open-Meteo Archive + Marine endpoints for both production sites over a
     multi-year window (default 2023-01-01 -> yesterday). Existing cached rows
     are backfilled with real waves/sea-temp (see ingest.ingest_archive).
  3. Run the PAGASA scraper for independent gale/typhoon-grounded labels.
  4. Fill every remaining day with a threshold label derived from the REAL
     sea-state (source="threshold_v2"). Real observations always win — a
     threshold label is only written for days without a real label. The old
     circular ``synthetic_rule`` labels are ignored (train_model excludes them).

Usage:
    python -m scripts.build_real_dataset
    python -m scripts.build_real_dataset --start 2023-01-01
    python -m scripts.build_real_dataset --skip-ingest   # labels only
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib import db as _db_mod
from app.lib.db import init_db
from app.lib.features import (
    FEATURE_COLUMNS,
    build_features_from_arrays,
    _fetch_weather_window,
    _fetch_tide_window,
    _fetch_marine_window,
    _fetch_air_snapshot,
)
from app.lib.ingest import ingest_archive
from app.lib.scoring import risk_label, score_hour
from app.lib.scrapers.base import run_all
from app.lib.sites import get_all_sites

# Sources that are circular / rule-generated and must never block a real
# threshold fill or count as a "real" observation.
_NON_REAL_PREFIXES = ("synthetic_rule", "archive_synthetic", "threshold_v2")

THRESHOLD_SOURCE = "threshold_v2"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _backup_db() -> None:
    src = DATA_DIR / "seasid.db"
    if not src.exists():
        return
    dst = DATA_DIR / "baseline_v1" / "seasid.db.bak"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"Backed up DB -> {dst}")


def _ingest_window(site_key: str, start: date, end: date) -> tuple[int, int, int]:
    """Ingest archive weather+marine in 6-month chunks.

    Returns (weather, marine, failed_chunks). Synthetic fallback is disabled so
    a network failure yields 0 rows for that chunk instead of fake data.
    """
    total_w = total_m = failed = 0
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=180), end)
        res = ingest_archive(site_key, chunk_start.isoformat(), chunk_end.isoformat(),
                             allow_synthetic=False)
        w, m = res.get("weather_rows", 0), res.get("marine_rows", 0)
        if w == 0:
            failed += 1
        total_w += w
        total_m += m
        print(f"    [{chunk_start} -> {chunk_end}] weather={w} marine={m}")
        chunk_start = chunk_end + timedelta(days=1)
    return total_w, total_m, failed


def _real_labelled_days(session, site_key: str, start: date, end: date) -> set[date]:
    """Dates that already carry a *real* (non-circular) label — these win."""
    rows = (
        session.query(_db_mod.NoDiveLabel.date, _db_mod.NoDiveLabel.source)
        .filter(_db_mod.NoDiveLabel.site_key == site_key)
        .filter(_db_mod.NoDiveLabel.date >= start)
        .filter(_db_mod.NoDiveLabel.date <= end)
        .all()
    )
    real: set[date] = set()
    for d, src in rows:
        src = src or ""
        if not any(src.startswith(p) for p in _NON_REAL_PREFIXES):
            real.add(d)
    return real


def _generate_threshold_labels(site_key: str, start: date, end: date) -> tuple[int, int]:
    """Write threshold_v2 labels from real sea-state. Returns (created, skipped)."""
    session = _db_mod.SessionLocal()
    created = skipped = 0
    try:
        real_days = _real_labelled_days(session, site_key, start, end)

        # Fetch the full multi-year windows ONCE, then compute each day's
        # features with build_features_from_arrays (which correctly bounds
        # the 24h/48h windows on BOTH sides). The batched builder
        # build_features_for_window is broken for wide spans (it treats the
        # entire span as the 48h window), so it must not be used here.
        end_ts = datetime(end.year, end.month, end.day, 12, 0, 0, tzinfo=timezone.utc)
        start_ts = datetime(start.year, start.month, start.day, 12, 0, 0, tzinfo=timezone.utc)
        span_hours = int((end_ts - start_ts).total_seconds() // 3600) + 72
        wdf = _fetch_weather_window(site_key, end_ts, hours=span_hours)
        tdf = _fetch_tide_window(site_key, end_ts, hours=span_hours)
        mdf = _fetch_marine_window(site_key, end_ts, hours=span_hours)
        air = _fetch_air_snapshot(site_key, end_ts)

        days: list[date] = []
        d = start
        while d <= end:
            days.append(d)
            d += timedelta(days=1)

        for dd in days:
            if dd in real_days:
                skipped += 1
                continue
            target_ts = datetime(dd.year, dd.month, dd.day, 12, 0, 0, tzinfo=timezone.utc)
            feat_df = build_features_from_arrays(
                wdf, tdf, site_key, target_ts, marine_df=mdf, air_snapshot=air,
            )
            feat_dict = dict(zip(FEATURE_COLUMNS, feat_df.values[0]))
            # Skip days with no real weather signal at all (all-zero precip and
            # wind means the window had no ingested data — avoid a bogus "dive").
            if feat_dict.get("precip_48h_mm", 0.0) == 0.0 and \
               feat_dict.get("wind_max_24h_kmh", 0.0) == 0.0 and \
               feat_dict.get("wave_max_24h_m", 0.0) == 0.0:
                skipped += 1
                continue

            viz, curr = score_hour(feat_dict)
            rl = risk_label(viz, curr)
            if rl == "HIGH RISK":
                label, viz_est = "no_dive", 3.0
            elif rl == "MODERATE":
                label, viz_est = "poor_viz", 8.0
            else:
                label, viz_est = "dive", 15.0

            existing = (
                session.query(_db_mod.NoDiveLabel)
                .filter(
                    _db_mod.NoDiveLabel.site_key == site_key,
                    _db_mod.NoDiveLabel.date == dd,
                    _db_mod.NoDiveLabel.source == THRESHOLD_SOURCE,
                )
                .first()
            )
            if existing:
                skipped += 1
                continue

            session.add(_db_mod.NoDiveLabel(
                site_key=site_key,
                date=dd,
                label=label,
                source=THRESHOLD_SOURCE,
                actual_viz_m=viz_est,
                actual_current=curr,
                comments=f"threshold_v2: viz={viz}, current={curr}, risk={rl}",
                confidence="low",
            ))
            created += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return created, skipped


def _print_composition() -> None:
    from sqlalchemy import func
    session = _db_mod.SessionLocal()
    try:
        print("\n=== Label composition ===")
        for src, n in (
            session.query(_db_mod.NoDiveLabel.source, func.count(_db_mod.NoDiveLabel.id))
            .group_by(_db_mod.NoDiveLabel.source).all()
        ):
            print(f"  {src}: {n}")
        print("  --- distribution (all) ---")
        for lab, n in (
            session.query(_db_mod.NoDiveLabel.label, func.count(_db_mod.NoDiveLabel.id))
            .group_by(_db_mod.NoDiveLabel.label).all()
        ):
            print(f"  {lab}: {n}")
    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build real multi-year training dataset")
    parser.add_argument("--start", default="2023-01-01", help="Window start (YYYY-MM-DD)")
    parser.add_argument("--end", default=None, help="Window end (default: yesterday)")
    parser.add_argument("--skip-ingest", action="store_true", help="Skip weather/marine ingest")
    args = parser.parse_args()

    init_db()
    _backup_db()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=1)
    print(f"Window: {start} -> {end}")

    sites = get_all_sites()

    if not args.skip_ingest:
        print("\n== Phase 1: ingest real weather + marine ==")
        total_failed = 0
        for site in sites:
            print(f"  -- {site['name']} ({site['key']}) --")
            w, m, failed = _ingest_window(site["key"], start, end)
            total_failed += failed
            print(f"  total weather={w} marine={m} failed_chunks={failed}")
        if total_failed:
            print(f"\n  WARNING: {total_failed} chunk(s) failed to fetch (network). "
                  "Re-run to backfill the gaps before training.")

    print("\n== Phase 2a: PAGASA scraper ==")
    for site in sites:
        results = run_all(site["key"], since=start, until=end, scrapers=["pagasa_synop"])
        for r in results:
            print(f"  {site['key']}: fetched={r.rows_fetched} inserted={r.rows_inserted} "
                  f"skipped={r.rows_skipped}")

    print("\n== Phase 2b: threshold_v2 gap labels ==")
    for site in sites:
        created, skipped = _generate_threshold_labels(site["key"], start, end)
        print(f"  {site['key']}: created={created} skipped={skipped}")

    _print_composition()
    print("\nDone.")


if __name__ == "__main__":
    main()
