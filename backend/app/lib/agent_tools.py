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
from typing import Any

from app.lib.sites import get_site, get_all_sites, site_keys
from app.lib.features import build_features
from app.lib.scoring import score_hour, risk_label, features_dict_from_row

logger = logging.getLogger(__name__)


# ── Tool handlers ──────────────────────────────────────────────────────────


def _require_site_key(args: dict, tool_name: str) -> tuple[str | None, str | None]:
    """Validate and return ``(site_key, error_json)``.

    Returns ``(site_key, None)`` on success, or ``(None, error_json)`` when
    the argument is missing, the wrong type, or doesn't match a known
    site. Every site-keyed handler funnels through this so the LLM gets
    a single, unambiguous error message instead of seeing "Unknown site:
    None" and concluding the site name is the problem.

    The error is JSON (so the model can read it as a tool result), with
    a clear ``error_code`` so deterministic tests can assert against it.
    """
    if not isinstance(args, dict):
        return None, json.dumps({
            "error": f"{tool_name} requires an object argument with `site_key`.",
            "error_code": "missing_site_key",
            "valid_sites": list(site_keys()),
        })
    raw = args.get("site_key")
    if raw is None or raw == "":
        return None, json.dumps({
            "error": (
                f"{tool_name} requires `site_key`. Pass one of: "
                f"{', '.join(site_keys())}."
            ),
            "error_code": "missing_site_key",
            "valid_sites": list(site_keys()),
        })
    site_key = str(raw).strip()
    if not site_key:
        return None, json.dumps({
            "error": (
                f"{tool_name} requires `site_key`. Pass one of: "
                f"{', '.join(site_keys())}."
            ),
            "error_code": "missing_site_key",
            "valid_sites": list(site_keys()),
        })
    if get_site(site_key) is None:
        return None, json.dumps({
            "error": (
                f"Unknown site_key '{site_key}'. Valid sites: "
                f"{', '.join(site_keys())}."
            ),
            "error_code": "unknown_site",
            "valid_sites": list(site_keys()),
        })
    return site_key, None


def _site_key_only(handler, tool_name, extra_args_fn=None):
    """Wrap a ``(site_key: str) -> str`` handler with site-key validation.

    The agent loop calls every handler as ``handler(args_dict)``; this
    wrapper unpacks ``site_key`` from the dict (or returns a clear
    error) before delegating to the legacy single-arg handler. Tests
    that still call ``get_forecast_handler("dauin_muck")`` directly
    continue to work because the wrapper also accepts a string.

    ``extra_args_fn`` is an optional callback that takes the raw
    ``args`` dict and returns the trailing positional arguments after
    ``site_key``. Used for ``get_history`` which also takes a ``days``
    integer.
    """

    def _wrapped(args):
        # Direct-string call (legacy / test path): pass through.
        if isinstance(args, str):
            return handler(args)
        site_key, err = _require_site_key(args or {}, tool_name)
        if err is not None:
            return err
        if extra_args_fn is not None:
            return handler(site_key, *extra_args_fn(args or {}))
        return handler(site_key)

    return _wrapped


def _history_days_arg(args: dict) -> tuple[int]:
    """Extract the optional ``days`` arg for ``get_history``.

    Clamps to the 1–30 range the underlying handler accepts, and falls
    back to 7 when the value is missing or invalid. Wrapping the
    coercion here keeps the LLM-facing error surface small: an
    out-of-range days value just defaults to 7 instead of crashing.
    """
    raw = (args or {}).get("days")
    try:
        days = int(raw) if raw is not None else 7
    except (TypeError, ValueError):
        days = 7
    return (max(1, min(days, 30)),)


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
                    "Add an AQICN key in Settings and run ingest, or enable "
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


# NOTE: this redefines the get_air_quality_handler defined earlier in this file.
# This later definition is the one bound in TOOL_HANDLERS below; the two
# implementations have diverged (their JSON response schemas differ), so
# consolidating them is a behavior decision tracked separately. The noqa keeps
# the lint gate green without silently choosing a winner here.
def get_air_quality_handler(site_key: str) -> str:  # noqa: F811
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
                "hint": "No air-quality data yet. Add an AQICN key in Settings and re-run ingest_site.",
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

# Map function names to handlers. Every site-keyed handler is wrapped
# in ``_site_key_only`` so the LLM gets a structured, unambiguous
# error message when it forgets to pass ``site_key`` (instead of the
# old "Unknown site: None" response that sent the model into a loop
# of empty retries). ``list_sites`` and ``get_model_info`` take no
# arguments and need no validation.
TOOL_HANDLERS = {
    "get_forecast": _site_key_only(get_forecast_handler, "get_forecast"),
    "get_weather": _site_key_only(get_weather_handler, "get_weather"),
    "list_sites": lambda args: list_sites_handler(),
    "get_model_info": lambda args: get_model_info_handler(),
    "get_history": _site_key_only(
        get_history_handler, "get_history", extra_args_fn=_history_days_arg
    ),
    "check_alerts": _site_key_only(check_alerts_handler, "check_alerts"),
    "get_air_quality": _site_key_only(get_air_quality_handler, "get_air_quality"),
}


# ── Live MCP tool merging ─────────────────────────────────────────────────
#
# The MiniMax web-search MCP exposes `web_search` and `web_browse` (and any
# future tools the upstream MCP adds). We inject them into the OpenAI
# function-calling list lazily, once per agent call, by reading whatever
# tools the subprocess advertised during `tools/list`. The agent loop calls
# :func:`get_active_tool_definitions` to assemble the list it sends to the
# model. Handlers for the MCP-backed tools dispatch to
# :func:`app.lib.agent_mcp.call_mcp_tool`, which talks JSON-RPC to the
# subprocess. The function signatures match the upstream tool list so the
# schemas the model sees stay valid across MCP upgrades.
#
# We wrap the merge in a thread lock so a burst of agent calls doesn't
# each boot the subprocess.

from threading import Lock as _ThreadLock  # noqa: E402

_mcp_merge_lock = _ThreadLock()
_mcp_tools_cache: list[dict] | None = None
_mcp_tool_names: set[str] = set()


def _static_tool_definitions() -> list[dict]:
    """Return the built-in tool definitions (no MCP)."""
    return list(TOOL_DEFINITIONS)


async def get_active_tool_definitions() -> tuple[list[dict], dict[str, Any]]:
    """Return ``(tool_definitions, handlers)`` including the live MCP tools.

    ``handlers`` maps tool name -> async callable. Built-in handlers stay
    synchronous; the merge wraps them in coroutine shims so the agent
    loop can ``await`` every handler uniformly.
    """
    from app.lib import agent_mcp

    # Snapshot the static set up front — never mutate TOOL_DEFINITIONS.
    definitions = _static_tool_definitions()
    handlers: dict[str, Any] = {
        "get_forecast": _to_async(_site_key_only(get_forecast_handler, "get_forecast")),
        "get_weather": _to_async(_site_key_only(get_weather_handler, "get_weather")),
        "list_sites": _to_async(list_sites_handler),
        "get_model_info": _to_async(get_model_info_handler),
        "get_history": _to_async(
            _site_key_only(
                get_history_handler, "get_history", extra_args_fn=_history_days_arg
            )
        ),
        "check_alerts": _to_async(_site_key_only(check_alerts_handler, "check_alerts")),
        "get_air_quality": _to_async(
            _site_key_only(get_air_quality_handler, "get_air_quality")
        ),
    }

    mcp_tools: list = []
    try:
        mcp_tools = await agent_mcp.get_mcp_tools()
    except Exception as exc:
        logger.debug("MCP tool discovery skipped: %s", exc)
        mcp_tools = []

    for tool in mcp_tools:
        if not tool.name or tool.name in handlers:
            # Don't let an MCP tool shadow a built-in; first writer wins.
            continue
        definitions.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or f"MCP tool: {tool.name}",
                "parameters": tool.input_schema or {"type": "object", "properties": {}},
            },
        })
        handlers[tool.name] = _make_mcp_handler(tool.name)

    return definitions, handlers


def _to_async(sync_handler):
    """Wrap a sync tool handler as an async coroutine for uniform awaiting."""

    async def _wrapper(args: dict) -> str:
        return sync_handler(args)

    return _wrapper


def _make_mcp_handler(tool_name: str):
    """Return an async handler that dispatches ``tool_name`` to the MCP."""

    async def _handler(args: dict) -> str:
        from app.lib import agent_mcp

        return await agent_mcp.call_mcp_tool(tool_name, args or {})

    return _handler

