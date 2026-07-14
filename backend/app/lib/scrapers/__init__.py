"""
Phase 6 — Data flywheel scrapers.

Each scraper pulls operator-style dive observations from a public source
and writes them into the ``no_dive_labels`` table with a distinct
``source`` value (e.g. ``pagasa_synop``, ``dive_shop_facebook``,
``viz_app_post``). Scrapers return a small dict with counts so the
orchestrator can summarise.

This module does NOT require API keys for the default sources — it uses
public Open-Meteo / NOAA / social posts. Scrapers that need credentials
are stubbed with a clear ``NotImplementedError`` until keys are configured.
"""
from app.lib.scrapers.base import (
    ScraperResult,
    BaseScraper,
    register_scraper,
    list_scrapers,
    run_all,
)

# Importing these registers the scrapers via the @register_scraper
# decorator. Each one shows up automatically in list_scrapers() and
# run_all(). Concrete scrapers live in their own modules so adding a
# new source is a single-file change.
from app.lib.scrapers import open_meteo_archive  # noqa: F401
from app.lib.scrapers import pagasa_synop  # noqa: F401
from app.lib.scrapers import viz_apps  # noqa: F401

__all__ = [
    "ScraperResult",
    "BaseScraper",
    "register_scraper",
    "list_scrapers",
    "run_all",
]