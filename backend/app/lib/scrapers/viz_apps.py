"""
Scraper: Viz App + DiveViz public dive reports.

[Viz App](https://www.viz-app.com/) and [DiveViz](https://diveviz.com/)
both publish crowd-sourced dive conditions: visibility (m), water temp,
current, and a per-site "go/no-go" thumbs-up. Their public pages expose
the last 30 days for a given site.

These scrapers are STUBS — implementing them requires browser
automation (Playwright / Selenium) because both sites render the
report list client-side. Until that's wired up, this module exposes a
clean interface + a documented CSV fallback path that operators can
hand-fill from their own observations.

Source: ``viz_app`` and ``diveviz``
"""
from __future__ import annotations

import csv
import logging
from datetime import date, datetime
from pathlib import Path

from app.lib.scrapers.base import BaseScraper, register_scraper
from app.lib.sites import get_site

logger = logging.getLogger(__name__)


def _read_csv_seed(csv_path: Path, *, since: date, until: date, source_label: str) -> list[dict]:
    """Read a hand-curated CSV of dive reports from `csv_path`.

    The CSV schema is intentionally simple — operators can scrape these
    sources manually with browser dev tools, paste the rows into Excel,
    and re-export as CSV. Once a richer scraper is implemented (Phase 6
    follow-up), this fallback path becomes the offline cache.
    """
    rows: list[dict] = []
    if not csv_path.exists():
        return rows
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for record in reader:
                try:
                    d = date.fromisoformat(record["date"])
                except Exception:
                    continue
                if not (since <= d <= until):
                    continue
                # Carry site_key through so the filter helper can match by
                # the explicit column. Default to dauin_muck when absent
                # so legacy CSV exports without the column still work.
                row_site = (record.get("site_key") or "").strip() or None
                rows.append({
                    "date": d,
                    "site_key": row_site,
                    "label": record.get("label", "dive"),
                    "actual_viz_m": float(record["actual_viz_m"]) if record.get("actual_viz_m") else None,
                    "actual_current": record.get("actual_current") or None,
                    "no_go_reason": record.get("no_go_reason") or None,
                    "confidence": record.get("confidence", "med"),
                    "comments": record.get("comments") or f"{source_label} crowdsourced report",
                    "sub_source": source_label,
                })
    except Exception as exc:
        logger.warning("Failed to read %s: %s", csv_path, exc)
    return rows


@register_scraper
class VizAppScraper(BaseScraper):
    """Crowd-sourced dive conditions from viz-app.com (CSV fallback for now)."""

    name = "viz_app"

    def __init__(self) -> None:
        backend_dir = Path(__file__).resolve().parents[3]
        self._csv_path = backend_dir / "data" / "viz_app_seed.csv"

    def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
        all_rows = _read_csv_seed(
            self._csv_path, since=since, until=until, source_label="viz_app",
        )
        return _filter_by_site(all_rows, site_key)


@register_scraper
class DiveVizScraper(BaseScraper):
    """Crowd-sourced dive conditions from diveviz.com (CSV fallback for now)."""

    name = "diveviz"

    def __init__(self) -> None:
        backend_dir = Path(__file__).resolve().parents[3]
        self._csv_path = backend_dir / "data" / "diveviz_seed.csv"

    def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
        all_rows = _read_csv_seed(
            self._csv_path, since=since, until=until, source_label="diveviz",
        )
        return _filter_by_site(all_rows, site_key)


def _filter_by_site(rows: list[dict], site_key: str) -> list[dict]:
    """Return only rows that match ``site_key`` (by ``site_key`` column or comments)."""
    out = []
    for r in rows:
        if r.get("site_key") == site_key:
            out.append(r)
            continue
        if site_key in (r.get("comments") or ""):
            out.append(r)
    return out