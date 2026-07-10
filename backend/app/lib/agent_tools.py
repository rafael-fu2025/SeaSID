"""
Agent tool definitions for function-calling with OpenAI.

Each tool is a dict with:
  - name: function name
  - description: what the tool does
  - parameters: JSON Schema for inputs
  - handler: the actual function to call
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.lib.sites import get_site, get_all_sites, site_keys
from app.lib.features import build_features, FEATURE_COLUMNS
from app.lib.scoring import score_hour, risk_label, features_dict_from_row

logger = logging.getLogger(__name__)


# ── Tool handlers ──────────────────────────────────────────────────────────

def get_forecast_handler(site_key: str) -> str:
    """Get the current forecast and risk assessment for a dive site."""
    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    now = datetime.now(timezone.utc)

    try:
        feat_df = build_features(site_key, now)
        feat_dict = features_dict_from_row(feat_df.values[0])

        viz, current = score_hour(feat_dict)
        rl = risk_label(viz, current)

        # Try to get ML prediction
        try:
            from app.lib.model import load_best, predict
            bundle = load_best()
            p_bad = predict(bundle, site_key, now)
            model_type = bundle.get("model_type", "rule_based") if bundle else "rule_based"
        except Exception:
            from app.lib.scoring import p_bad_from_rules
            p_bad = p_bad_from_rules(feat_dict)
            model_type = "rule_based"

        result = {
            "site": site["name"],
            "site_key": site_key,
            "timestamp": now.isoformat(),
            "visibility_forecast": viz,
            "current_risk": current,
            "overall_risk": rl,
            "p_no_go": round(p_bad, 3),
            "model_used": model_type,
            "features": {
                "precip_24h_mm": round(feat_dict["precip_24h_mm"], 1),
                "wind_max_24h_kmh": round(feat_dict["wind_max_24h_kmh"], 1),
                "wave_max_24h_m": round(feat_dict["wave_max_24h_m"], 2),
                "sea_temp_c": round(feat_dict["sea_temp_mean_24h"], 1),
                "tide_range_m": round(feat_dict["tide_range_24h_m"], 2),
            },
        }
        return json.dumps(result)

    except Exception as exc:
        logger.error("get_forecast failed: %s", exc)
        return json.dumps({"error": str(exc)})


def get_weather_handler(site_key: str) -> str:
    """Get detailed weather data for a dive site."""
    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    now = datetime.now(timezone.utc)
    feat_df = build_features(site_key, now)
    feat_dict = features_dict_from_row(feat_df.values[0])

    result = {
        "site": site["name"],
        "timestamp": now.isoformat(),
        "weather": {
            "precipitation_24h_mm": round(feat_dict["precip_24h_mm"], 1),
            "precipitation_48h_mm": round(feat_dict["precip_48h_mm"], 1),
            "precipitation_recent_3h_mm": round(feat_dict["precip_recent_3h"], 1),
            "wind_max_kmh": round(feat_dict["wind_max_24h_kmh"], 1),
            "wind_mean_kmh": round(feat_dict["wind_mean_24h_kmh"], 1),
            "wave_max_m": round(feat_dict["wave_max_24h_m"], 2),
            "sea_temp_c": round(feat_dict["sea_temp_mean_24h"], 1),
            # Extensions (v2.1)
            "aqi_recent": round(feat_dict["aqi_recent"], 1),
            "pm25_recent": round(feat_dict["pm25_recent"], 1),
            "wave_period_s_mean": round(feat_dict["wave_period_s_mean"], 1),
        },
        "tides": {
            "max_m": round(feat_dict["tide_max_24h_m"], 2),
            "min_m": round(feat_dict["tide_min_24h_m"], 2),
            "range_m": round(feat_dict["tide_range_24h_m"], 2),
        },
    }
    return json.dumps(result)


def get_air_quality_handler(site_key: str) -> str:
    """Get the most recent air-quality snapshot for a site.

    Returns AQI, PM2.5, PM10, O₃, NO₂ plus the station name, distance from the
    site, and a quality bucket so callers can decide whether the data is
    locally meaningful or merely a regional background estimate.

    Returns an informative error if no air-quality data has been ingested or if
    the site is in the per-site opt-out list (sites.py:air_provider_disabled).
    """
    from app.lib import db

    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    # Per-site opt-out: the site registry can disable air-quality fetching for
    # remote sites where the nearest station is too far to be useful.
    if site.get("air_provider_disabled"):
        return json.dumps({
            "site": site["name"],
            "available": False,
            "reason": "disabled_for_site",
            "message": (
                "Air-quality data is disabled for this site in sites.py. "
                "Edit app/lib/sites.py to re-enable."
            ),
        })

    session = db.SessionLocal()
    try:
        row = (
            session.query(db.AirQualityObs)
            .filter(db.AirQualityObs.site_key == site_key)
            .order_by(db.AirQualityObs.ts.desc())
            .first()
        )
        if row is None:
            return json.dumps({
                "site": site["name"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "available": False,
                "message": (
                    "No air-quality data has been ingested yet. "
                    "Set AQICN_API_KEY and run ingest, or enable "
                    "SEASID_PROVIDER_AIR=aqicn."
                ),
            })

        # Build a warning when the station is far away. AQICN's free tier
        # returns the nearest global station, which can be hundreds of km
        # away for remote coastal sites like Dauin / Apo Island.
        distance_km = row.distance_km
        quality = row.quality or "unknown"
        warning = None
        if distance_km is not None:
            if quality == "very_distant":
                warning = (
                    f"Station is {distance_km:.0f} km from the site — treat as "
                    "regional background only; local haze or smoke is not "
                    "represented."
                )
            elif quality == "distant":
                warning = (
                    f"Station is {distance_km:.0f} km from the site — use with "
                    "caution for local visibility/haze decisions."
                )

        return json.dumps({
            "site": site["name"],
            "timestamp": row.ts.isoformat() if row.ts else None,
            "available": True,
            "aqi": row.aqi,
            "pm25": row.pm25,
            "pm10": row.pm10,
            "o3": row.o3,
            "no2": row.no2,
            "station_id": row.station_id,
            "station_name": row.station_name,
            "distance_km": distance_km,
            "quality": quality,
            "warning": warning,
            "source": row.source,
        })
    finally:
        session.close()


def list_sites_handler() -> str:
    """List all available dive sites."""
    sites = get_all_sites()
    result = [
        {
            "key": s["key"],
            "name": s["name"],
            "type": s["type"],
            "lat": s["lat"],
            "lon": s["lon"],
            "description": s["description"],
        }
        for s in sites
    ]
    return json.dumps(result)


def get_model_info_handler() -> str:
    """Get information about the currently loaded prediction model."""
    try:
        from app.lib.model import load_best, get_model_type, get_feature_importance

        bundle = load_best()
        model_type = get_model_type(bundle)

        info = {
            "model_type": model_type,
            "status": "loaded" if bundle else "not_loaded",
        }

        if bundle:
            info["n_training_samples"] = bundle.get("n_samples", "unknown")

            # Feature importance (XGBoost only)
            imp = get_feature_importance(bundle)
            if imp is not None:
                info["top_features"] = imp.head(5).to_dict(orient="records")

        return json.dumps(info)

    except Exception as exc:
        return json.dumps({"error": str(exc)})


def get_history_handler(site_key: str, days: int = 7) -> str:
    """Get recent label history for a site."""
    from app.lib import db
    from datetime import timedelta, date as date_type

    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    cutoff = date_type.today() - timedelta(days=days)

    session = db.SessionLocal()
    try:
        labels = (
            session.query(db.NoDiveLabel)
            .filter(db.NoDiveLabel.site_key == site_key)
            .filter(db.NoDiveLabel.date >= cutoff)
            .order_by(db.NoDiveLabel.date.desc())
            .limit(20)
            .all()
        )

        result = {
            "site": site["name"],
            "days": days,
            "history": [
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
        return json.dumps(result)
    finally:
        session.close()


def check_alerts_handler(site_key: str) -> str:
    """Check recent alerts for a site."""
    from app.lib import db
    from datetime import timedelta

    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    session = db.SessionLocal()
    try:
        alerts = (
            session.query(db.Alert)
            .filter(db.Alert.site_key == site_key)
            .filter(db.Alert.sent_at >= cutoff)
            .order_by(db.Alert.sent_at.desc())
            .limit(10)
            .all()
        )

        result = {
            "site": site["name"],
            "recent_alerts": [
                {
                    "kind": a.kind,
                    "message": a.message,
                    "sent_at": a.sent_at.isoformat() if a.sent_at else None,
                    "channel": a.channel,
                }
                for a in alerts
            ],
        }
        return json.dumps(result)
    finally:
        session.close()


def get_air_quality_handler(site_key: str) -> str:
    """Return the latest air-quality snapshot for a site, if available.

    Pulls from the `air_quality_obs` table that the AQICN provider
    populates during ingest. Returns a structured JSON object:

      {
        "site": "Dauin Muck Bays",
        "ts": "2026-07-09T12:00:00+00:00",
        "aqi": 42,
        "pm25": 9.3, "pm10": 14.0, "o3": 28.0, "no2": 5.0,
        "station_name": "Dumaguete Station",
        "station_distance_km": 17.4,
        "quality": "local",
        "source": "aqicn"
      }

    If no AQICN snapshot exists for the site (provider disabled, no
    key, or station unreachable), returns `{"available": false, ...}`
    with a `reason` describing why.
    """
    from app.lib import db

    site = get_site(site_key)
    if site is None:
        return json.dumps({"error": f"Unknown site: {site_key}. Valid: {site_keys()}"})

    # Honour per-site opt-out (set in sites.py when the nearest AQICN
    # station is > 500 km away — the free tier would return meaningless
    # "distant" data we don't want to surface to operators).
    if site.get("air_provider_disabled"):
        return json.dumps({
            "site": site["name"],
            "available": False,
            "reason": "disabled_for_site",
            "hint": "Air-quality ingestion is disabled for this site (nearest AQICN station is too far for the free tier).",
            "source": None,
        })

    session = db.SessionLocal()
    try:
        row = (
            session.query(db.AirQualityObs)
            .filter(db.AirQualityObs.site_key == site_key)
            .order_by(db.AirQualityObs.ts.desc())
            .first()
        )
        if row is None:
            return json.dumps({
                "site": site["name"],
                "available": False,
                "reason": "no_snapshot",
                "hint": "No air-quality data yet. Configure AQICN_API_KEY and re-run ingest_site to enable.",
                "source": None,
            })
        return json.dumps({
            "site": site["name"],
            "available": True,
            "ts": row.ts.isoformat() if row.ts else None,
            "aqi": row.aqi,
            "pm25": row.pm25,
            "pm10": row.pm10,
            "o3": row.o3,
            "no2": row.no2,
            "station_id": row.station_id,
            "station_name": row.station_name,
            "station_distance_km": row.distance_km,
            "quality": row.quality,
            "source": row.source,
        })
    finally:
        session.close()


# ── Tool registry ─────────────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_forecast",
            "description": "Get the current dive condition forecast and risk assessment for a specific site. Returns visibility forecast, current risk, overall risk level, and the probability of a no-go day.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {
                        "type": "string",
                        "description": "The site identifier. Use list_sites to discover valid keys.",
                    }
                },
                "required": ["site_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get detailed weather data for a dive site including precipitation, wind, waves, sea temperature, tides, air quality (AQI, PM2.5), and mean wave period.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {
                        "type": "string",
                        "description": "The site identifier.",
                    }
                },
                "required": ["site_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_sites",
            "description": "List all available dive sites with their names, types, coordinates, and descriptions.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_model_info",
            "description": "Get information about the currently loaded prediction model, including type, training samples, and feature importance.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_history",
            "description": "Get recent dive condition history (labels) for a site. Shows past visibility and current conditions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {
                        "type": "string",
                        "description": "The site identifier.",
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days of history to retrieve (default: 7, max: 30).",
                        "default": 7,
                    },
                },
                "required": ["site_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_alerts",
            "description": "Check recent alerts (last 24 hours) for a dive site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {
                        "type": "string",
                        "description": "The site identifier.",
                    }
                },
                "required": ["site_key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_air_quality",
            "description": "Return the most recent air-quality snapshot for a site (AQI, PM2.5, PM10, O3, NO2) sourced from AQICN. Use this when the user asks about air quality, smoke, haze, or pollution for sensitive divers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {
                        "type": "string",
                        "description": "The site identifier.",
                    }
                },
                "required": ["site_key"],
            },
        },
    },
]

# Map function names to handlers
TOOL_HANDLERS = {
    "get_forecast": lambda args: get_forecast_handler(args["site_key"]),
    "get_weather": lambda args: get_weather_handler(args["site_key"]),
    "list_sites": lambda args: list_sites_handler(),
    "get_model_info": lambda args: get_model_info_handler(),
    "get_history": lambda args: get_history_handler(args["site_key"], args.get("days", 7)),
    "check_alerts": lambda args: check_alerts_handler(args["site_key"]),
    "get_air_quality": lambda args: get_air_quality_handler(args["site_key"]),
}
