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
  POST /api/v1/experiments/run/stream — SSE variant of /run with live progress
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.api.schemas import (
    ActiveLearningResponse,
    ActiveLearningSummaryResponse,
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
    LoginRequest,
    PasswordChange,
    TokenResponse,
    UserInfo,
    VerifyRequest,
    VerifyResponse,
)
from app.api.services import get_forecast, submit_verification, get_labels
from app.lib.db import init_db
from app.lib.sites import get_all_sites, site_keys
from app.auth import (
    Principal,
    authenticate_user,
    auth_enabled,
    create_access_token,
    ensure_role,
    ensure_site_access,
    get_current_principal,
)
from app.api.admin import router as admin_router
from app.lib.user_store import change_password as db_change_password

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

# Explicit allow-list — wildcard CORS was removed in v2.
# Override via SEASID_ALLOWED_ORIGINS env var (comma-separated).
import os as _os  # noqa: E402
_DEFAULT_ORIGINS = (
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
    "http://localhost:5176,http://localhost:5177,http://localhost:5178,"
    "http://localhost:3000,http://localhost:8000,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,"
    "http://127.0.0.1:5176,http://127.0.0.1:5177,http://127.0.0.1:5178,"
    "http://127.0.0.1:3000,http://127.0.0.1:8000,"
    # cloudflared quick-tunnel hostnames (regenerated on each run; allow
    # all trycloudflare.com subdomains so dev tunnels work out of the box).
    "https://feature-combine-increases-evolution.trycloudflare.com,"
    "https://uniprotkb-area-oriental-ben.trycloudflare.com,"
    "https://*.trycloudflare.com"
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
app.include_router(admin_router)


# ── Auth ───────────────────────────────────────────────────────────────────
@app.post("/api/v1/auth/login", response_model=TokenResponse)
def login(request: LoginRequest):
    """Authenticate and return a JWT bearer token + the user profile.

    When authentication is disabled, returns a synthetic admin token so the
    UI keeps working in local dev. When enabled, looks up users in the DB
    with a fallback to env-configured and dev-default credentials.
    """
    if not auth_enabled():
        principal = Principal("dev", "dev", "admin", ("*",), authenticated=False)
    else:
        principal = authenticate_user(request.username, request.password)
        if principal is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")
    token, expires_in = create_access_token(principal)
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserInfo(
            subject=principal.subject,
            username=principal.username,
            role=principal.role,
            site_keys=list(principal.site_keys),
        ),
    )


@app.get("/api/v1/auth/me", response_model=UserInfo)
def me(principal: Principal = Depends(get_current_principal)) -> UserInfo:
    """Return the current user decoded from the bearer token."""
    if not auth_enabled():
        return UserInfo(subject="dev", username="dev", role="admin", site_keys=["*"])
    return UserInfo(
        subject=principal.subject,
        username=principal.username,
        role=principal.role,
        site_keys=list(principal.site_keys),
    )


@app.post("/api/v1/auth/password")
def change_my_password(
    payload: PasswordChange,
    principal: Principal = Depends(get_current_principal),
) -> dict:
    """Self-service password change for the signed-in user."""
    if not auth_enabled():
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    ok = db_change_password(
        principal.username, payload.current_password, payload.new_password,
    )
    if not ok:
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    return {"ok": True}


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
    from app.lib.model import load_best, get_model_type, selected_tier
    from app.lib.db import engine
    from app.lib.providers import active_providers
    from sqlalchemy import inspect

    bundle = load_best()
    model_type = get_model_type(bundle)
    tier, reason = selected_tier()

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    # Surface which providers are active so the Settings page can show
    # operators what's live without round-tripping the registry itself.
    providers = {
        role: info.name
        for role, info in active_providers().items()
    }

    # Phase 3: include the tier qualifier so external monitors can see
    # whether we're using the LSTM / XGBoost / rules and why.
    response = HealthResponse(
        status="ok",
        version="1.0.0",
        model_loaded=model_type,
        selected_tier=tier,
        selection_reason=reason,
        db_tables=len(tables),
        providers=providers,
    )
    return response


# ── Sites ──────────────────────────────────────────────────────────────────

@app.get("/api/v1/sites", response_model=list[SiteInfo])
def list_sites():
    """List all registered dive sites."""
    sites = get_all_sites()
    return [SiteInfo(**s) for s in sites]


# ── Forecast ───────────────────────────────────────────────────────────────

@app.get("/api/v1/forecast", response_model=ForecastResponse)
def forecast(
    site: str = Query(..., description="Site key"),
    _principal: Principal = Depends(get_current_principal),
):
    """Get 48-hour forecast for a dive site (read-only, no side effects)."""
    ensure_site_access(_principal, site)
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
            # Phase 1: prediction-path transparency.
            forecast_source=result.get("forecast_source", "unknown"),
            fallback_hours=result.get("fallback_hours", 0),
        )
    except Exception as exc:
        logger.error("Forecast error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Ingest ─────────────────────────────────────────────────────────────────

@app.post("/api/v1/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest):
    """Pull weather + tide data for a site."""
    from app.lib.ingest import ingest_site
    from app.api.services import invalidate_forecast_cache

    if request.site_key not in site_keys():
        raise HTTPException(status_code=404, detail=f"Unknown site: {request.site_key}")

    try:
        result = ingest_site(request.site_key, hours=request.hours)
        # Phase 4: drop the cached forecast so the next /forecast call picks
        # up the freshly-ingested data instead of returning a stale snapshot.
        invalidate_forecast_cache(request.site_key)
        return IngestResponse(site_key=request.site_key, **result)
    except Exception as exc:
        logger.error("Ingest error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Verify ─────────────────────────────────────────────────────────────────

@app.post("/api/v1/verify", response_model=VerifyResponse)
def verify(
    request: VerifyRequest,
    principal: Principal = Depends(get_current_principal),
):
    """Submit operator verification of dive conditions.

    Operators (and above) can verify any site they're scoped to. Viewers
    cannot submit verifications (403). The authenticated principal's
    identity is recorded as ``operator`` / ``actor_id`` regardless of any
    spoofed value in the request body.
    """
    ensure_role(principal, "operator", "data_steward", "admin")
    ensure_site_access(principal, request.site_key)
    try:
        result = submit_verification(
            request.model_dump(),
            actor_id=principal.subject,
            actor_username=principal.username,
        )
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


# ── Active Learning (Phase 8) ────────────────────────────────────────────

@app.get("/api/v1/active-learning/suggestions", response_model=ActiveLearningResponse)
def active_learning_suggestions(
    site: str = Query(..., description="Site key"),
    days: int = Query(default=7, ge=1, le=30),
    top_n: int = Query(default=3, ge=1, le=10),
):
    """Return up to ``top_n`` past dates where an operator verification
    would reduce model uncertainty the most.

    Phase 8: drives the "confirm yesterday's conditions?" nudge on the
    dashboard. Dates whose replayed ``P(no-go)`` falls in the
    [0.35, 0.65] uncertainty band and that have no operator
    verification yet are surfaced in descending uncertainty order.
    """
    from app.lib.active_learning import (
        suggest_active_labels,
        UNCERTAINTY_LOW,
        UNCERTAINTY_HIGH,
    )

    if site not in site_keys():
        raise HTTPException(
            status_code=404,
            detail=f"Unknown site: {site}. Valid: {site_keys()}",
        )
    try:
        suggestions = suggest_active_labels(site, days=days, top_n=top_n)
        return ActiveLearningResponse(
            site_key=site,
            uncertainty_band=[UNCERTAINTY_LOW, UNCERTAINTY_HIGH],
            lookback_days=days,
            suggestions=suggestions,
        )
    except Exception as exc:
        logger.error("Active learning error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/v1/active-learning/summary", response_model=ActiveLearningSummaryResponse)
def active_learning_summary():
    """Cross-site snapshot used by the Settings/Inspector panel."""
    from app.lib.active_learning import active_learning_summary as _summary
    try:
        return ActiveLearningSummaryResponse(**_summary())
    except Exception as exc:
        logger.error("Active learning summary error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Alerts ─────────────────────────────────────────────────────────────────

@app.get("/api/v1/alerts", response_model=AlertsResponse)
def alerts(
    site: str = Query(default=None, description="Site key (optional)"),
    hours: int = Query(default=24, ge=1, le=168),
    principal: Principal = Depends(get_current_principal),
):
    """Get recent alerts (read-only)."""
    from app.lib.alerts import get_recent_alerts

    # A site-scoped user (no '*') may only query their own site; querying
    # the cross-site default is denied so we don't leak alerts from sites
    # they aren't assigned to.
    if site is None and "*" not in principal.site_keys:
        ensure_site_access(principal, site)
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
            images=[img.model_dump() for img in request.images],
            documents=[doc.model_dump() for doc in request.documents],
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
            images=[img.model_dump() for img in request.images],
            documents=[doc.model_dump() for doc in request.documents],
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


@app.get("/api/v1/agent/tools")
async def list_agent_tools() -> dict:
    """Return the live tool registry (built-ins + MiniMax MCP web tools).

    The Settings page calls this so it doesn't have to mirror
    ``backend/app/lib/agent_tools.py`` in a frontend snapshot. Built-ins
    are returned synchronously; MCP tools are discovered lazily on the
    first call (which boots the subprocess). When the MCP is unavailable
    (no key, no uvx, etc.) the response still succeeds with the built-ins.
    """
    from app.lib.agent_tools import _static_tool_definitions
    from app.lib import agent_mcp

    definitions = _static_tool_definitions()
    mcp_status = "disabled"
    mcp_tools: list[dict] = []
    try:
        mcp_tools_raw = await agent_mcp.get_mcp_tools()
        mcp_status = "connected" if mcp_tools_raw else "unavailable"
        for tool in mcp_tools_raw:
            definitions.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema or {"type": "object", "properties": {}},
                },
            })
            mcp_tools.append({
                "name": tool.name,
                "description": tool.description,
                "source": "mcp_minimax",
            })
    except Exception as exc:
        logger.debug("MCP tool discovery failed: %s", exc)
        mcp_status = "error"

    return {
        "tools": [
            {
                "name": d["function"]["name"],
                "description": d["function"].get("description", ""),
                "parameters": d["function"].get("parameters", {}),
                "source": "builtin",
            }
            for d in definitions
        ],
        "mcp": {
            "status": mcp_status,
            "server": "minimax",
            "tools": mcp_tools,
        },
    }


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

        # Phase 4: every site's cached forecast is now stale (the underlying
        # model changed). Drop the entire cache; the next /forecast calls
        # will recompute against the new bundle.
        try:
            from app.api.services import invalidate_forecast_cache
            invalidate_forecast_cache(None)
        except Exception as exc:
            logger.warning("Forecast cache invalidation failed: %s", exc)

        return ExperimentRunResponse(
            status="success",
            message=f"Experiments complete. Best model: {results.get('best_model', 'unknown')}",
            results=results,
        )
    except Exception as exc:
        logger.error("Experiment run error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/v1/experiments/run/stream")
async def run_experiments_stream(
    principal: Principal = Depends(get_current_principal),
):
    """SSE variant of ``POST /experiments/run`` — streams progress + per-model
    metrics so the Experiments page can show the suite running live.

    Wire format (newline-delimited SSE, ``data: {json}\\n\\n`` per frame):

      - ``{type: "status", stage: "loading"|"running"|"complete", samples: int}``
        — high-level lifecycle events. ``samples`` is the total label count.
      - ``{type: "log", line: str}`` — one human-readable step line, mirroring
        what ``scripts/run_experiments.py`` prints to stdout.
      - ``{type: "metric", model: str, accuracy?, precision?, recall?, f1?, auc_roc?}``
        — one frame per model (rule, xgb, lstm, gru) emitted as soon as that
        model's metrics are available, so the comparison table fills in
        row-by-row instead of waiting for the whole suite.
      - ``{type: "done", best_model: str, results: dict}`` — terminal event.
        Same payload shape as ``POST /experiments/run``.
      - ``{type: "error", message: str}`` — terminal event when the suite
        can't start (e.g. no labels) or raises mid-run.

    The label fetch and the experiment suite itself are CPU-bound and
    synchronous; we run them in a daemon worker thread so the asyncio
    event loop stays responsive (and the SSE stream keeps flushing) for
    the duration of the multi-minute training run. Side effects
    (``model.reload()`` + ``invalidate_forecast_cache``) match the
    blocking endpoint so the dashboard picks up the new bundle either way.
    """
    import asyncio
    import threading
    from datetime import date, datetime, timezone

    import numpy as np
    import pandas as pd

    from app.lib import db as _db_lib
    from app.lib.features import FEATURE_COLUMNS, build_features, build_sequence
    from app.lib.scoring import label_to_binary
    from app.lib.experiments import run_full_experiment_suite

    logger.info("Experiments SSE stream started by %s", principal.username)

    async def event_generator():
        # ── 1. Pull labels from the DB (sync, but cheap) ─────────────────
        try:
            db = _db_lib.SessionLocal()
            try:
                labels = db.query(_db_lib.NoDiveLabel).all()
            finally:
                db.close()
        except Exception as exc:
            logger.error("Experiments stream DB error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': f'Database error: {exc}'})}\n\n"
            return

        if not labels:
            yield f"data: {json.dumps({'type': 'error', 'message': 'No labels in database. Run seed_history.py first.'})}\n\n"
            return

        # ── 2. Build the feature matrices (sync; same as /experiments/run)
        try:
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
                    X_seqs.append(build_sequence(lbl.site_key, target_ts, window_hours=24))
                    y_vals.append(label_to_binary(lbl.label))
                    label_dates.append(lbl.date)
                    label_site_keys.append(lbl.site_key)
                except Exception:
                    continue
        except Exception as exc:
            logger.error("Experiments stream feature build error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': f'Feature build failed: {exc}'})}\n\n"
            return

        n_samples = len(X_rows)
        # Loading → running transitions mirror the page's runStage state.
        yield f"data: {json.dumps({'type': 'status', 'stage': 'loading', 'samples': n_samples})}\n\n"
        yield f"data: {json.dumps({'type': 'status', 'stage': 'running', 'samples': n_samples})}\n\n"

        X_flat = pd.DataFrame(X_rows, columns=FEATURE_COLUMNS)
        y = pd.Series(y_vals, name="label")
        X_seq = np.array(X_seqs, dtype=np.float32)
        y_arr = np.array(y_vals, dtype=np.float32)

        # ── 3. Run the suite in a worker thread; bridge sync callbacks ────
        #        back into the asyncio event loop via an asyncio.Queue.
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def _enqueue(event: dict) -> None:
            # call_soon_threadsafe is the only safe way to hand a value
            # to an asyncio.Queue from a non-asyncio thread.
            loop.call_soon_threadsafe(queue.put_nowait, event)

        def progress_callback(msg: str) -> None:
            _enqueue({"type": "log", "line": msg})

        def metric_callback(model_key: str, metrics: dict) -> None:
            # Flatten the metrics dict into the SSE payload so the page
            # can drop it straight into the model_comparison table.
            payload = {"type": "metric", "model": model_key}
            for key in ("accuracy", "precision", "recall", "f1", "auc_roc"):
                if key in metrics and metrics[key] is not None:
                    payload[key] = metrics[key]
            _enqueue(payload)

        def run_in_thread() -> None:
            try:
                results = run_full_experiment_suite(
                    X_flat, y, X_seq, y_arr,
                    label_dates=label_dates,
                    label_site_keys=label_site_keys,
                    progress_callback=progress_callback,
                    metric_callback=metric_callback,
                )
                _enqueue({"type": "_done", "results": results})
            except Exception as exc:
                logger.exception("Experiments stream suite error")
                _enqueue({"type": "_error", "message": str(exc)})
            finally:
                # Sentinel so the consumer loop always terminates even if
                # the producer thread somehow exits without _done/_error.
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "_eof"})

        threading.Thread(target=run_in_thread, daemon=True).start()

        # ── 4. Drain the queue into SSE frames until the suite ends. ──────
        while True:
            event = await queue.get()
            kind = event.get("type")

            if kind == "_eof":
                break

            if kind == "_done":
                results = event["results"]
                # Same side effects as POST /experiments/run: reload the
                # cached ML bundle + invalidate the per-site forecast cache.
                try:
                    from app.lib.model import reload as model_reload
                    model_reload()
                    logger.info("Model reloaded after experiments.run/stream")
                except Exception as exc:
                    logger.warning("Model reload failed after experiments.run/stream: %s", exc)
                try:
                    from app.api.services import invalidate_forecast_cache
                    invalidate_forecast_cache(None)
                except Exception as exc:
                    logger.warning("Forecast cache invalidation failed: %s", exc)

                # Build the payload as a local dict first so the f-string
                # stays single-line — multi-line expressions inside f-string
                # braces require Python 3.12+.
                done_payload = {
                    "type": "done",
                    "best_model": results.get("best_model", "unknown"),
                    "results": results,
                }
                yield f"data: {json.dumps(done_payload, default=str)}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'stage': 'complete', 'samples': n_samples})}\n\n"
                continue

            if kind == "_error":
                yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
                continue

            # Forward ``log`` / ``metric`` frames verbatim.
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
