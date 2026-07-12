"""
Service layer — business logic between API routes and core library.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone, date as date_type

from app.lib import db
from app.lib.features import build_features, build_features_for_window, FEATURE_COLUMNS
from app.lib.scoring import (
    score_hour,
    risk_label,
    features_dict_from_row,
    derive_label,
    label_to_binary,
)
from app.lib.sites import get_site, get_all_sites, site_keys
from app.lib.model import load_best, predict, get_model_type
from app.lib.ingest import ingest_site
from app.lib.alerts import get_recent_alerts

logger = logging.getLogger(__name__)


def _latest_air_snapshot(site_key: str) -> dict | None:
    """Most recent air_quality_obs row for a site, or None.

    Returns None when the site has ``air_provider_disabled=True`` so that
    deployments without a nearby AQICN station never expose a stale or
    misleading air block. The dormant-path issue (roadmap item 15) is
    resolved by treating the flag as authoritative: ingest already skips
    these sites, and now the forecast side does too.
    """
    site = get_site(site_key)
    if site is not None and site.get("air_provider_disabled"):
        return None

    session = db.SessionLocal()
    try:
        row = (
            session.query(db.AirQualityObs)
            .filter(db.AirQualityObs.site_key == site_key)
            .order_by(db.AirQualityObs.ts.desc())
            .first()
        )
        if row is None:
            return None
        return {
            "ts": row.ts.isoformat() if row.ts else None,
            "aqi": row.aqi,
            "pm25": row.pm25,
            "pm10": row.pm10,
            "o3": row.o3,
            "no2": row.no2,
            "station_name": row.station_name,
            "station_distance_km": row.distance_km,
            "quality": row.quality,
            "source": row.source,
        }
    finally:
        session.close()


def get_forecast(site_key: str, hours: int = 48) -> dict:
    """Generate a multi-hour forecast for a site.

    READ-ONLY — does not create alerts or write anything.
    Use POST /api/v1/alerts/run to trigger alert evaluation.
    """
    site = get_site(site_key)
    if site is None:
        raise ValueError(f"Unknown site: {site_key}. Valid: {site_keys()}")

    bundle = load_best()
    model_type_str = get_model_type(bundle)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    horizon = min(hours, 48)
    target_tses = [now + timedelta(hours=h) for h in range(horizon)]

    # Batched feature fetch — one DB roundtrip per table instead of 96.
    try:
        feat_df = build_features_for_window(site_key, target_tses)
    except Exception as exc:
        logger.warning("Batched feature fetch failed (%s) — falling back per-hour", exc)
        feat_df = None

    forecast_hours = []
    for h, target_ts in enumerate(target_tses):
        try:
            if feat_df is not None and len(feat_df) == horizon:
                feat_dict = features_dict_from_row(feat_df.iloc[h].values)
            else:
                one_df = build_features(site_key, target_ts)
                feat_dict = features_dict_from_row(one_df.values[0])
            viz, current = score_hour(feat_dict)
            rl = risk_label(viz, current)
            p_bad = predict(bundle, site_key, target_ts)
        except Exception:
            viz, current, rl, p_bad = "Unknown", "Unknown", "Unknown", 0.5

        forecast_hours.append({
            "ts": target_ts.isoformat(),
            "risk": rl,
            "p_bad": round(p_bad, 3),
            "viz_label": viz,
            "current_risk": current,
            "model_used": model_type_str,
        })

    # Highlight the optimal window: the hour with the lowest p_bad.
    optimal = min(forecast_hours, key=lambda x: x["p_bad"])

    # Optional air-quality block — present only when AQICN has populated
    # the air_quality_obs table for this site. Optional so deployments
    # without AQICN_API_KEY still get a clean forecast response.
    air = _latest_air_snapshot(site_key)

    out = {
        "site_key": site_key,
        "site_name": site["name"],
        "generated_at": now.isoformat(),
        "hours": forecast_hours,
        "optimal_window": optimal,
    }
    if air is not None:
        out["air"] = air
    return out


def submit_verification(data: dict) -> dict:
    """Process an operator verification submission."""
    site = get_site(data["site_key"])
    if site is None:
        raise ValueError(f"Unknown site: {data['site_key']}")

    session = db.SessionLocal()
    try:
        # Save to operator_verifications
        verification = db.OperatorVerification(
            site_key=data["site_key"],
            operator=data.get("operator"),
            date=data["date"],
            verdict=data["verdict"],
            actual_viz_m=data.get("actual_viz_m"),
            actual_current=data.get("actual_current"),
            comments=data.get("comments"),
        )
        session.add(verification)

        # Also add to no_dive_labels for training
        label = db.NoDiveLabel(
            site_key=data["site_key"],
            date=data["date"],
            label=data["verdict"],
            source=f"operator_{data.get('operator', 'anon')}",
            actual_viz_m=data.get("actual_viz_m"),
            actual_current=data.get("actual_current"),
            comments=data.get("comments"),
        )
        session.add(label)
        session.commit()

        return {
            "id": verification.id,
            "site_key": data["site_key"],
            "date": str(data["date"]),
            "verdict": data["verdict"],
            "message": "Verification saved. Thank you!",
        }
    except Exception as exc:
        session.rollback()
        raise
    finally:
        session.close()


def get_labels(site_key: str, limit: int = 50) -> dict:
    """Fetch recent labels for a site."""
    session = db.SessionLocal()
    try:
        query = session.query(db.NoDiveLabel)
        if site_key != "all":
            query = query.filter(db.NoDiveLabel.site_key == site_key)

        labels = (
            query
            .order_by(db.NoDiveLabel.date.desc())
            .limit(limit)
            .all()
        )

        return {
            "site_key": site_key,
            "total": len(labels),
            "labels": [
                {
                    "date": lbl.date.isoformat(),
                    "label": lbl.label,
                    "source": lbl.source,
                    "actual_viz_m": lbl.actual_viz_m,
                    "actual_current": lbl.actual_current,
                    "comments": lbl.comments,
                }
                for lbl in labels
            ],
        }
    finally:
        session.close()
