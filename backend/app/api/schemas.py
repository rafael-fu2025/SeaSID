"""
Pydantic schemas for API request/response validation.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Forecast ───────────────────────────────────────────────────────────────

class ForecastHour(BaseModel):
    ts: str
    risk: str
    p_bad: float
    viz_label: str
    current_risk: str
    model_used: str


class OptimalWindow(BaseModel):
    ts: str
    viz_label: str
    current_risk: str
    p_bad: float


class ForecastResponse(BaseModel):
    site_key: str
    site_name: str
    generated_at: str
    hours: list[ForecastHour]
    optimal_window: OptimalWindow | None = None
    ml_bundle_loaded: bool = False
    # Optional AQICN snapshot — present only when the site has live air data.
    # Without this field Pydantic would silently drop the value assigned in
    # `services.get_forecast()`, leaving air-quality consumers in the dark.
    air: dict | None = None
    # ── Freshness + provenance (roadmap #8) ───────────────────────────
    # When the data feeding the forecast was last refreshed, per-source
    # freshness descriptors, the model version that produced the scores,
    # and the active provider identities. Lets the UI answer "how old is
    # this?", "which source supplied it?", and "what is missing?".
    data_as_of: str | None = None
    freshness: list[dict] = []
    model_version: str = "unknown"
    providers: dict[str, str] = {}
    degraded: list[str] = []


# ── Sites ──────────────────────────────────────────────────────────────────

class SiteInfo(BaseModel):
    key: str
    name: str
    type: str
    lat: float
    lon: float
    description: str


# ── Ingest ─────────────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    site_key: str
    hours: int = Field(default=48, ge=1, le=168)


class IngestResponse(BaseModel):
    site_key: str
    weather_rows: int = 0
    marine_rows: int = 0
    air_rows: int = 0
    tide_rows: int = 0


# ── Operator Verify ────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    site_key: str
    operator: str | None = None
    date: date
    verdict: Literal["dive", "poor_viz", "no_dive"]
    actual_viz_m: float | None = None
    actual_current: Literal["Low", "Moderate", "High"] | None = None
    comments: str | None = None


class VerifyResponse(BaseModel):
    id: int
    site_key: str
    date: str
    verdict: str
    message: str


# ── Labels ─────────────────────────────────────────────────────────────────

class LabelEntry(BaseModel):
    date: str
    label: str
    source: str
    actual_viz_m: float | None = None
    actual_current: str | None = None
    comments: str | None = None


class LabelsResponse(BaseModel):
    site_key: str
    total: int
    labels: list[LabelEntry]


# ── Agent ──────────────────────────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    site_key: str | None = None


class ToolCallInfo(BaseModel):
    name: str
    arguments: dict
    result: str


class AgentChatResponse(BaseModel):
    response: str
    conversation_id: str
    tool_calls: list[ToolCallInfo]


class BriefingResponse(BaseModel):
    site_key: str
    type: str
    response: str
    conversation_id: str
    tool_calls: list[ToolCallInfo]


# ── Alerts ─────────────────────────────────────────────────────────────────

class AlertEntry(BaseModel):
    id: int
    site_key: str
    kind: str
    message: str
    ts_hour: str | None = None
    sent_at: str | None = None
    channel: str


class AlertsResponse(BaseModel):
    alerts: list[AlertEntry]


class AlertsRunResponse(BaseModel):
    status: str
    site_results: list[dict] = []
    total_created: int = 0


# ── Experiments ────────────────────────────────────────────────────────────

class ExperimentResultsResponse(BaseModel):
    timestamp: str | None = None
    dataset: dict | None = None
    model_comparison: dict | None = None
    ablations: dict | None = None
    best_model: str | None = None


class ExperimentRunResponse(BaseModel):
    status: str
    message: str
    results: dict | None = None


# ── Health ─────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    model_loaded: str
    db_tables: int
    # v2.1 — names of the providers currently active in the registry,
    # keyed by role (weather / marine / air). The Settings page renders
    # this so operators can see which third-party data sources are live.
    providers: dict[str, str] = {}
