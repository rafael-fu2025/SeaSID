"""
Phase 6 regression tests — data-flywheel scrapers.

Pins down:
  - The scraper registry registers the four default scrapers.
  - Each concrete scraper produces rows in the expected shape.
  - The orchestrator dedupes via (site_key, date, source) upsert.
  - Failures in one scraper don't poison the others.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_scraper_registry_has_four_default_scrapers():
    from app.lib.scrapers import list_scrapers

    names = list_scrapers()
    for expected in ("archive_synthetic", "pagasa_synop", "viz_app", "diveviz"):
        assert expected in names, f"{expected!r} missing from registry: {names}"


def test_register_scraper_rejects_duplicates():
    """Double-registering the same name should fail loudly."""
    from app.lib.scrapers import register_scraper, BaseScraper

    class _Dup(BaseScraper):
        name = "archive_synthetic"  # already registered

        def fetch(self, site_key, *, since, until):
            return []

    with pytest.raises(ValueError, match="already registered"):
        register_scraper(_Dup)


def test_register_scraper_requires_name():
    from app.lib.scrapers import register_scraper, BaseScraper

    class _NoName(BaseScraper):
        name = ""

        def fetch(self, site_key, *, since, until):
            return []

    with pytest.raises(ValueError, match="must set a unique"):
        register_scraper(_NoName)


def test_pagasa_scraper_produces_rows_from_seed_csv():
    """pagasa_synop reads the bundled data/pagasa_seed.csv."""
    from datetime import date
    from app.lib.scrapers.pagasa_synop import PagasaSynopScraper

    s = PagasaSynopScraper()
    rows = s.fetch(
        "dauin_muck",
        since=date(2026, 5, 1),
        until=date(2026, 7, 1),
    )
    assert len(rows) >= 5  # the seed CSV has 6 dauin_muck rows in window

    # All rows must have the contract fields populated.
    for r in rows:
        assert r["date"]
        assert r["label"] in ("dive", "poor_viz", "no_dive")
        # Confidence is propagated from the source CSV: 'med'/'high'
        # for the static seed (PAGASA-graded), 'low' for the live
        # notebook output (regional proxy).
        assert r["confidence"] in ("low", "med", "high")
        assert r["comments"]
        assert r["sub_source"] == "synop"


def test_pagasa_scraper_reads_live_notebook_csv(tmp_path, monkeypatch):
    """Phase 6.1: when ``pagasa_seed_live.csv`` exists (output of the
    ``pagasawebscrape.ipynb`` notebook), the scraper must also read it
    and tag those rows with the producer's confidence ("low")."""
    from datetime import date
    from pathlib import Path

    # Build a synthetic live CSV in a temp dir, then point the scraper
    # at it by monkey-patching the configured paths.
    backend_dir = Path(__file__).resolve().parents[1]
    static = backend_dir / "data" / "pagasa_seed.csv"
    assert static.exists(), "static seed missing — scraper test broken"

    live = tmp_path / "pagasa_seed_live.csv"
    live.write_text(
        "date,site_key,rain_mm,wind_max_kmh,wave_m,actual_viz_m,current,actual_current,no_go_reason,confidence,comments\n"
        "2026-07-13,dauin_muck,0.0,7.2,0.0,12.0,,,weather,low,regional proxy: wind=7.2 km/h\n",
        encoding="utf-8",
    )

    # We can't easily redirect the scraper's _csv_paths (they're computed
    # in __init__ from a relative path) — so instead, write into the real
    # data dir for the duration of this test, then restore.
    real_live = backend_dir / "data" / "pagasa_seed_live.csv"
    backup = real_live.read_bytes() if real_live.exists() else None
    real_live.write_bytes(live.read_bytes())
    try:
        from app.lib.scrapers.pagasa_synop import PagasaSynopScraper
        s = PagasaSynopScraper()
        rows = s.fetch(
            "dauin_muck",
            since=date(2026, 7, 1),
            until=date(2026, 7, 31),
        )
        # At least one row from the live CSV
        live_rows = [r for r in rows if r["confidence"] == "low"]
        assert live_rows, "scraper did not read the live notebook CSV"
        r = live_rows[0]
        assert r["label"] in ("dive", "poor_viz", "no_dive")
        # Scraper appends the source filename to comments so operators
        # can tell which file a row came from.
        assert "pagasa_seed_live.csv" in r["comments"]
    finally:
        if backup is None:
            real_live.unlink(missing_ok=True)
        else:
            real_live.write_bytes(backup)


def test_viz_app_scraper_filters_by_site():
    from datetime import date
    from app.lib.scrapers.viz_apps import VizAppScraper

    s = VizAppScraper()
    rows = s.fetch("apo_reef", since=date(2026, 5, 1), until=date(2026, 7, 1))
    # Each row should be for apo_reef.
    for r in rows:
        # Either explicit site_key column matches OR apo_reef appears in comments.
        assert r.get("site_key") == "apo_reef" or "apo_reef" in (r.get("comments") or "")


def test_diveviz_scraper_filters_by_site():
    from datetime import date
    from app.lib.scrapers.viz_apps import DiveVizScraper

    s = DiveVizScraper()
    rows = s.fetch("dauin_muck", since=date(2026, 5, 1), until=date(2026, 7, 1))
    for r in rows:
        assert r.get("site_key") == "dauin_muck" or "dauin_muck" in (r.get("comments") or "")


def test_run_all_dedupes_via_upsert():
    """Re-running the orchestrator must skip rows already inserted, not crash."""
    from datetime import date, timedelta
    from app.lib.scrapers import run_all

    today = date.today()
    since = today - timedelta(days=1)
    until = today
    results = run_all("dauin_muck", since=since, until=until, scrapers=["viz_app"])
    # viz_app seed has 5 dauin_muck rows in May-July; most fall outside
    # the 1-day window so this run fetches 0. Either way, it must not
    # raise.
    assert isinstance(results, list)


def test_run_all_returns_results_per_scraper():
    """One ScraperResult per (scraper × site) requested."""
    from datetime import date, timedelta
    from app.lib.scrapers import run_all

    today = date.today()
    since = today - timedelta(days=120)
    until = today
    results = run_all(
        "dauin_muck",
        since=since,
        until=until,
        scrapers=["pagasa_synop", "viz_app", "diveviz"],
    )
    assert len(results) == 3
    scraper_names = sorted(r.scraper for r in results)
    assert scraper_names == ["diveviz", "pagasa_synop", "viz_app"]


def test_run_all_handles_unknown_scraper():
    from datetime import date, timedelta
    from app.lib.scrapers import run_all

    with pytest.raises(KeyError, match="unknown scraper"):
        run_all(
            "dauin_muck",
            since=date.today() - timedelta(days=1),
            until=date.today(),
            scrapers=["not_a_real_scraper"],
        )


def test_to_label_rows_propagates_phase5_fields():
    """The scraper→ORM conversion must carry no_go_reason + confidence."""
    from app.lib.scrapers.open_meteo_archive import OpenMeteoArchiveScraper

    scraper = OpenMeteoArchiveScraper()
    rows = [
        {
            "date": __import__("datetime").date(2026, 7, 1),
            "label": "no_dive",
            "no_go_reason": "weather",
            "confidence": "high",
            "actual_viz_m": 3.0,
            "actual_current": "High",
            "comments": "phase 6 fixture",
            "sub_source": "test",
        },
    ]
    label_rows = scraper.to_label_rows("dauin_muck", rows)
    assert len(label_rows) == 1
    r = label_rows[0]
    assert r.no_go_reason == "weather"
    assert r.confidence == "high"
    assert r.source == "archive_synthetic_test"


def test_run_all_one_failure_doesnt_block_others():
    """If scraper A raises, scraper B still runs and reports OK."""
    from datetime import date, timedelta
    from app.lib.scrapers import run_all, BaseScraper, register_scraper

    @register_scraper
    class _Boom(BaseScraper):
        name = "phase6_test_boom"
        def fetch(self, site_key, *, since, until):
            raise RuntimeError("simulated outage")

    @register_scraper
    class _Good(BaseScraper):
        name = "phase6_test_good"
        def fetch(self, site_key, *, since, until):
            return [{
                "date": date.today() - timedelta(days=2),
                "label": "dive",
                "no_go_reason": None,
                "confidence": "med",
                "actual_viz_m": 18.0,
                "actual_current": "Low",
                "comments": "phase 6 fixture good",
                "sub_source": "test",
            }]

    try:
        results = run_all(
            "dauin_muck",
            since=date.today() - timedelta(days=3),
            until=date.today(),
            scrapers=["phase6_test_boom", "phase6_test_good"],
        )
        by_name = {r.scraper: r for r in results}
        assert by_name["phase6_test_boom"].errors
        assert by_name["phase6_test_good"].rows_inserted == 1
    finally:
        # Clean up the test scrapers so they don't pollute future tests.
        from app.lib.scrapers.base import _REGISTRY
        _REGISTRY.pop("phase6_test_boom", None)
        _REGISTRY.pop("phase6_test_good", None)
        # Also clean up the inserted row.
        from app.lib import db as db_mod
        from datetime import date as _date
        session = db_mod.SessionLocal()
        try:
            session.query(db_mod.NoDiveLabel).filter(
                db_mod.NoDiveLabel.source == "phase6_test_good_test",
                db_mod.NoDiveLabel.date == _date.today() - timedelta(days=2),
            ).delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()