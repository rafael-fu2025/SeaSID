"""
Forecast freshness + provenance helper (roadmap #8).

Single source of truth for "is this source live, stale, or unavailable?"
decisions used by the /forecast endpoint and surfaced in the UI as
FreshnessBadge chips. Centralizing the rules keeps the badge component
on the frontend a dumb renderer and makes the freshness policy easy to
audit.

Freshness policy
----------------
* weather / marine: live if newest observation <= 3h old, stale if <= 24h,
  unavailable beyond that.
* tides: live if newest observation <= 6h old (tide cycle is ~12h), stale
  if <= 24h, unavailable beyond that.
* air: live if newest observation <= 2h old (AQICN refreshes hourly), stale
  if <= 12h, unavailable beyond that.

Each rule also marks the source unavailable if the provider is disabled
(``air_provider_disabled`` for air) or if the table is empty for the site.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy.orm import Session

from app.lib import db
from app.lib.sites import get_site


FreshnessStatus = Literal["live", "stale", "unavailable"]


# ── Thresholds (hours) ──────────────────────────────────────────────────────
WEATHER_LIVE_HOURS = 3
WEATHER_STALE_HOURS = 24
MARINE_LIVE_HOURS = 3
MARINE_STALE_HOURS = 24
TIDE_LIVE_HOURS = 6
TIDE_STALE_HOURS = 24
AIR_LIVE_HOURS = 2
AIR_STALE_HOURS = 12


@dataclass
class SourceFreshness:
    """Freshness descriptor for one data source on a site."""

    source: str  # "weather" | "marine" | "tide" | "air"
    status: FreshnessStatus
    last_observed_at: str | None  # ISO8601 or None when never observed
    age_hours: float | None  # None when never observed
    provider: str | None  # provider name ("open_meteo", "stormglass", ...) or None

    def to_dict(self) -> dict:
        return asdict(self)


def _latest_ts(session: Session, model, site_key: str) -> datetime | None:
    """Return the newest ``ts`` for ``(site_key, model)`` or None."""
    row = (
        session.query(model.ts)
        .filter(model.site_key == site_key)
        .order_by(model.ts.desc())
        .first()
    )
    return None if row is None else row[0]


def _classify(
    last_observed: datetime | None,
    now: datetime,
    live_h: float,
    stale_h: float,
    provider: str | None,
) -> SourceFreshness:
    """Classify one source's freshness against the policy."""
    src = "??"  # overwritten by callers; placeholder until dataclass is built
    if last_observed is None:
        return SourceFreshness(
            source=src,
            status="unavailable",
            last_observed_at=None,
            age_hours=None,
            provider=provider,
        )

    # Make last_observed timezone-aware if it isn't (SQLite drops tzinfo).
    if last_observed.tzinfo is None:
        last_observed = last_observed.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    age_hours = (now - last_observed).total_seconds() / 3600.0
    if age_hours <= live_h:
        status: FreshnessStatus = "live"
    elif age_hours <= stale_h:
        status = "stale"
    else:
        status = "unavailable"

    return SourceFreshness(
        source=src,
        status=status,
        last_observed_at=last_observed.isoformat(),
        age_hours=round(age_hours, 2),
        provider=provider,
    )


def compute_freshness(
    site_key: str,
    providers: dict[str, str],
    now: datetime | None = None,
) -> list[SourceFreshness]:
    """Compute freshness for every data source that feeds a forecast.

    Args:
        site_key: the site being queried.
        providers: mapping ``{"weather": "open_meteo", "marine": "...",
            "air": "..."}`` produced by ``active_providers()``.
        now: override for the current time (useful in tests).

    Returns:
        A list of :class:`SourceFreshness`, one per logical source
        (weather, marine, tide, air). Air is omitted entirely when the
        site has ``air_provider_disabled=True``.
    """
    now = now or datetime.now(timezone.utc)

    site = get_site(site_key)
    air_disabled = bool(site and site.get("air_provider_disabled"))

    session = db.SessionLocal()
    try:
        weather = _classify(
            _latest_ts(session, db.WeatherObs, site_key),
            now,
            WEATHER_LIVE_HOURS,
            WEATHER_STALE_HOURS,
            providers.get("weather"),
        )
        weather.source = "weather"

        marine = _classify(
            _latest_ts(session, db.MarineObs, site_key),
            now,
            MARINE_LIVE_HOURS,
            MARINE_STALE_HOURS,
            providers.get("marine"),
        )
        marine.source = "marine"

        tide = _classify(
            _latest_ts(session, db.TideObs, site_key),
            now,
            TIDE_LIVE_HOURS,
            TIDE_STALE_HOURS,
            providers.get("weather"),  # tides piggy-back on weather provider for now
        )
        tide.source = "tide"

        out = [weather, marine, tide]

        if not air_disabled:
            air = _classify(
                _latest_ts(session, db.AirQualityObs, site_key),
                now,
                AIR_LIVE_HOURS,
                AIR_STALE_HOURS,
                providers.get("air"),
            )
            air.source = "air"
            out.append(air)

        return out
    finally:
        session.close()


def model_version(bundle: dict | None) -> str:
    """Return a human-readable version string for the loaded ML bundle.

    LSTM bundles carry ``config`` (with arch and seq_len) but no real
    version. We surface the model type + arch so operators can tell which
    model produced the forecast. The cache file's mtime is appended as a
    coarse identifier — enough to tell "this is the same model you trained
    last Tuesday" without a full registry.
    """
    from app.lib.model import get_model_type

    if bundle is None:
        return "rule-based-v1"

    model_type = get_model_type(bundle)
    if model_type == "lstm":
        arch = bundle.get("config", {}).get("arch", "lstm")
        seq_len = bundle.get("config", {}).get("seq_len", 24)
        return f"lstm-{arch}-{seq_len}h-v1"
    if model_type == "xgboost":
        return "xgboost-v1"
    return "rule-based-v1"