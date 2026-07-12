"""
FastAPI application — all routes for SeaSID.

Endpoints:
  GET  /api/v1/health              — Health check
  GET  /api/v1/sites               — List sites
  GET  /api/v1/forecast?site=<key> — 48h forecast (read-only)
  POST /api/v1/ingest              — Pull weather+tide data
  POST /api/v1/verify              — Operator verification
  GET  /api/v1/labels?site=<key>   — Label history
  GET  /api/v1/alerts?site=<key>   — Recent alerts
  POST /api/v1/alerts/run          — Trigger alert evaluation (write-side)
  POST /api/v1/agent/chat          — Agent conversation
  GET  /api/v1/agent/briefing      — Auto-generated briefing
  GET  /api/v1/experiments/results — Experiment results
  POST /api/v1/experiments/run     — Trigger experiment suite + reload model
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.api.schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AlertsResponse,
    AlertsRunResponse,
    BriefingResponse,
    ExperimentResultsResponse,
    ExperimentRunResponse,
    ForecastResponse,
    HealthResponse,
    IngestRequest,
    IngestResponse,
    LabelsResponse,
    OptimalWindow,
    SiteInfo,
    VerifyRequest,
    VerifyResponse,
)
from app.api.services import get_forecast, submit_verification, get_labels
from app.lib.db import init_db
from app.lib.sites import get_all_sites, site_keys

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# Explicit allow-list — wildcard CORS was removed in v2.
# Override via SEASID_ALLOWED_ORIGINS env var (comma-separated).
import os as _os
_DEFAULT_ORIGINS = (
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
    "http://localhost:5176,http://localhost:5177,http://localhost:5178,"
    "http://localhost:3000,http://localhost:8000,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,"
    "http://127.0.0.1:5176,http://127.0.0.1:5177,http://127.0.0.1:5178,"
    "http://127.0.0.1:3000,http://127.0.0.1:8000"
)
ALLOWED_ORIGINS = [
    o.strip() for o in _os.getenv("SEASID_ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup (FastAPI lifespan replaces on_event)."""
    init_db()
    logger.info("SeaSID API started (allowed origins: %s)", ALLOWED_ORIGINS)
    yield
    logger.info("SeaSID API shutting down")


# ── App setup ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="SeaSID API",
    description="Sea Safety Intelligence Dashboard — dive condition forecasting for Dauin & Apo Island",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Chrome's CORS-RFC1918 (Private Network Access) preflight
    # demands `Access-Control-Allow-Private-Network: true` when a
    # public/external origin reaches a server on a private network.
    # Localhost → localhost is normally exempt, but a stricter
    # browser policy (or a tab in PNA-enforcing mode) can still
    # block it. Set the flag so the preflight passes either way.
    allow_private_network=True,
)


# ── Health ─────────────────────────────────────────────────────────────────

@app.get("/api/v1/health", response_model=HealthResponse)
def health():
    """Health check endpoint."""
    from app.lib.model import load_best, get_model_type
    from app.lib.db import Base, engine
    from app.lib.providers import active_providers
    from sqlalchemy import inspect

    bundle = load_best()
    model_type = get_model_type(bundle)

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    # Surface which providers are active so the Settings page can show
    # operators what's live without round-tripping the registry itself.
    providers = {
        role: info.name
        for role, info in active_providers().items()
    }

    return HealthResponse(
        status="ok",
        version="1.0.0",
        model_loaded=model_type,
        db_tables=len(tables),
        providers=providers,
    )


# ── Sites ──────────────────────────────────────────────────────────────────

@app.get("/api/v1/sites", response_model=list[SiteInfo])
def list_sites():
    """List all registered dive sites."""
    sites = get_all_sites()
    return [SiteInfo(**s) for s in sites]


# ── Forecast ───────────────────────────────────────────────────────────────

@app.get("/api/v1/forecast", response_model=ForecastResponse)
def forecast(site: str = Query(..., description="Site key")):
    """Get 48-hour forecast for a dive site (read-only, no side effects)."""
    if site not in site_keys():
        raise HTTPException(status_code=404, detail=f"Unknown site: {site}. Valid: {site_keys()}")

    try:
        result = get_forecast(site)
        # Re-shape to include the typed OptimalWindow block.
        opt = result.get("optimal_window")
        optimal = OptimalWindow(
            ts=opt["ts"],
            viz_label=opt["viz_label"],
            current_risk=opt["current_risk"],
            p_bad=opt["p_bad"],
        ) if opt else None
        return ForecastResponse(
            site_key=result["site_key"],
            site_name=result["site_name"],
            generated_at=result["generated_at"],
            hours=result["hours"],
            optimal_window=optimal,
            ml_bundle_loaded=bool(result.get("ml_bundle_loaded", True)),
            air=result.get("air"),
            # Roadmap #8 freshness + provenance
            data_as_of=result.get("data_as_of"),
            freshness=result.get("freshness", []),
            model_version=result.get("model_version", "unknown"),
            providers=result.get("providers", {}),
            degraded=result.get("degraded", []),
        )
    except Exception as exc:
        logger.error("Forecast error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Ingest ─────────────────────────────────────────────────────────────────

@app.post("/api/v1/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest):
    """Pull weather + tide data for a site."""
    from app.lib.ingest import ingest_site

    if request.site_key not in site_keys():
        raise HTTPException(status_code=404, detail=f"Unknown site: {request.site_key}")

    try:
        result = ingest_site(request.site_key, hours=request.hours)
        return IngestResponse(site_key=request.site_key, **result)
    except Exception as exc:
        logger.error("Ingest error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Verify ─────────────────────────────────────────────────────────────────

@app.post("/api/v1/verify", response_model=VerifyResponse)
def verify(request: VerifyRequest):
    """Submit operator verification of dive conditions."""
    try:
        result = submit_verification(request.model_dump())
        return VerifyResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Verify error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Labels ─────────────────────────────────────────────────────────────────

@app.get("/api/v1/labels", response_model=LabelsResponse)
def labels(
    site: str = Query(default="all", description="Site key or 'all'"),
    limit: int = Query(default=50, ge=1, le=200),
):
    """Fetch recent labels for a site."""
    try:
        result = get_labels(site, limit=limit)
        return LabelsResponse(**result)
    except Exception as exc:
        logger.error("Labels error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Alerts ─────────────────────────────────────────────────────────────────

@app.get("/api/v1/alerts", response_model=AlertsResponse)
def alerts(
    site: str = Query(default=None, description="Site key (optional)"),
    hours: int = Query(default=24, ge=1, le=168),
):
    """Get recent alerts (read-only)."""
    from app.lib.alerts import get_recent_alerts

    try:
        result = get_recent_alerts(site_key=site, hours=hours)
        return AlertsResponse(alerts=result)
    except Exception as exc:
        logger.error("Alerts error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/alerts/run", response_model=AlertsRunResponse)
def alerts_run():
    """Explicit write-side endpoint to trigger alert evaluation for all sites.

    Idempotent — AlertStore dedupes via the (site_key, kind, ts_hour) unique constraint.
    """
    from app.lib.alerts import check_all_sites

    try:
        new_alerts = check_all_sites()
        return AlertsRunResponse(
            status="success",
            site_results=[
                {"site_key": a["site_key"], "kind": a["kind"], "message": a["message"]}
                for a in new_alerts
            ],
            total_created=len(new_alerts),
        )
    except Exception as exc:
        logger.error("Alerts run error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Agent ──────────────────────────────────────────────────────────────────

@app.post("/api/v1/agent/chat", response_model=AgentChatResponse)
async def agent_chat(request: AgentChatRequest):
    """Chat with the SeaSID AI agent."""
    from app.lib.agent import chat

    try:
        result = await chat(
            user_message=request.message,
            conversation_id=request.conversation_id,
            site_key=request.site_key,
        )
        return AgentChatResponse(**result)
    except Exception as exc:
        logger.error("Agent chat error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/agent/chat/stream")
async def agent_chat_stream(request: AgentChatRequest):
    """Streaming variant — Server-Sent Events of {type, ...} events.

    Event types (see `app.lib.agent.chat_stream` for the source of truth):
      - {type: "status",      conversation_id: str}
      - {type: "text",        delta: str}
      - {type: "tool_call",   id, name, arguments}
      - {type: "tool_result", id, name, output, durationMs}
      - {type: "usage",       promptTokens, completionTokens}
      - {type: "done",        finishReason, tool_calls}
      - {type: "error",       message}
    """
    from app.lib.agent import chat_stream

    async def event_generator():
        async for event in chat_stream(
            user_message=request.message,
            conversation_id=request.conversation_id,
            site_key=request.site_key,
        ):
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering
            "Connection": "keep-alive",
        },
    )


@app.get("/api/v1/agent/briefing", response_model=BriefingResponse)
async def agent_briefing(site: str = Query(..., description="Site key")):
    """Generate an AI dive briefing for a site."""
    from app.lib.agent import generate_briefing

    if site not in site_keys():
        raise HTTPException(status_code=404, detail=f"Unknown site: {site}")

    try:
        result = await generate_briefing(site)
        return BriefingResponse(**result)
    except Exception as exc:
        logger.error("Briefing error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Experiments ────────────────────────────────────────────────────────────

@app.get("/api/v1/experiments/results", response_model=ExperimentResultsResponse)
def experiment_results():
    """Get the latest experiment results."""
    results_path = DATA_DIR / "experiment_results.json"

    if not results_path.exists():
        return ExperimentResultsResponse(
            timestamp=None,
            dataset=None,
            model_comparison=None,
            ablations=None,
            best_model=None,
        )

    try:
        with open(results_path) as f:
            data = json.load(f)
        return ExperimentResultsResponse(**data)
    except Exception as exc:
        logger.error("Experiment results error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/experiments/run", response_model=ExperimentRunResponse)
def run_experiments():
    """Trigger the experiment suite (may take several minutes)."""
    try:
        from datetime import date, datetime, timezone
        import numpy as np
        import pandas as pd

        from app.lib import db as _db_lib
        from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence
        from app.lib.scoring import label_to_binary
        from app.lib.experiments import run_full_experiment_suite

        db = _db_lib.SessionLocal()
        try:
            labels = db.query(_db_lib.NoDiveLabel).all()
        finally:
            db.close()

        if not labels:
            return ExperimentRunResponse(
                status="error",
                message="No labels in database. Run seed_history.py first.",
                results=None,
            )

        X_rows, y_vals, X_seqs = [], [], []
        label_dates: list[date] = []
        label_site_keys: list[str] = []
        for lbl in labels:
            target_ts = datetime(
                lbl.date.year, lbl.date.month, lbl.date.day,
                12, 0, 0, tzinfo=timezone.utc,
            )
            try:
                feat_df = build_features(lbl.site_key, target_ts)
                X_rows.append(feat_df.values[0])
                seq = build_sequence(lbl.site_key, target_ts, window_hours=24)
                X_seqs.append(seq)
                y_vals.append(label_to_binary(lbl.label))
                label_dates.append(lbl.date)
                label_site_keys.append(lbl.site_key)
            except Exception:
                continue

        X_flat = pd.DataFrame(X_rows, columns=FEATURE_COLUMNS)
        y = pd.Series(y_vals, name="label")
        X_seq = np.array(X_seqs, dtype=np.float32)
        y_arr = np.array(y_vals, dtype=np.float32)

        results = run_full_experiment_suite(
            X_flat, y, X_seq, y_arr,
            label_dates=label_dates,
            label_site_keys=label_site_keys,
        )

        # Reload the cached ML bundle so the next /forecast hits fresh weights.
        try:
            from app.lib.model import reload as model_reload
            model_reload()
            logger.info("Model reloaded after experiments.run")
        except Exception as exc:
            logger.warning("Model reload failed after experiments.run: %s", exc)

        return ExperimentRunResponse(
            status="success",
            message=f"Experiments complete. Best model: {results.get('best_model', 'unknown')}",
            results=results,
        )
    except Exception as exc:
        logger.error("Experiment run error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
