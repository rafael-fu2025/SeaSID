"""
scripts/expand_with_scraping.py — Run all data-flywheel scrapers.

Phase 6 orchestrator: pulls labels from every registered scraper and
persists them via the no_dive_labels table. The scraper registry is
pluggable — see app/lib/scrapers/ for the base classes and concrete
scrapers.

Usage:
    # All scrapers, default window (last 30 days, all sites)
    python -m scripts.expand_with_scraping

    # Specific scraper + specific site + 90-day window
    python -m scripts.expand_with_scraping \\
        --scrapers archive_synthetic pagasa_synop \\
        --sites dauin_muck \\
        --days 90

    # List available scrapers
    python -m scripts.expand_with_scraping --list
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.scrapers import list_scrapers, run_all
from app.lib.sites import get_all_sites


def main() -> int:
    parser = argparse.ArgumentParser(description="Run data-flywheel scrapers")
    parser.add_argument(
        "--scrapers", nargs="*", default=None,
        help="Subset of scraper names to run (default: all)",
    )
    parser.add_argument(
        "--sites", nargs="*", default=None,
        help="Subset of site keys to scrape (default: all registered)",
    )
    parser.add_argument(
        "--days", type=int, default=30,
        help="Number of past days to scrape (default: 30)",
    )
    parser.add_argument(
        "--list", action="store_true",
        help="List available scrapers and exit",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit a machine-readable JSON summary",
    )
    args = parser.parse_args()

    if args.list:
        print("Available scrapers:")
        for name in list_scrapers():
            print(f"  - {name}")
        return 0

    sites = args.sites or [s["key"] for s in get_all_sites()]
    today = date.today()
    since = today - timedelta(days=args.days)
    until = today

    if not args.json:
        print(f"Phase 6 scrapers: {args.scrapers or list_scrapers()}")
        print(f"Sites: {sites}")
        print(f"Window: {since.isoformat()} -> {until.isoformat()} ({args.days}d)")

    all_results = []
    for site_key in sites:
        results = run_all(site_key, since=since, until=until, scrapers=args.scrapers)
        all_results.extend(results)

    summary = {
        "sites": sites,
        "since": since.isoformat(),
        "until": until.isoformat(),
        "results": [r.to_dict() for r in all_results],
        "totals": {
            "fetched": sum(r.rows_fetched for r in all_results),
            "inserted": sum(r.rows_inserted for r in all_results),
            "skipped": sum(r.rows_skipped for r in all_results),
            "errors": sum(len(r.errors) for r in all_results),
        },
    }

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print()
        print("=" * 70)
        print(f"Scraper results ({len(all_results)} runs)")
        print("=" * 70)
        for r in all_results:
            status = "OK" if not r.errors else f"ERR ({len(r.errors)})"
            print(
                f"  {r.scraper:>22} @ {r.site_key:<14} "
                f"fetched={r.rows_fetched:>4} inserted={r.rows_inserted:>4} "
                f"skipped={r.rows_skipped:>4} {status}"
            )
        print()
        print(f"  Totals: fetched={summary['totals']['fetched']} "
              f"inserted={summary['totals']['inserted']} "
              f"skipped={summary['totals']['skipped']} "
              f"errors={summary['totals']['errors']}")

    return 0 if summary["totals"]["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())