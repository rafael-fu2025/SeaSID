"""
Scraper: Open-Meteo Archive + rule-based label synthesis.

For each historical day in [since, until], pulls the 24 hours of weather
from Open-Meteo Archive, runs ``score_hour`` on the noon features, and
writes the resulting ``no_dive_labels`` row.

This isn't a real "operator report" — it's rule-based labelling driven
by historical data. The scraper framework treats it the same way as a
real source so it composes with the orchestrator.

Source: ``archive_synthetic``
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from app.lib.scrapers.base import BaseScraper, register_scraper
from app.lib.features import build_features, FEATURE_COLUMNS
from app.lib.scoring import score_hour, risk_label, features_dict_from_row

logger = logging.getLogger(__name__)


@register_scraper
class OpenMeteoArchiveScraper(BaseScraper):
    """Generate training labels from historical weather + the rule scorer."""

    name = "archive_synthetic"

    def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
        out: list[dict] = []
        current = since
        while current <= until:
            target_ts = datetime(
                current.year, current.month, current.day, 12, 0, 0,
                tzinfo=timezone.utc,
            )
            try:
                feat_df = build_features(site_key, target_ts)
                feat_dict = features_dict_from_row(feat_df.values[0])
                viz, current_risk = score_hour(feat_dict)
                rl = risk_label(viz, current_risk)

                if rl == "HIGH RISK":
                    label = "no_dive"
                    viz_estimate = 3.0
                    reason = "weather"
                elif rl == "MODERATE":
                    label = "poor_viz"
                    viz_estimate = 8.0
                    reason = "weather"
                else:
                    label = "dive"
                    viz_estimate = 15.0
                    reason = None

                # Map current_risk text → Phase-5 enum. Skip days where
                # current risk is missing (rules require a known value).
                phase5_current = (
                    current_risk if current_risk in ("Low", "Moderate", "High")
                    else None
                )

                out.append({
                    "date": current,
                    "label": label,
                    "actual_viz_m": viz_estimate,
                    "actual_current": phase5_current,
                    "no_go_reason": reason,
                    "confidence": "low",  # rule-derived, not observed
                    "comments": (
                        f"archive_synthetic: rule={rl}, "
                        f"viz={viz}, current={current_risk}"
                    ),
                    "sub_source": "archive",
                })
            except Exception as exc:
                logger.debug(
                    "skipping %s @ %s: %s", site_key, current.isoformat(), exc,
                )
                # Skip silently — most often means missing weather rows.
            current += timedelta(days=1)
        return out