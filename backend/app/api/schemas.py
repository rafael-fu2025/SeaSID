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
    # Phase 1: when this hour fell back to rule-based scoring because the
    # ML model crashed (e.g. feature-schema mismatch), the reason is here.
    # None when the ML prediction succeeded.
    degraded_reason: str | None = None


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
    # Phase 1: which prediction path served the response.
    # "lstm" / "xgboost" / "rule_based" — or "*+rules_fallback" when the ML
    # model crashed and the API substituted rules. ``fallback_hours`` is the
    # number of hours that needed the substitution.
    forecast_source: str = "unknown"
    fallback_hours: int = 0
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
    archive_rows: int = 0


# ── Operator Verify ────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    site_key: str
    operator: str | None = None
    date: date
    verdict: Literal["dive", "poor_viz", "no_dive"]
    actual_viz_m: float | None = None
    actual_current: Literal["Low", "Moderate", "High"] | None = None
    comments: str | None = None
    # Phase 5: structured reason + operator confidence. Both optional so
    # the existing verify form keeps working until the UI ships the new
    # fields. ``no_go_reason`` is most useful when verdict != "dive".
    no_go_reason: Literal["viz", "current", "swell", "weather", "boat", "other"] | None = None
    confidence: Literal["low", "med", "high"] | None = None


class VerifyResponse(BaseModel):
    id: int
    site_key: str
    date: str
    verdict: str
    message: str
    no_go_reason: str | None = None
    confidence: str | None = None


# ── Labels ─────────────────────────────────────────────────────────────────

class LabelEntry(BaseModel):
    date: str
    label: str
    source: str
    actual_viz_m: float | None = None
    actual_current: str | None = None
    comments: str | None = None
    # Phase 5: structured fields surfaced to operators and the agent.
    no_go_reason: str | None = None
    confidence: str | None = None


class LabelsResponse(BaseModel):
    site_key: str
    total: int
    labels: list[LabelEntry]


# ── Agent ──────────────────────────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = None
    site_key: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class UserInfo(BaseModel):
    subject: str
    username: str
    role: str
    site_keys: list[str] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserInfo


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


# ── Active Learning (Phase 8) ────────────────────────────────────────────

class ActiveLearningSuggestion(BaseModel):
    """One candidate date where an operator verification is most valuable.

    The UI surfaces these as in-app nudges ("the model said 47% on
    Tuesday — was that right?"). On confirm, the existing /verify
    endpoint records the answer and the suggestion is dismissed.
    """
    site_key: str
    date: str
    p_bad: float
    uncertainty: float
    model_source: str
    rank: int
    reason: str


class ActiveLearningResponse(BaseModel):
    site_key: str
    uncertainty_band: list[float]
    lookback_days: int
    suggestions: list[ActiveLearningSuggestion]


class ActiveLearningSummaryResponse(BaseModel):
    """Cross-site snapshot for the Settings/Inspector panel."""
    uncertainty_band: list[float]
    lookback_days: int
    top_n: int
    calibrator_method: str
    per_site: dict[str, int]
    total: int


# ── Health ─────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    model_loaded: str
    selected_tier: str
    selection_reason: str
    db_tables: int
    # v2.1 — names of the providers currently active in the registry,
    # keyed by role (weather / marine / air). The Settings page renders
    # this so operators can see which third-party data sources are live.
    providers: dict[str, str] = {}


# ── Admin: user management ───────────────────────────────────────────────



class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(default="viewer")
    site_keys: list[str] = Field(default_factory=lambda: ["*"])
    subject: str | None = Field(default=None, max_length=100)


class UserUpdate(BaseModel):
    role: str | None = Field(default=None)
    site_keys: list[str] | None = Field(default=None)
    enabled: bool | None = Field(default=None)
    password: str | None = Field(default=None, min_length=8, max_length=256)
    subject: str | None = Field(default=None, max_length=100)


class UserOut(BaseModel):
    id: int
    username: str
    subject: str
    role: str
    site_keys: list[str]
    enabled: bool
    last_login_at: str | None = None


# ── Admin: provider API key management ─────────────────────────────────
class ApiKeyCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=50)
    label: str | None = Field(default=None, max_length=120)
    value: str = Field(min_length=1, max_length=4096)
    enabled: bool = Field(default=True)


class ApiKeyUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    value: str | None = Field(default=None, min_length=1, max_length=4096)
    enabled: bool | None = Field(default=None)


class ApiKeyOut(BaseModel):
    id: int
    provider: str
    label: str | None
    value_preview: str
    enabled: bool
    created_at: str | None
    updated_at: str | None
    last_used_at: str | None
    last_error_at: str | None
    last_error: str | None
    error_count: int
    cooldown_until: str | None
    total_uses: int
    created_by_subject: str | None


class ProviderConfigUpdate(BaseModel):
    base_url: str | None = Field(default=None, max_length=2048)


# ── Self-service password change ───────────────────────────────────────
class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)
