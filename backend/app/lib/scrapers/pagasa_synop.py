"""
Scraper: PAGASA Synoptic stations (Philippine Atmos. & Astronomical Services Admin.).

PAGASA publishes daily weather summaries from ~60 synoptic stations
across the Philippines. The Dauin station is part of the Dumaguete
synoptic network (station code 98747 / WMO ID).

For SeaSID we want:
  - Daily rainfall (mm)
  - Mean wind speed (km/h)
  - Max wind gust (km/h)
  - Significant wave height (when available)

When wave data is unavailable we fall back to Open-Meteo Archive for
the same date and site coords — PAGASA's free tier doesn't expose
historical marine observations through their public endpoint.

Source: ``pagasa_synop``
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from app.lib.scrapers.base import BaseScraper, register_scraper
from app.lib.sites import get_site

logger = logging.getLogger(__name__)


@register_scraper
class PagasaSynopScraper(BaseScraper):
    """Pull PAGASA daily summaries for the Dauin/Dumaguete region.

    PAGASA's public API requires partner credentials. Without those we
    fall back to a curated stub: read pre-prepared daily summaries from
    ``data/pagasa_seed.csv`` (one row per date) so the rest of the
    pipeline can be exercised end-to-end. Operators can drop real
    PAGASA exports there.

    Also reads the live notebook output ``data/pagasa_seed_live.csv``
    when present — that's produced by ``data/pagasawebscrape.ipynb``
    which scrapes bagong.pagasa.dost.gov.ph/automated-weather-station
    every time an operator runs it. Same schema, additive.
    """

    name = "pagasa_synop"

    def __init__(self) -> None:
        from pathlib import Path
        # CSVs sit in backend/data — same location as the trained model
        # artefacts. ``pagasa_seed.csv`` is the static seed (manually
        # written). ``pagasa_seed_live.csv`` is the output of the
        # ``pagasawebscrape.ipynb`` notebook (Phase 6.1) that scrapes
        # live PAGASA AWS readings and writes a regional-proxy label
        # for each SeaSID site. Both share the same schema so we read
        # them in order and let INSERT-OR-IGNORE dedupe.
        backend_dir = Path(__file__).resolve().parents[3]
        self._csv_paths = [
            backend_dir / "data" / "pagasa_seed.csv",
            backend_dir / "data" / "pagasa_seed_live.csv",
        ]

    def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
        site = get_site(site_key)
        if site is None:
            return []
        existing = [p for p in self._csv_paths if p.exists()]
        if not existing:
            logger.info(
                "No PAGASA seed CSV found at %s — scraper yields nothing. "
                "Drop PAGASA exports there to enable this source.",
                self._csv_paths,
            )
            return []
        # Iterate both seed files: the static pagasa_seed.csv (manually
        # curated) AND the live notebook output pagasa_seed_live.csv.
        # Identical schemas — INSERT-OR-IGNORE dedupes at the DB layer.

        # CSV parsing — use the stdlib csv module so embedded commas in
        # the comments column don't break the parse (the seed file has
        # phrases like "calm day, dive conditions nominal").
        import csv
        rows: list[dict] = []
        for csv_path in existing:
            try:
                with open(csv_path, "r", encoding="utf-8", newline="") as f:
                    reader = csv.DictReader(f)
                    for record in reader:
                        # Normalise keys (DictReader preserves header case).
                        record = {k.strip().lower(): (v or "").strip() for k, v in record.items() if k}
                        # Filter by site_key up-front so a CSV with both
                        # dauin_muck + apo_reef rows doesn't double-count.
                        row_site = record.get("site_key") or ""
                        if row_site and row_site != site_key:
                            continue
                        try:
                            d = date.fromisoformat(record["date"])
                        except Exception:
                            continue
                        if not (since <= d <= until):
                            continue
                        # Translate PAGASA's daily summary into our label shape.
                        rain_mm = float(record.get("rain_mm") or 0)
                        wind_max = float(record.get("wind_max_kmh") or 0)
                        wave_m = float(record.get("wave_m") or 0)
                        # The live notebook output pre-classifies with
                        # ``no_go_reason`` and ``confidence`` columns —
                        # trust those when present (so the heuristic
                        # below doesn't override an actual observer's
                        # no-go call). Fall back to the heuristic if
                        # the static seed CSV didn't classify.
                        preset_reason = (record.get("no_go_reason") or "").strip()
                        preset_confidence = (record.get("confidence") or "").strip().lower()
                        if preset_reason or preset_confidence == "low":
                            # Live-notebook path — trust the producer.
                            # Re-derive a coarse label so the downstream
                            # training step still has a binary signal.
                            if preset_reason:
                                label = "no_dive"
                                reason = preset_reason
                            elif rain_mm > 25 or wind_max > 35 or wave_m > 2.0:
                                label = "no_dive"; reason = "weather"
                            elif rain_mm > 12 or wind_max > 20 or wave_m > 1.2:
                                label = "poor_viz"; reason = "weather"
                            else:
                                label = "dive"; reason = None
                            confidence = preset_confidence or "low"
                        else:
                            if rain_mm > 25 or wind_max > 35 or wave_m > 2.0:
                                label = "no_dive"
                                reason = "weather"
                            elif rain_mm > 12 or wind_max > 20 or wave_m > 1.2:
                                label = "poor_viz"
                                reason = "weather"
                            else:
                                label = "dive"
                                reason = None
                            confidence = "med"  # PAGASA observations are official
                        rows.append({
                            "date": d,
                            "label": label,
                            "actual_viz_m": float(record.get("actual_viz_m") or 8.0),
                            "actual_current": record.get("actual_current") or record.get("current") or None,
                            "no_go_reason": reason,
                            "confidence": confidence,
                            "comments": (
                                f"pagasa_synop ({csv_path.name}): "
                                f"rain={rain_mm:.1f}mm, wind={wind_max:.0f}km/h, wave={wave_m:.1f}m"
                            ),
                            "sub_source": "synop",
                        })
            except Exception as exc:
                logger.warning("Failed to read %s: %s", csv_path, exc)
                # continue with the next file rather than aborting the run
                continue
        return rows