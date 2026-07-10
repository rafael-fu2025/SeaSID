# SeaSID — Build-from-scratch spec

> **Status — v1 design doc; the shipped codebase is v2.1.**
> This document was the original v1 spec (XGBoost-only, 5 tables, 8 endpoints,
> React + Recharts, Render + nginx + systemd). The codebase shipped as **v2.1**:
> LSTM primary + XGBoost baseline + GRU ablation, 6 tables (added
> `agent_conversations`, **`marine_obs`**, **`air_quality_obs`**), 13 endpoints
> (adds `/agent/chat`, `/agent/briefing`, `/experiments/{run,results}`,
> `/labels`, `/ingest`, `/alerts/run`), 7 agent tools (added
> `get_air_quality`), a pluggable provider registry (Open-Meteo default +
> Storm Glass marine + AQICN air), 14-feature vector, plain-CSS React
> (no Recharts, no Axios, no CSS Modules), Docker-only deploy.
> See section "**v1 → v2.1 Drift Summary**" below; for the live surface
> consult the docstrings in `backend/app/api/{main,services,schemas}.py`
> and the `src/pages/*` files. **`README.md` is the project description.**

## 0. v1 → v2.1 Drift Summary

| Area | v1 (sections 1–22 below) | v2.1 (current code) |
|------|---------------------------|----------------------|
| Primary model | XGBoost only | **LSTM (PyTorch) primary + XGBoost baseline + GRU ablation** |
| Feature vector | 11 columns | **14 columns** (adds `aqi_recent`, `pm25_recent`, `wave_period_s_mean`) |
| Endpoints (`/api/v1/...`) | 8 | **13** (adds `/agent/chat`, `/agent/briefing`, `/experiments/{run,results}`, `/labels`, `/ingest`, `/alerts/run`) |
| Tables | 5 | **6** (adds `agent_conversations`, `marine_obs`, `air_quality_obs`) |
| Provider layer | hardcoded Open-Meteo + WorldTides | **pluggable registry** (`SEASID_PROVIDER_{WEATHER,MARINE,AIR}`) — Open-Meteo default, Storm Glass optional, AQICN optional |
| Agent tools | 6 | **7** (adds `get_air_quality`) |
| LLM provider | OpenAI gpt-4o | **OpenAI-compatible** (MiniMax-M3 by default, swappable via `OPENAI_BASE_URL`) |
| Frontend pages | Home · Forecast · Historical · OperatorVerify | Dashboard · Forecast · Map · Experiments · Verify · Settings |
| Frontend stack | React + Recharts + Axios + CSS Modules | React + plain CSS (no Recharts, no Axios, no CSS Modules) |
| Sidebar | always visible, fixed 232 px | **responsive** (drawer < 768 · narrow rail 768–1023 · collapsible full ≥ 1024) |
| CORS | explicit allow-list of 3 origins | **explicit allow-list, overridable via `SEASID_ALLOWED_ORIGINS`** |
| Forecast horizon | 24 h | **48 h** + `optimal_window` + optional `air` block |
| Deploy | `render.yaml` (web + static) + nginx + systemd | **Single Docker image with frontend baked in** |
| `/forecast` write behaviour | triggered alerts on every GET | **read-only** — alerts go through `POST /api/v1/alerts/run` |
| Model reload | manual process restart | **automatic** on `POST /api/v1/experiments/run` |
| Backend tests | 16 (section 13) | **66 passing** across 8 files |
| Frontend tests | 8 (section 13) | **81 passing** across 20 files (Vitest + RTL) |
| Python startup | `@app.on_event("startup")` (deprecated) | **`lifespan` async context manager** |
| DB session resolution | `from app.lib.db import SessionLocal` (binds at import) | **qualified `db.SessionLocal()` access** so test fixtures can monkey-patch |
| AI agent response | emoji-friendly markdown | **emoji-stripped**, professional typography via `MarkdownResponse` |
| Agent popover | full-page `/agent` route | **floating FAB** on every page (400 × 560 popover) |

**Reading guide:** sections 1–9 describe original v1 design intent and remain
a reference for the data model, feature contract, and product framing.
Sections 10–17 describe endpoints, UI, deployment, and tests as they were
**specified in v1** — for the live surface, consult the docstrings at the top
of `backend/app/api/main.py` and the `src/pages/*` components.

### 0.1 v2.1 Provider Matrix (new in 2.1)

| Role | Default | Optional | Env var to switch | Required key |
|------|---------|----------|-------------------|--------------|
| `weather` (precip, wind) | `open_meteo` | — | `SEASID_PROVIDER_WEATHER` | — |
| `marine` (wave, swell, currents, water temp) | `open_meteo` | `stormglass` | `SEASID_PROVIDER_MARINE` | `STORMGLASS_API_KEY` |
| `air` (AQI, PM2.5, PM10, O₃, NO₂) | `off` | `aqicn` | `SEASID_PROVIDER_AIR` | `AQICN_API_KEY` |
| `tide` (tides only) | WorldTides | — | — | `WORLDTIDES_API_KEY` (optional — degrades to 0) |

Open-Meteo is unlimited and key-less. Storm Glass and AQICN are free-tier
constrained (50 / 1000 req/day respectively). The agent tool `get_air_quality`
is now wired to this provider and returns a structured snapshot or a polite
"not available" hint.

---

## 1. Product definition

**SeaSID** ("Sea State Insight & Decision") — a per-site, 24-hour **go / no-go forecast** for small-boat dive, snorkel, kayak, and other coastal-recreation operators in the Philippines. v1 ships for two anchor sites along the Dumaguete / Negros Oriental coast (one muck-diving bay, one reef sanctuary) but the architecture must be trivially extensible to other sites by editing a single registry.

**Target user:** local dive-shop operators and trip planners who today book blind on operator hearsay and lose non-refundable boat days when rain-driven silt or unexpected currents ruin visibility.

**Core promise:** for each site, an hourly **P(no-go)** for the next 24 hours, with a calibrated optimal-window recommendation, powered by a **dual AI system** — an **LSTM deep-learning model** for time-series prediction and an **LLM-powered agent** for natural-language dive briefings, decision reasoning, and autonomous alert generation — served both as a dashboard and over REST.

**Tagline:** *"Know before you go under."*

---

## 2. Tech stack (locked)

| Layer | Choice | Rationale |
|---|---|---|
| Language (backend) | Python 3.11+ | Match FastAPI + ML runtime |
| Language (frontend) | JavaScript (ES2022+) | React ecosystem standard |
| UI Framework | **React 18 + Vite** | Full SPA, rich interactivity, proper component architecture |
| Routing | **React Router v6** | Client-side routing with nested layouts |
| Styling | **CSS Modules** + design tokens | Scoped per component, zero runtime cost |
| Charts | **Recharts** | Lightweight, React-native charting |
| HTTP Client | **Axios** | Clean API layer with interceptors |
| State | **React Context** + `useState`/`useReducer` | Standard React patterns, no heavy state lib needed for v1 |
| API | **FastAPI** + Uvicorn | OpenAPI 3.1, Swagger UI auto-generated |
| ORM | **SQLAlchemy 2.x** | Type-safe queries, easy SQLite-to-Postgres migration |
| DB | **SQLite** (file: `backend/data/seasid.db`, WAL mode) | Zero-ops for v1, WAL prevents concurrent lock errors |
| Deep Learning | **PyTorch** (`nn.LSTM` / `nn.GRU`) | Primary prediction model — real neural network, not a placeholder |
| ML Baseline | **XGBoost** (`XGBClassifier`, sklearn-compatible API) | Traditional ML baseline for experimental comparison |
| LLM Agent | **OpenAI API** (GPT-4o / GPT-4o-mini) with function-calling | Natural-language briefings, tool-use reasoning, autonomous alerts |
| Weather | **Open-Meteo Forecast + Marine + Archive** APIs | No API key required; archive API provides 90-day historical data |
| Tides | **WorldTides** (`heights` endpoint) | Free tier, optional via env |
| Backend Tests | **pytest** + FastAPI `TestClient` | 20 test minimum |
| Frontend Tests | **Vitest** + **React Testing Library** | Component-level coverage, 10 test minimum |
| Deploy | **Render** free tier via `render.yaml` blueprint | Two services: API (web) + UI (static) |
| Container | Docker + docker-compose | Multi-service orchestration |
| Process mgmt | `systemd` unit + `nginx` reverse-proxy conf | For bare-metal VPS fallback |

---

## 3. Project layout

```
SeaSID/
├── backend/                              # Python (FastAPI + ML + Agent)
│   ├── app/
│   │   ├── __init__.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── main.py                   # FastAPI app + CORS + versioned routes
│   │   │   ├── schemas.py                # Pydantic v2 models
│   │   │   └── services.py              # Business logic, reuses app.lib.*
│   │   └── lib/
│   │       ├── __init__.py
│   │       ├── sites.py                  # Site registry (key, name, lat/lon, type)
│   │       ├── db.py                     # SQLAlchemy models + session (WAL mode)
│   │       ├── weather.py                # Open-Meteo client + synthetic fallback
│   │       ├── tides.py                  # WorldTides client (loads .env)
│   │       ├── ingest.py                 # One-shot pull (loads .env)
│   │       ├── features.py               # Feature engineering (train + infer)
│   │       ├── scoring.py                # Rule-based baseline (Baseline 1)
│   │       ├── model_xgb.py             # XGBoost baseline (Baseline 2)
│   │       ├── model_lstm.py            # LSTM/GRU deep learning (Primary model)
│   │       ├── model.py                  # Unified model interface (dispatches to LSTM or XGBoost)
│   │       ├── agent.py                  # LLM Agent with OpenAI function-calling
│   │       ├── agent_tools.py           # Tool definitions for agent
│   │       ├── experiments.py           # Model comparison + ablation runner
│   │       └── alerts.py                # AlertStore + SMTP transport + evaluate
│   ├── data/
│   │   ├── seasid.db                     # SQLite (auto-created; gitignored)
│   │   ├── sample_no_dive_history.csv    # Curated seed labels
│   │   ├── seasid_lstm.pt               # Trained LSTM weights (gitignored)
│   │   ├── seasid_xgb.pkl              # Trained XGBoost bundle (gitignored)
│   │   ├── seasid_metrics.json           # Training metrics (gitignored)
│   │   ├── experiment_results.json      # Full experiment comparison (gitignored)
│   │   └── figures/                      # Generated plots: loss curves, ROC, confusion matrices
│   ├── scripts/
│   │   ├── init_db.py                    # Create tables (with WAL mode)
│   │   ├── seed_history.py               # Load sample_no_dive_history.csv
│   │   ├── expand_dataset.py            # Pull 90-day historical weather + generate synthetic labels
│   │   ├── train_model.py                # Fit LSTM + XGBoost on current labels
│   │   ├── run_experiments.py           # Full experiment suite (all models × all ablations)
│   │   └── run_api.py                    # uvicorn launcher
│   ├── tests/
│   │   ├── conftest.py                   # Fixtures (tmp db, toy dataset)
│   │   ├── test_features.py              # Schema + 24h/48h/3h rolling windows
│   │   ├── test_lstm.py                 # LSTM train + predict + loss convergence
│   │   ├── test_xgb.py                 # XGBoost train + persist + predict_proba
│   │   ├── test_agent.py               # Agent tool-calling + briefing generation
│   │   ├── test_api.py                   # Endpoint smoke tests via TestClient
│   │   └── test_alerts.py                # AlertStore idempotency + SMTP mock
│   ├── .env.example
│   ├── requirements.txt
│   └── pytest.ini
│
├── frontend/                             # React (Vite)
│   ├── public/
│   │   └── favicon.svg
│   ├── src/
│   │   ├── main.jsx                      # React entry point
│   │   ├── App.jsx                       # Router + layout shell
│   │   ├── api/
│   │   │   └── client.js                 # Axios wrapper → VITE_API_URL
│   │   ├── hooks/
│   │   │   ├── useForecast.js            # GET /api/v1/forecast?site=<key>
│   │   │   ├── useSites.js               # GET /api/v1/sites
│   │   │   ├── useAlerts.js              # GET /api/v1/alerts
│   │   │   ├── useHealth.js              # GET /api/v1/health
│   │   │   ├── useAgent.js              # POST /api/v1/agent/chat
│   │   │   └── useExperiments.js        # GET /api/v1/experiments/results
│   │   ├── context/
│   │   │   └── SiteContext.jsx           # Selected site state
│   │   ├── components/
│   │   │   ├── Layout.jsx                # Nav + footer shell
│   │   │   ├── SiteSelector.jsx          # Dropdown for site selection
│   │   │   ├── RiskCard.jsx              # Color-coded risk tile
│   │   │   ├── HourCard.jsx              # Single hour in 24h stack
│   │   │   ├── AlertBanner.jsx           # Recent alerts strip
│   │   │   ├── FeatureTable.jsx          # 11-feature snapshot
│   │   │   ├── PBadChart.jsx             # p_bad line chart (Recharts)
│   │   │   ├── VizHistogram.jsx          # Historical viz_m distribution
│   │   │   ├── LabelTimeSeries.jsx       # Monthly label counts
│   │   │   ├── ImportanceBar.jsx         # Feature importance bar chart
│   │   │   ├── FeedbackForm.jsx          # Operator verification form
│   │   │   ├── AgentChat.jsx            # Chat interface for LLM agent
│   │   │   ├── DiveBriefing.jsx         # Rendered NL briefing card
│   │   │   ├── ExperimentResults.jsx    # Model comparison tables + charts
│   │   │   ├── LossChart.jsx            # LSTM training/validation loss curves
│   │   │   └── ConfusionMatrix.jsx      # Interactive confusion matrix display
│   │   ├── pages/
│   │   │   ├── Home.jsx                  # Landing: hero + site selector + nav tiles
│   │   │   ├── Forecast.jsx              # 24h cards + optimal window + chart + agent briefing
│   │   │   ├── Historical.jsx            # Past labels + diagnostics + retrain
│   │   │   ├── OperatorVerify.jsx        # Ground-truth collection form
│   │   │   ├── Agent.jsx                # Agent chat + dive briefing page
│   │   │   └── Experiments.jsx          # Model comparison dashboard
│   │   ├── styles/
│   │   │   ├── index.css                 # Design tokens + global reset
│   │   │   ├── Layout.module.css
│   │   │   ├── RiskCard.module.css
│   │   │   ├── HourCard.module.css
│   │   │   ├── ForecastPage.module.css
│   │   │   ├── HistoricalPage.module.css
│   │   │   ├── OperatorVerify.module.css
│   │   │   ├── AgentPage.module.css
│   │   │   └── ExperimentsPage.module.css
│   │   └── __tests__/
│   │       ├── SiteSelector.test.jsx
│   │       ├── RiskCard.test.jsx
│   │       ├── FeedbackForm.test.jsx
│   │       ├── Forecast.test.jsx
│   │       ├── AgentChat.test.jsx
│   │       └── ExperimentResults.test.jsx
│   ├── index.html
│   ├── vite.config.js                    # Proxy /api → localhost:8000
│   ├── vitest.config.js
│   └── package.json
│
├── deploy/
│   ├── seasid.service                    # systemd unit (API only)
│   ├── nginx.conf                        # / → React static, /api → FastAPI
│   └── Dockerfile.frontend              # Node build → nginx static serve
├── Dockerfile                            # Backend (Python)
├── docker-compose.yml                    # Orchestrates API + frontend
├── render.yaml                           # Two-service Render blueprint
├── .gitignore
└── README.md
```

---

## 4. Site registry (`backend/app/lib/sites.py`)

Two anchor sites for v1, structured so adding a third is one dict entry:

```python
SITES: list[dict] = [
    {
        "key": "dauin_muck",
        "name": "Dauin Muck Bays",
        "type": "muck",                          # affects is_muck_site flag
        "lat": 9.1844,
        "lon": 123.2678,
        "description": "World-class muck diving along Dauin's black-sand coast.",
    },
    {
        "key": "apo_reef",
        "name": "Apo Island Reef",
        "type": "reef",
        "lat": 9.0671,
        "lon": 123.2737,
        "description": "Marine sanctuary. Tidal currents can be dangerous for new divers.",
    },
]
```

API exposes these via `GET /api/v1/sites`. UI site selector is driven by this list — no hardcoded names anywhere else.

---

## 5. Database schema (`backend/app/lib/db.py`)

SQLAlchemy 2.x, five tables. Use `init_db()` to create. All times stored timezone-aware (UTC). Enable **WAL mode** on connection to prevent `database is locked` errors from concurrent React SPA requests.

```python
# In db.py engine creation:
from sqlalchemy import event

engine = create_engine("sqlite:///data/seasid.db", connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()
```

| Table | Purpose | Key columns |
|---|---|---|
| `weather_obs` | Hourly weather pulled from Open-Meteo | `site_key`, `ts` (UTC), `precip_mm`, `wind_max_kmh`, `wind_mean_kmh`, `wave_max_m`, `sea_temp_c` |
| `tide_obs` | Hourly tide heights from WorldTides | `site_key`, `ts` (UTC), `height_m` |
| `no_dive_labels` | Ground truth (FB seed + operator forms) | `site_key`, `date`, `label` (dive/poor_viz/no_dive), `source`, `actual_viz_m?`, `actual_current?`, `comments?`, `shop_name?` |
| `operator_verifications` | Submissions from the Operator Verify page | `site_key`, `operator`, `date`, `verdict`, `actual_viz_m`, `actual_current`, `comments` |
| `alerts` | Alert history (for in-app banner + idempotency) | `site_key`, `kind`, `ts_hour`, `sent_at`, `channel` (in_app/email), `message` |
| `agent_conversations` | Agent chat history for context | `id`, `site_key`, `role` (user/assistant/tool), `content`, `ts`, `tool_calls_json?` |

Add a `source` column on `no_dive_labels` so FB posts vs operator forms vs manual seeds stay distinguishable (`fb_<shop>` / `operator_form` / `manual` / `seed`).

---

## 6. Feature engineering (`backend/app/lib/features.py`)

Exactly 11 features, in this order. All derived deterministically from `weather_obs` + `tide_obs` rows. Implement rolling windows in pandas; on missing data, the synthetic-fallback path fills with `0.0` for sums/maxes and the 7-day climatology mean for `sea_temp_mean_24h` (per-site).

```python
FEATURE_COLUMNS = [
    "precip_24h_mm",         # sum, 24h (mm)
    "precip_48h_mm",         # sum, 48h (mm)
    "precip_recent_3h",      # sum, last 3h (mm)
    "wind_max_24h_kmh",      # max, 24h (km/h)
    "wind_mean_24h_kmh",     # mean, 24h (km/h)
    "wave_max_24h_m",        # max, 24h (m)
    "sea_temp_mean_24h",     # mean, 24h (°C)
    "tide_max_24h_m",        # max, 24h (m)
    "tide_min_24h_m",        # min, 24h (m)
    "tide_range_24h_m",      # max - min, 24h (m)
    "is_muck_site",          # 1 if site.type == "muck", else 0
]
```

Function signatures:

```python
def build_features(site_key: str, target_ts: datetime) -> pd.DataFrame:
    """Return a 1-row DataFrame with FEATURE_COLUMNS in order."""

def build_sequence(site_key: str, target_ts: datetime, window_hours: int = 24) -> np.ndarray:
    """Return a (window_hours, len(FEATURE_COLUMNS)) array for LSTM input.
    Each row is the feature vector for one hour in the lookback window."""
```

`build_features` is used by XGBoost (single snapshot) and rule-based scoring. `build_sequence` is used by the LSTM (sliding window of hourly feature vectors). Single source of truth — do not duplicate the column list.

---

## 7. ML models (`backend/app/lib/model_lstm.py`, `model_xgb.py`, `model.py`)

### 7a. LSTM prediction model — Primary (`model_lstm.py`)

The primary deep learning model. Uses PyTorch `nn.LSTM` to process sequences of hourly weather features:

```python
import torch
import torch.nn as nn

class LSTMPredictor(nn.Module):
    def __init__(
        self,
        input_size: int = 11,       # len(FEATURE_COLUMNS)
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout,
            batch_first=True,
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (batch, seq_len, input_size)
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]     # take last timestep
        return self.classifier(last_hidden).squeeze(-1)
```

**Training configuration:**

```python
@dataclass
class LSTMTrainConfig:
    seq_len: int = 24              # hours of lookback (ablation: 12, 24, 48)
    hidden_size: int = 64          # (ablation: 32, 64, 128)
    num_layers: int = 2
    dropout: float = 0.3
    lr: float = 1e-3
    batch_size: int = 32
    max_epochs: int = 100
    patience: int = 10             # early stopping patience
    weight_decay: float = 1e-4
```

**Training loop requirements:**

- **Train/val/test split**: 70% / 15% / 15%, stratified by label
- **Early stopping**: Monitor validation loss, stop after `patience` epochs with no improvement
- **Learning rate scheduling**: `ReduceLROnPlateau(factor=0.5, patience=5)`
- **Gradient clipping**: `max_norm=1.0`
- **Feature normalization**: `StandardScaler` fit on training set only, applied to val/test
- Record **train loss** and **val loss** at every epoch for loss curve plotting

**Public surface:**

```python
@dataclass
class LSTMTrainingResult:
    model: nn.Module
    scaler: StandardScaler
    metrics: dict                  # accuracy, f1, precision, recall, auc_roc
    train_losses: list[float]
    val_losses: list[float]
    n_samples: int
    config: LSTMTrainConfig
    feature_columns: list[str]

def train_lstm(X_sequences: np.ndarray, y: np.ndarray, config: LSTMTrainConfig | None = None) -> LSTMTrainingResult
def save_lstm(result: LSTMTrainingResult, model_path: Path, metrics_path: Path) -> None
def load_lstm(model_path: Path) -> dict | None
def predict_proba_lstm(bundle: dict, X_seq: np.ndarray) -> np.ndarray
```

Save format: `torch.save({"model_state_dict": ..., "scaler": ..., "config": ..., "feature_columns": ..., "n_samples": ...}, path)`

### 7b. XGBoost baseline (`model_xgb.py`)

Kept as **Baseline 2** for experimental comparison. Conservative hyperparameters (you have ~150 real labels, though synthetic data expands this):

```python
from xgboost import XGBClassifier

def _build_classifier() -> XGBClassifier:
    return XGBClassifier(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.05,
        min_child_weight=2,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=1,
        tree_method="hist",
        verbosity=0,
    )
```

Public surface (mirrors original spec):

```python
@dataclass
class XGBTrainingResult:
    model: object
    metrics: dict
    n_samples: int
    feature_columns: list[str]

def train_xgb(X: pd.DataFrame, y: pd.Series) -> XGBTrainingResult
def save_xgb(result: XGBTrainingResult, model_path: Path, metrics_path: Path) -> None
def load_xgb(model_path: Path) -> dict | None
def predict_proba_xgb(bundle: dict, X: pd.DataFrame) -> pd.Series
def feature_importance(bundle: dict, feature_names: list[str]) -> pd.DataFrame
```

### 7c. Unified model interface (`model.py`)

Dispatches to whichever model is loaded, preferring LSTM:

```python
def load_best() -> dict | None:
    """Try LSTM first, fall back to XGBoost, then None (rule-based)."""

def predict(bundle: dict, site_key: str, target_ts: datetime) -> float:
    """Return P(no-go). Dispatches to LSTM or XGBoost based on bundle type."""

def get_model_type(bundle: dict) -> Literal["lstm", "xgboost", "rule_based"]
```

---

## 8. Data sources (`backend/app/lib/weather.py`, `tides.py`, `ingest.py`)

### Open-Meteo (no key)

- **Forecast endpoint:** `https://api.open-meteo.com/v1/forecast`
- **Params:** `latitude`, `longitude`, `hourly=precipitation,wind_speed_10m,wind_gusts_10m,wave_height,sea_surface_temperature`, `forecast_days=2`, `timezone=UTC`
- **Archive endpoint (NEW):** `https://archive-api.open-meteo.com/v1/archive`
- **Params:** `latitude`, `longitude`, `hourly=precipitation,wind_speed_10m,wind_gusts_10m`, `start_date`, `end_date`, `timezone=UTC`
- **Purpose:** Pull 90+ days of historical hourly weather data to expand the training dataset for the LSTM model.
- **Optional:** also pull marine endpoint at `https://marine-api.open-meteo.com/v1/marine` with `hourly=wave_height` if the main endpoint doesn't include it.
- **Retry:** 3 attempts, exponential backoff (1s, 2s, 4s). On total failure, fall back to a deterministic synthetic generator (seeded by `(site_key, date)`) so training never breaks on a stale or down API.

### WorldTides (optional)

- **Endpoint:** `https://www.worldtides.info/api/v3`
- **Params:** `heights`, `lat`, `lon`, `length=86400`, `step=3600`, `datum=MSL`
- Read `WORLDTIDES_API_KEY` from `.env`. If missing or request fails, set tide columns to `0` in features but log a warning.

### Dataset expansion (`scripts/expand_dataset.py`) — NEW

This script is critical for training the LSTM with sufficient data:

1. Pull 90 days of historical hourly weather from Open-Meteo Archive API for both sites
2. Insert into `weather_obs` table
3. For each historical day, run the **rule-based scoring** to generate synthetic labels
4. Insert synthetic labels into `no_dive_labels` with `source="synthetic_rule"`
5. Log: `"Expanded dataset: {n_real} real labels + {n_synthetic} synthetic = {total} total"`

Target: **2000+ training samples** (synthetic + real). The experiment section will report metrics on real-only vs synthetic+real subsets.

### Ingest (`scripts/init_db.py` + `scripts/seed_history.py`)

- `init_db` creates tables (with WAL mode pragma).
- `seed_history` reads `data/sample_no_dive_history.csv` (curated operator posts with columns `site_key,date,label,actual_viz_m,actual_current,source,comments`) and inserts into `no_dive_labels`.
- One-shot pull for a single site: `python -m scripts.ingest --site dauin_muck --hours 48`.

**Honest scope note** (mark this in the README): scheduled cron ingestion via APScheduler is scoped for v2. v1 ships with manual pulls (`scripts/ingest.py` + a button in the UI). Same for Facebook scraping — v1 uses the curated CSV + synthetic expansion; v2 will add a real scraper.

---

## 9. Rule-based baseline — Baseline 1 (`backend/app/lib/scoring.py`)

Hand-tuned thresholds as a cold-start baseline. Serves two purposes: (1) fallback when no ML model is loaded, (2) **Baseline 1** in the experimental comparison:

```python
def score_hour(features: dict) -> tuple[str, str]:
    """Return (viz_label, current_risk)."""
    # viz_label ∈ {"Good", "Moderate", "Poor"}
    # current_risk ∈ {"Low", "Moderate", "High"}
```

Reasonable starting thresholds (tune later with more data):

- `precip_24h_mm > 25` or `precip_48h_mm > 40` → **Poor**
- `wind_max_24h_kmh > 35` → **Poor** (viz) AND **High** (current)
- `wave_max_24h_m > 2.0` → **Moderate+**
- `tide_range_24h_m > 1.5` → **High** current risk

Final `risk_label` combines viz + current into `"LOW"` / `"MODERATE"` / `"HIGH RISK"`.

Also used by `expand_dataset.py` to generate synthetic labels for historical weather data.

---

## 10. LLM Agent system (`backend/app/lib/agent.py`, `agent_tools.py`) — NEW

### Overview

An autonomous AI agent powered by OpenAI's function-calling API. The agent receives natural-language queries from operators and uses tools to fetch real-time data, interpret LSTM predictions, and generate dive briefings.

### Agent tools (`agent_tools.py`)

Define as OpenAI function-calling schemas:

```python
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_forecast",
            "description": "Get the 24-hour P(no-go) forecast for a dive site. Returns hourly predictions from the LSTM model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string", "description": "Site key, e.g. 'dauin_muck' or 'apo_reef'"}
                },
                "required": ["site_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get current and recent weather observations for a site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string"},
                    "hours": {"type": "integer", "description": "Hours of history to return (default 24)"}
                },
                "required": ["site_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_tide_data",
            "description": "Get current tide heights and predictions for a site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string"}
                },
                "required": ["site_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_site_info",
            "description": "Get details about a dive site including type, location, and description.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string"}
                },
                "required": ["site_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_historical_labels",
            "description": "Get past dive condition labels and operator reports for a site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string"},
                    "days": {"type": "integer", "description": "Number of days of history (default 30)"}
                },
                "required": ["site_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "submit_alert",
            "description": "Create and dispatch a weather/dive alert for a site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_key": {"type": "string"},
                    "message": {"type": "string", "description": "Alert message text"},
                    "severity": {"type": "string", "enum": ["low", "moderate", "high"]}
                },
                "required": ["site_key", "message", "severity"]
            }
        }
    }
]
```

### Agent implementation (`agent.py`)

```python
from openai import OpenAI

SYSTEM_PROMPT = """You are SeaSID, an expert marine conditions advisor for dive operators 
in Dumaguete, Philippines. You have access to real-time weather data, LSTM-based P(no-go) 
predictions, tide information, and historical dive condition records.

Your role is to:
1. Interpret weather and forecast data to give actionable dive recommendations
2. Explain WHY conditions are good or bad (chain-of-thought reasoning)
3. Identify optimal dive windows within the next 24 hours
4. Warn about dangerous conditions proactively
5. Consider site-specific factors (muck sites are more sensitive to rain/silt; 
   reef sites are more affected by currents)

Always cite specific data points (precipitation mm, wind km/h, wave height m, P(no-go) 
probability) in your recommendations. Be direct and safety-conscious."""

class SeaSIDAgent:
    def __init__(self, model: str = "gpt-4o-mini"):
        self.client = OpenAI()  # reads OPENAI_API_KEY from env
        self.model = model

    def chat(self, user_message: str, site_key: str | None = None,
             conversation_history: list[dict] | None = None) -> dict:
        """Process a user message with tool-calling.
        Returns {"reply": str, "tool_calls": list[dict], "reasoning_trace": str}
        """

    def generate_briefing(self, site_key: str) -> dict:
        """Auto-generate a dive briefing for the given site.
        Returns {"briefing": str, "risk_level": str, "optimal_window": str, 
                 "data_sources_used": list[str]}
        """

    def evaluate_alerts(self, site_key: str) -> list[dict]:
        """Autonomously evaluate if any alerts should be triggered.
        Returns list of {message, severity, should_send} dicts.
        """

    def _execute_tool(self, tool_name: str, args: dict) -> str:
        """Route tool calls to actual backend functions."""
```

### Agent chat loop

The agent uses OpenAI's multi-turn function-calling:

1. User sends a message (e.g., "Should I take the 7am boat to Apo tomorrow?")
2. Agent decides which tools to call (e.g., `get_forecast("apo_reef")`, `get_current_weather("apo_reef")`)
3. Tool results are fed back to the agent
4. Agent synthesizes a natural-language response with reasoning

---

## 11. Experimental evaluation framework (`backend/app/lib/experiments.py`) — NEW

### Overview

Systematic comparison of all models with proper experimental methodology. This is the **core academic contribution** of the project.

### Model comparison matrix

| Model ID | Name | Category | Input |
|----------|------|----------|-------|
| `rule` | Rule-based scoring | Baseline 1 | 11 features (snapshot) |
| `xgb` | XGBoost classifier | Baseline 2 (Traditional ML) | 11 features (snapshot) |
| `lstm` | LSTM (primary) | Deep Learning | 24h × 11 features (sequence) |
| `gru` | GRU variant | Deep Learning (ablation) | 24h × 11 features (sequence) |

### Metrics computed for every model

```python
METRICS = ["accuracy", "precision", "recall", "f1", "auc_roc"]
```

All computed on the **held-out test set** (15% of data, never seen during training).

### Ablation studies

| Ablation | Variable | Values | Purpose |
|----------|----------|--------|---------|
| Sequence length | `seq_len` | 12, 24, 48 | Does more lookback help? |
| Hidden size | `hidden_size` | 32, 64, 128 | Model capacity vs overfitting |
| Feature subsets | features | All 11, Top-5, Weather-only (7) | Which features matter? |
| Tide data impact | features | With tide, Without tide | Is the optional WorldTides API worth it? |

### Experiment runner (`scripts/run_experiments.py`)

```python
def run_full_experiment_suite() -> dict:
    """
    1. Load and split data (70/15/15, stratified, fixed seed=42)
    2. Train all models on training set
    3. Evaluate all models on test set
    4. Run ablation studies (LSTM-only, vary one parameter at a time)
    5. Generate plots: loss curves, ROC curves, confusion matrices, feature importance
    6. Save results to data/experiment_results.json
    7. Save figures to data/figures/
    """
```

### Output artifacts

```python
# data/experiment_results.json shape:
{
    "timestamp": "2026-07-09T12:00:00Z",
    "dataset": {
        "total_samples": 2150,
        "real_labels": 150,
        "synthetic_labels": 2000,
        "train_size": 1505,
        "val_size": 322,
        "test_size": 323,
    },
    "model_comparison": {
        "rule": {"accuracy": 0.72, "precision": 0.68, "recall": 0.75, "f1": 0.71, "auc_roc": null},
        "xgb": {"accuracy": 0.81, "precision": 0.79, "recall": 0.83, "f1": 0.81, "auc_roc": 0.88},
        "lstm": {"accuracy": 0.87, "precision": 0.85, "recall": 0.89, "f1": 0.87, "auc_roc": 0.93},
        "gru": {"accuracy": 0.85, "precision": 0.83, "recall": 0.87, "f1": 0.85, "auc_roc": 0.91},
    },
    "ablations": {
        "seq_len": {...},
        "hidden_size": {...},
        "feature_subsets": {...},
        "tide_impact": {...},
    },
    "best_model": "lstm",
    "best_config": {"seq_len": 24, "hidden_size": 64, "num_layers": 2},
}
```

### Generated figures (`data/figures/`)

| Figure | File | Content |
|--------|------|---------|
| Loss curves | `loss_curves.png` | LSTM train/val loss per epoch |
| ROC curves | `roc_comparison.png` | All models overlaid |
| Confusion matrices | `confusion_{model}.png` | One per model |
| Feature importance | `feature_importance.png` | XGBoost + LSTM gradient-based |
| Ablation: seq_len | `ablation_seq_len.png` | F1 vs sequence length |
| Ablation: hidden_size | `ablation_hidden_size.png` | F1 vs hidden units |

---

## 12. FastAPI (`backend/app/api/`)

All endpoints are versioned under `/api/v1/`. CORS is explicitly configured for the React frontend.

### CORS configuration (`main.py`)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",       # Vite dev server
        "http://localhost:3000",       # Docker frontend
        "https://seasid-ui.onrender.com",  # Production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Endpoints (in this exact order)

| Method | Path | Purpose | Response model |
|---|---|---|---|
| `GET` | `/api/v1/health` | DB row counts + model_loaded + model_type + tides_enabled + server_time | `HealthOut` |
| `GET` | `/api/v1/sites` | List all sites | `list[SiteRef]` |
| `GET` | `/api/v1/forecast?site=<key>` | 24 hourly rows + current_summary + optimal_window | `ForecastResponse` |
| `POST` | `/api/v1/feedback` | Save operator verification → derive label | `FeedbackOut` |
| `POST` | `/api/v1/retrain` | Re-fit LSTM + XGBoost on current labels | `RetrainOut` |
| `GET` | `/api/v1/alerts?limit=<n>` | Recent alerts across all sites (default limit=20) | `list[AlertOut]` |
| `POST` | `/api/v1/alerts/run` | Trigger alert evaluator for all sites | `AlertsTriggerOut` |
| `POST` | `/api/v1/agent/chat` | Send a message to the LLM agent, get NL response | `AgentChatResponse` |
| `GET` | `/api/v1/agent/briefing?site=<key>` | Auto-generated dive briefing for a site | `BriefingResponse` |
| `GET` | `/api/v1/experiments/results` | Latest experiment metrics + figure paths | `ExperimentResultsResponse` |
| `POST` | `/api/v1/experiments/run` | Trigger full experiment suite | `ExperimentRunResponse` |
| `GET` | `/docs` | Swagger UI (auto) | — |
| `GET` | `/openapi.json` | OpenAPI 3.1 schema (auto) | — |

### `/api/v1/forecast` response shape (Pydantic v2)

```python
class HourForecast(BaseModel):
    ts: datetime
    precip_rolling_24h_mm: float
    wind_max_24h_kmh: float
    wave_max_24h_m: float
    viz_label: Literal["Good", "Moderate", "Poor"]
    current_risk: Literal["Low", "Moderate", "High"]
    p_bad: float                       # from LSTM if loaded, XGBoost fallback, else rule-based proxy

class CurrentSummary(BaseModel):
    viz_label: Literal["Good", "Moderate", "Poor"]
    current_risk: Literal["Low", "Moderate", "High"]
    precip_rolling_24h_mm: float
    p_bad: float
    risk_label: Literal["LOW", "MODERATE", "HIGH RISK"]

class OptimalWindow(BaseModel):
    ts: datetime
    viz_label: Literal["Good", "Moderate", "Poor"]
    current_risk: Literal["Low", "Moderate", "High"]
    p_bad: float

class ForecastResponse(BaseModel):
    site: SiteRef
    hours: list[HourForecast]          # length = 24
    current_summary: CurrentSummary
    optimal_window: OptimalWindow      # the hour with min p_bad in the next 24h
    model_type: Literal["lstm", "xgboost", "rule_based"]
    ml_bundle_loaded: bool
```

### `/api/v1/feedback` request shape

```python
class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_key: str
    shop_name: str | None = None
    date: date_type
    actual_viz_m: float = Field(..., ge=0, le=40)
    actual_current: Literal["Low", "Moderate", "High"]
    comments: str | None = None

class FeedbackOut(BaseModel):
    saved_id: int
    derived_label: Literal["dive", "poor_viz", "no_dive"]
    message: str = "Thanks! Your observation has been recorded."
```

`derived_label` rules:

- `actual_viz_m < 5` OR `actual_current == "High"` → `no_dive`
- `actual_viz_m < 10` → `poor_viz`
- else → `dive`

### `/api/v1/agent/chat` request/response shapes — NEW

```python
class AgentChatRequest(BaseModel):
    message: str
    site_key: str | None = None        # optional site context
    conversation_id: str | None = None  # for multi-turn

class AgentChatResponse(BaseModel):
    reply: str                         # agent's natural-language response
    tool_calls: list[dict]             # tools the agent invoked (for transparency)
    conversation_id: str
    model_used: str                    # e.g. "gpt-4o-mini"

class BriefingResponse(BaseModel):
    site: SiteRef
    briefing: str                      # full natural-language dive briefing
    risk_level: Literal["LOW", "MODERATE", "HIGH RISK"]
    optimal_window: str                # e.g. "07:00–10:00 UTC"
    data_sources_used: list[str]       # e.g. ["forecast", "weather", "tide", "history"]
    generated_at: datetime
```

### `/api/v1/experiments/results` response shape — NEW

```python
class ModelMetrics(BaseModel):
    accuracy: float
    precision: float
    recall: float
    f1: float
    auc_roc: float | None

class ExperimentResultsResponse(BaseModel):
    timestamp: datetime
    dataset_summary: dict
    model_comparison: dict[str, ModelMetrics]  # keyed by model_id
    ablations: dict
    best_model: str
    figure_paths: list[str]
```

### Error response schema

```python
class ErrorResponse(BaseModel):
    detail: str
    error_code: str | None = None
```

All error responses use `HTTPException` and conform to this shape. Never leak stack traces.

### Cross-cutting rules

- All endpoints must be importable and testable in isolation — services live in `backend/app/api/services.py`, never inside route handlers.
- CORS: configured for known origins (see above); tighten in v2.
- Errors: `HTTPException` with descriptive detail; never leak stack traces.
- Logging: `logging.getLogger(__name__)`, level `INFO` by default.

---

## 13. React UI (`frontend/src/`)

### Landing page (`pages/Home.jsx`)

- Hero: project name + tagline + "AI-powered underwater visibility & current forecast" subtitle
- `<SiteSelector>` component populated from `useSites()` hook → `GET /api/v1/sites`
- Five navigation tiles (React Router `<Link>` elements): Forecast, AI Assistant, Historical, Experiments, Operator Verify
- Footer: version, last data refresh timestamp, model type indicator

### Page 1: `pages/Forecast.jsx`

- `<SiteSelector>` (persisted in `SiteContext`)
- `<AlertBanner>` at top — pulls last 5 from `useAlerts()` for the selected site, renders as colored cards
- `<DiveBriefing>` — auto-generated natural-language briefing from the LLM agent (calls `GET /api/v1/agent/briefing?site=<key>`)
- Three hero `<RiskCard>` tiles: NOW, NEXT 6H, OPTIMAL (each shows `viz_label`, `current_risk`, `p_bad`)
- 24-hour card stack — `<HourCard>` for each hour, color-coded by `risk_label`
- `<PBadChart>` — Recharts `<LineChart>` over the 24h window with optimal window highlighted via `<ReferenceArea>`
- `<FeatureTable>` — table of the 11 input features for the current hour
- Model type badge: shows whether prediction is from LSTM, XGBoost, or rule-based
- Refresh button that re-fetches forecast data via `useForecast()` refetch

### Page 2: `pages/Agent.jsx` — NEW

- `<AgentChat>` — chat interface for the LLM agent
  - Message input with send button
  - Chat history rendered as message bubbles (user/assistant)
  - Tool-call transparency: expandable section showing which tools the agent called and their results
  - Site context selector: optionally scope the conversation to a specific site
  - Example prompts: "Should I dive at Dauin tomorrow?", "What's the best time for Apo Island this week?", "Why is visibility poor today?"
- `<DiveBriefing>` — rendered below chat showing the latest auto-generated briefing

### Page 3: `pages/Historical.jsx`

- Summary tiles: total labels, breakdown by source (real vs synthetic), breakdown by `derived_label`
- `<VizHistogram>` of `actual_viz_m` by site (Recharts `<BarChart>`)
- `<LabelTimeSeries>` of label counts per month (Recharts `<AreaChart>`)
- `<ImportanceBar>` — feature importance bar chart (from model feature_importance endpoint)
- 🧠 Retrain button — calls `POST /api/v1/retrain`, shows loading spinner, then updates metrics inline

### Page 4: `pages/Experiments.jsx` — NEW

- `<ExperimentResults>` — model comparison dashboard
  - **Comparison table**: all 4 models × 5 metrics, best values highlighted
  - **ROC curves**: overlaid for all models (Recharts `<LineChart>`)
  - **Confusion matrices**: `<ConfusionMatrix>` component for each model
  - **Loss curves**: `<LossChart>` showing LSTM train/val loss per epoch
  - **Ablation charts**: bar charts for each ablation study
- 🔬 Run Experiments button — calls `POST /api/v1/experiments/run`, shows progress indicator
- Last run timestamp and dataset summary

### Page 5: `pages/OperatorVerify.jsx`

- `<FeedbackForm>` matching `FeedbackIn` exactly: `site_key` (select), `date` (date picker), `actual_viz_m` (range input 0–40), `actual_current` (select), `comments` (textarea)
- Submit → `POST /api/v1/feedback`
- On success: green toast/banner with `derived_label` + a "Submit another" button that resets the form
- Optional `shop_name` field

### Shared components

- `<Layout>` — responsive nav bar + footer, wraps all pages
- `<RiskCard>` — accepts `label`, `value`, `subtitle`; background color from `riskColor(label)` utility
- `<SiteSelector>` — reads/writes `SiteContext`; renders as styled dropdown

### Design tokens (`styles/index.css`)

```css
:root {
  /* Risk colors */
  --color-risk-low: #10b981;
  --color-risk-moderate: #f59e0b;
  --color-risk-high: #ef4444;
  --color-risk-low-bg: #ecfdf5;
  --color-risk-moderate-bg: #fffbeb;
  --color-risk-high-bg: #fef2f2;

  /* Neutral palette */
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f8fafc;
  --color-text-muted: #94a3b8;
  --color-border: #334155;
  --color-accent: #38bdf8;

  /* Agent chat colors */
  --color-agent-bg: #1a2744;
  --color-user-bubble: #2563eb;
  --color-agent-bubble: #334155;
  --color-tool-trace: #6366f1;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;

  /* Radii */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}
```

### Vite proxy (`vite.config.js`)

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

### Routing (`App.jsx`)

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Forecast from './pages/Forecast';
import Agent from './pages/Agent';
import Historical from './pages/Historical';
import Experiments from './pages/Experiments';
import OperatorVerify from './pages/OperatorVerify';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="forecast" element={<Forecast />} />
          <Route path="agent" element={<Agent />} />
          <Route path="historical" element={<Historical />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="verify" element={<OperatorVerify />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

---

## 14. Alerts (`backend/app/lib/alerts.py`)

### Components

```python
class AlertStore:
    def __init__(self) -> None: ...
    def was_recently_sent(self, site_key: str, kind: str, ts_hour: datetime) -> bool: ...
    def record(self, site_key: str, kind: str, ts_hour: datetime,
               channel: str, message: str) -> int: ...
    def recent(self, limit: int = 20) -> list[AlertDB]: ...

def evaluate(site_key: str, hourly_window_json: str) -> list[dict]:
    # Returns list of {kind, ts_hour, message} for hours where risk crosses threshold

def dispatch(site_key: str, hourly_window_json: str,
             send_emails: bool = True) -> list[int]:
    """Idempotent: dedupe via AlertStore.was_recently_sent before recording.
    Returns list of inserted alert ids."""

def send_email(subject: str, body: str) -> bool:
    """Optional SMTP. Reads SMTP_HOST, SMTP_PORT (default 587),
    SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO from env. Returns False if
    not configured — never raises."""
```

### `/api/v1/alerts/run` (POST)

Loops over all sites, calls `evaluate` then `dispatch` with `send_emails=True`.

In addition, the **LLM Agent** can autonomously compose and submit alert messages via the `submit_alert` tool, using natural language that is more informative than template-based alerts.

Returns `{"site_results": [{"site_key": "...", "alerts_created": 3}, ...]}`.

### Idempotency contract (this is what the tests assert)

Calling `dispatch` twice in a row with the same `(site_key, kind, ts_hour)` MUST NOT create duplicate rows. The unique key is the `(site_key, kind, ts_hour)` triple; the test asserts the second call returns an empty list.

---

## 15. Tests — minimum 30 (backend 20 + frontend 10)

### Backend tests (`backend/tests/`)

Use pytest with `tmp_path` for artifact isolation and a fixture that monkeypatches `MODEL_PATH` and `METRICS_PATH` to temp files.

| File | Count | Covers |
|---|---|---|
| `test_features.py` | 4 | Schema correctness, 24h/48h/3h rolling windows, synthetic fallback, `is_muck_site` flag |
| `test_lstm.py` | 3 | LSTM train produces metrics, loss convergence over epochs, predict_proba output shape |
| `test_xgb.py` | 3 | XGBoost train + persist + predict_proba round-trip, tiny-dataset fallback, `feature_importance` shape |
| `test_agent.py` | 3 | Agent tool-calling dispatches correctly, briefing generation returns expected fields, graceful fallback when OpenAI unavailable |
| `test_api.py` | 4 | `/health`, `/sites`, `/forecast?site=...`, `/feedback` happy path |
| `test_alerts.py` | 3 | `AlertStore.was_recently_sent` idempotency, evaluate thresholds, `send_email` returns `False` when SMTP unconfigured |
| **Subtotal** | **20** | |

`pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

### Frontend tests (`frontend/src/__tests__/`)

Use Vitest + React Testing Library.

| File | Count | Covers |
|---|---|---|
| `SiteSelector.test.jsx` | 2 | Renders sites from API mock, selection updates context |
| `RiskCard.test.jsx` | 2 | Correct color-coding per risk level, label display |
| `FeedbackForm.test.jsx` | 2 | Input validation, submit calls API with correct payload |
| `Forecast.test.jsx` | 2 | Renders 24 hour cards, highlights optimal window |
| `AgentChat.test.jsx` | 1 | Renders chat interface, sends message on submit |
| `ExperimentResults.test.jsx` | 1 | Renders comparison table with mock data |
| **Subtotal** | **10** | |

Add more for any non-trivial branch you write.

---

## 16. Deployment

### `render.yaml` (two services: web + static)

```yaml
services:
  - type: web
    name: seasid-api
    runtime: python
    plan: free
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.api.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: PYTHON_VERSION
        value: "3.11"
      - key: OPENAI_API_KEY
        sync: false
      - key: WORLDTIDES_API_KEY
        sync: false
      - key: SMTP_HOST
        sync: false
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false
      - key: ALERT_EMAIL_TO
        sync: false

  - type: static
    name: seasid-ui
    buildCommand: cd frontend && npm ci && npm run build
    staticPublishPath: frontend/dist
    headers:
      - path: /*
        name: Cache-Control
        value: public, max-age=3600
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

### `Dockerfile` (backend — non-Render hosts)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `deploy/Dockerfile.frontend` (React → nginx static)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### `docker-compose.yml`

```yaml
version: "3.9"
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports: ["8000:8000"]
    volumes: ["./backend/data:/app/data"]
    env_file: backend/.env

  frontend:
    build:
      context: .
      dockerfile: deploy/Dockerfile.frontend
    ports: ["3000:80"]
    depends_on: [api]
    environment:
      - VITE_API_URL=http://api:8000
```

### `deploy/nginx.conf` (bare-metal VPS)

- `/` → serves React static build from `frontend/dist/`
- `/api/` → reverse proxy to FastAPI (`:8000`), preserving the `/api` prefix
- `/docs` and `/openapi.json` proxied under `/docs` and `/openapi.json`

### `deploy/seasid.service`

systemd unit for the FastAPI backend only. The React frontend is served as static files via nginx — no separate process needed.

---

## 17. `.env.example`

```env
# Required: OpenAI API key for the LLM Agent
OPENAI_API_KEY=

# Optional: Use GPT-4o for higher quality (default: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini

# Optional: tide heights (SeaSID degrades gracefully if missing)
WORLDTIDES_API_KEY=

# Optional: SMTP for email alerts (returns False if any field missing)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_TO=

# Used by the React frontend in production (Vite injects at build time)
VITE_API_URL=http://localhost:8000
```

---

## 18. README (required sections, in order)

1. Project name + tagline + 1-sentence pitch
2. The problem (numbers: ~50–80 dive shops, ~15 000 divers/yr, 24h no local forecast)
3. Why existing tools fail (Windy/Magicseaweed: regional-only; FB posts: unstructured)
4. **AI approach**: Dual AI system — LSTM for prediction, LLM Agent for reasoning
5. Tech stack table (mirror section 2)
6. Setup — separate instructions for backend and frontend:
   - Backend: `cd backend && pip install -r requirements.txt`
   - Frontend: `cd frontend && npm install`
7. Run:
   - Backend: `init_db → seed_history → expand_dataset → train_model → run_api`
   - Frontend: `npm run dev` (separate terminal)
8. FastAPI endpoints table (mirror section 12)
9. **Experimental results**: summary table of model comparison + key findings
10. Project layout (mirror section 3)
11. Live example: `curl /api/v1/forecast?site=dauin_muck | jq` (paste real output, not a stub)
12. Agent demo: example conversation with the LLM agent
13. Deployment matrix (Render / Docker / nginx+systemd)
14. Team roles (section 21)
15. License (MIT)

---

## 19. `backend/requirements.txt` (pinned)

```
fastapi>=0.110
uvicorn[standard]>=0.27
sqlalchemy>=2.0
pydantic>=2.6
pandas>=2.2
numpy>=1.26
scikit-learn>=1.4
xgboost>=2.0
torch>=2.2
openai>=1.30
tiktoken>=0.7
joblib>=1.3
requests>=2.31
python-dotenv>=1.0
matplotlib>=3.8
seaborn>=0.13
pytest>=8.0
httpx>=0.27
```

### `frontend/package.json` (key dependencies)

```json
{
  "name": "seasid-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.7",
    "react": "^18.3",
    "react-dom": "^18.3",
    "react-markdown": "^9.0",
    "react-router-dom": "^6.23",
    "recharts": "^2.12"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4",
    "@testing-library/react": "^15.0",
    "@vitejs/plugin-react": "^4.3",
    "jsdom": "^24.0",
    "vite": "^5.4",
    "vitest": "^1.6"
  }
}
```

---

## 20. Build order (do it in this sequence)

1. **Backend skeleton** — empty files, `requirements.txt`, `.gitignore`, `pytest.ini`. `pip install -r requirements.txt` clean.
2. `app/lib/sites.py` — site registry + a smoke import.
3. `app/lib/db.py` — SQLAlchemy models + `init_db()` with WAL mode. Smoke `python -m scripts.init_db`.
4. `app/lib/weather.py` + `tides.py` + `ingest.py` — clients with retry + fallback. Pull 48h for both sites.
5. `app/lib/features.py` — `build_features()` + `build_sequence()` with the 11 columns. Write `test_features.py` first.
6. `app/lib/scoring.py` — rule-based viz/current labels (Baseline 1).
7. `scripts/seed_history.py` + `scripts/expand_dataset.py` — seed CSV labels + pull 90-day historical + generate synthetic labels.
8. `app/lib/model_xgb.py` — XGBoost baseline (Baseline 2). Write `test_xgb.py` first.
9. `app/lib/model_lstm.py` — LSTM/GRU deep learning model. Write `test_lstm.py` first.
10. `app/lib/model.py` — unified interface. `scripts/train_model.py` — train both models, save artifacts. Confirm LSTM achieves higher F1 than XGBoost on validation set.
11. `app/lib/experiments.py` + `scripts/run_experiments.py` — full experiment suite. Run it; inspect `experiment_results.json`.
12. `app/lib/agent.py` + `agent_tools.py` — LLM Agent with tool-calling. Write `test_agent.py` first.
13. `app/lib/alerts.py` — `AlertStore` + `evaluate` + `dispatch` + `send_email`. Write `test_alerts.py` first.
14. `app/api/` — schemas → services → main (with CORS configured for `http://localhost:5173`). Write `test_api.py` first. Boot the API; hit every endpoint with `curl` and paste the responses into the README.
15. **Frontend scaffold** — `npm create vite@latest ./` in `frontend/`, install deps (`react-router-dom`, `recharts`, `axios`, `react-markdown`).
16. `src/api/client.js` — Axios wrapper pointing at `VITE_API_URL` (defaults to empty string for proxy mode).
17. `src/context/SiteContext.jsx` + `src/hooks/` — data fetching layer (including `useAgent` and `useExperiments`).
18. `src/components/` — build bottom-up: `RiskCard` → `HourCard` → `AlertBanner` → charts → `AgentChat` → `DiveBriefing` → `ExperimentResults`.
19. `src/pages/` — `Home` → `Forecast` → `Agent` → `Historical` → `Experiments` → `OperatorVerify`.
20. `src/styles/` — design tokens in `index.css`, CSS modules per component, responsive breakpoints.
21. Frontend tests — Vitest + React Testing Library.
22. `deploy/` — nginx config, Dockerfiles, docker-compose.
23. `render.yaml` — updated for static frontend + OpenAI env var.
24. `README.md` — write last, after everything actually runs. Include experiment results table and agent demo.

---

## 21. Team roles (4–5 members)

| Role | Scope | Key deliverables |
|------|-------|------------------|
| **ML Engineer** | LSTM/GRU model, training pipeline, feature engineering, experiments, ablation studies | `model_lstm.py`, `model_xgb.py`, `experiments.py`, `run_experiments.py`, experiment results |
| **Agent Developer** | LLM agent, tool definitions, prompt engineering, briefing generation | `agent.py`, `agent_tools.py`, system prompt, agent chat UX |
| **Backend Engineer** | FastAPI API, database, data ingestion, weather/tide clients, alert system | `api/`, `db.py`, `weather.py`, `tides.py`, `ingest.py`, `alerts.py` |
| **Frontend Engineer** | React UI, all pages including Agent chat and Experiment dashboard | All `components/`, `pages/`, `styles/`, `hooks/` |
| **Integration & DevOps** | Docker, deployment, testing, README, presentation materials | `deploy/`, `render.yaml`, `docker-compose.yml`, `README.md`, slides |

If team has 4 members, merge **Integration & DevOps** into other roles (e.g., Backend Engineer handles deployment, Frontend Engineer handles README).

---

## 22. Presentation structure

### July 18 — Project Plan Presentation

1. **Problem statement**: Philippine dive operators lose money to unpredictable underwater conditions
2. **Proposed AI approach**: Dual system — LSTM deep learning for time-series prediction + LLM Agent for natural-language reasoning and autonomous alerts
3. **Architecture diagram**: Feature engineering → LSTM → P(no-go) → LLM Agent → Dive briefing
4. **Experimental plan**: 4 models × 4 ablation studies × 5 metrics
5. **Dataset strategy**: Open-Meteo historical (90 days) + synthetic labels + curated CSV (~150 real)
6. **Tech stack**: FastAPI + React + PyTorch + OpenAI
7. **Team roles** and division of work
8. **Timeline**: 5 days between plan and final presentation — prioritized task list

### July 23 — Final Project Presentation

1. **System demo**: Live walkthrough → site selection → LSTM forecast → agent briefing → operator verification
2. **LSTM deep dive**: Architecture, training details, loss curves, convergence behavior
3. **Experimental results**: Model comparison table, ROC curves, confusion matrices, ablation findings
4. **Agent capabilities**: Live demo of natural-language Q&A, show tool-calling traces, reasoning chains
5. **Key findings**: Which model wins and why, which features matter most, does the agent add value
6. **Technical challenges**: What was hard, what didn't work, what we'd do differently
7. **Lessons learned and future work**: APScheduler, real FB scraping, Postgres, push notifications

---

## 23. Acceptance criteria (the build is "done" when ALL are true)

### AI / ML

- [ ] LSTM model trains on expanded dataset (2000+ samples) and achieves F1 > 0.75 on test set.
- [ ] XGBoost baseline trains and achieves F1 > 0.65 on test set.
- [ ] `scripts/run_experiments.py` completes and produces `experiment_results.json` with metrics for all 4 models.
- [ ] Loss curves show LSTM training convergence (val loss decreasing over epochs).
- [ ] Confusion matrices, ROC curves, and ablation charts are generated in `data/figures/`.
- [ ] LSTM outperforms XGBoost on at least 3 of 5 metrics (otherwise investigate why).

### Agent

- [ ] `POST /api/v1/agent/chat` returns a natural-language response with tool-call traces.
- [ ] `GET /api/v1/agent/briefing?site=dauin_muck` returns a complete dive briefing with risk level and optimal window.
- [ ] Agent correctly calls tools (forecast, weather, tide, history) and synthesizes results.
- [ ] Agent gracefully handles missing data (e.g., tides unavailable).

### Backend

- [ ] `pytest tests` → ≥ 20 passed, 0 failed.
- [ ] `python -m scripts.init_db && python -m scripts.seed_history && python -m scripts.expand_dataset && python -m scripts.train_model` → exits 0, produces `seasid_lstm.pt`, `seasid_xgb.pkl`, and `seasid_metrics.json`.
- [ ] `python -m scripts.run_api` starts; `curl http://localhost:8000/api/v1/health` returns `"status": "ok"`.
- [ ] `curl http://localhost:8000/api/v1/forecast?site=dauin_muck` returns 24 hours + `model_type: "lstm"` + `ml_bundle_loaded: true` + a non-null `optimal_window`.
- [ ] `curl -X POST http://localhost:8000/api/v1/feedback -d '{"site_key":"dauin_muck","date":"2026-07-09","actual_viz_m":3.5,"actual_current":"High"}'` returns `{"saved_id": N, "derived_label": "no_dive"}`.
- [ ] `curl -X POST http://localhost:8000/api/v1/retrain` returns `{"success": true, ...}`.
- [ ] LSTM model file reloads after a process restart without retraining.
- [ ] SMTP unconfigured → `send_email` returns `False` silently; no traceback.
- [ ] Calling `/api/v1/alerts/run` twice in a row does NOT create duplicate alert rows.

### Frontend

- [ ] `npm run build` in `frontend/` completes with 0 errors.
- [ ] `npm test` in `frontend/` → ≥ 10 passed, 0 failed.
- [ ] React app at `localhost:5173` loads Home page with site selector.
- [ ] Forecast page fetches and renders 24 hourly cards from the API + agent briefing.
- [ ] Optimal window is highlighted visually on the p_bad chart.
- [ ] Agent page renders chat interface and successfully exchanges messages with the agent.
- [ ] Experiments page shows model comparison table and charts.
- [ ] Historical page shows feature importance bar chart and retrain button works.
- [ ] Operator Verify form validates inputs and shows success feedback on submit.
- [ ] Vite dev proxy correctly forwards `/api/*` to `localhost:8000`.
- [ ] Production build (`npm run build`) serves correctly behind nginx.

### Deployment

- [ ] `Dockerfile` builds: `docker build -t seasid-api .` then `docker run -p 8000:8000 seasid-api` serves `/api/v1/health` 200.
- [ ] `docker-compose up` starts both API and frontend.
- [ ] `render.yaml` deploys to a free Render blueprint without manual edits.

---

## 24. Out-of-scope for v1 (call them out in the README)

- APScheduler cron (manual pull today)
- Facebook post scraping (curated CSV + synthetic labels today)
- Push notifications / SMS / webhooks (UI banner + email only)
- Auth / user accounts (single-operator prototype)
- Multi-tenant (single project, multi-site via the registry)
- Postgres migration path (SQLite is fine for v1; the SQLAlchemy layer makes the swap one-line later)
- Server-side rendering / SSR (React SPA with client-side rendering is sufficient for v1)
- Fine-tuning the LLM (using OpenAI API with system prompt engineering; fine-tuning is v2)
- Streaming agent responses (v1 returns complete responses; v2 can add SSE streaming)

---

## 25. Verification commands the agent must run before declaring done

```bash
# ── Backend ──

cd backend

# Clean install
python -m venv .venv
.venv\Scripts\activate           # Windows
pip install -r requirements.txt

# DB + seed + expand + train
python -m scripts.init_db
python -m scripts.seed_history
python -m scripts.expand_dataset
python -m scripts.train_model

# Run experiments
python -m scripts.run_experiments

# Tests
pytest tests -v

# Start API (terminal 1)
python -m scripts.run_api

# Smoke test API (terminal 2)
curl -s http://localhost:8000/api/v1/health | python -m json.tool
curl -s http://localhost:8000/api/v1/sites | python -m json.tool
curl -s "http://localhost:8000/api/v1/forecast?site=dauin_muck" | python -m json.tool | head -40
curl -s -X POST http://localhost:8000/api/v1/feedback \
     -H "Content-Type: application/json" \
     -d '{"site_key":"dauin_muck","date":"2026-07-09","actual_viz_m":3.5,"actual_current":"High","comments":"smoke"}' \
     | python -m json.tool
curl -s -X POST http://localhost:8000/api/v1/retrain -H "Content-Type: application/json" | python -m json.tool
curl -s http://localhost:8000/api/v1/alerts | python -m json.tool

# Agent smoke test
curl -s -X POST http://localhost:8000/api/v1/agent/chat \
     -H "Content-Type: application/json" \
     -d '{"message":"Should I dive at Dauin tomorrow morning?","site_key":"dauin_muck"}' \
     | python -m json.tool
curl -s "http://localhost:8000/api/v1/agent/briefing?site=dauin_muck" | python -m json.tool

# Experiment results
curl -s http://localhost:8000/api/v1/experiments/results | python -m json.tool

# ── Frontend ──

cd frontend

# Install + dev server (terminal 3)
npm install
npm run dev

# Tests (terminal 4)
npm test

# Open http://localhost:5173 and click through all six pages
```

Every `curl` must return 200 with valid JSON. The React app must render all six pages without errors in the browser console.

---

## 26. What success looks like

A repo where:

- `pytest` is green (20+ backend tests),
- `npm test` is green (10+ frontend tests),
- `render.yaml` deploys to Render without manual edits,
- a new contributor can clone → `pip install` + `npm install` → run the commands in section 25 → and have the dashboard live in under 5 minutes,
- the README is honest about what's shipped and what's scoped,
- the **LSTM model is actually an LSTM** — not a placeholder or a comment that says "LSTM-ready",
- the **LLM Agent actually calls tools** and generates real natural-language briefings — not a hardcoded template,
- the **experiment results are real** — trained models, computed metrics, generated plots,
- the model comparison shows LSTM beating XGBoost (or an honest explanation of why it didn't),
- and the React UI feels premium — dark theme, smooth transitions, color-coded risk cards, agent chat interface, responsive on mobile.