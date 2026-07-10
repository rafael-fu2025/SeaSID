# 🌊 SeaSID — Sea Safety Intelligence Dashboard

**AI-powered dive condition forecasting** for Dauin & Apo Island, Philippines.

SeaSID combines deep learning (LSTM), traditional ML (XGBoost), and an LLM-powered agent to predict diving safety conditions from real-time weather, wave, and tide data.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Frontend (Vite)                           │
│  Dashboard │ Agent Chat │ Experiments │ Verify   │
└──────────────────────┬──────────────────────────┘
                       │ REST API
┌──────────────────────┴──────────────────────────┐
│  FastAPI Backend                                 │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ LSTM (PyTorch)│ │ XGBoost  │ │ LLM Agent    │ │
│  │ Primary Model │ │ Baseline │ │ (OpenAI)     │ │
│  └─────────────┘ └──────────┘ └──────────────┘ │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Open-Meteo   │ │WorldTides│ │ SQLite (WAL) │ │
│  │ Weather API  │ │ Tide API │ │ 6 Tables     │ │
│  └─────────────┘ └──────────┘ └──────────────┘ │
└─────────────────────────────────────────────────┘
```

## Features

| Feature | Description |
|---------|-------------|
| **LSTM Forecast** | PyTorch LSTM with 24h sliding window over 11 weather features |
| **XGBoost Baseline** | Traditional ML comparison with cross-validation |
| **Rule-Based Baseline** | Hand-tuned threshold scoring for cold-start |
| **LLM Agent** | OpenAI GPT-4o with 6 function-calling tools for natural-language Q&A |
| **Experiment Suite** | 4 models × 4 ablations × 5 metrics with automated plots |
| **Operator Verification** | Feedback loop for continuous model improvement |
| **Real-Time Alerts** | Threshold-based alerts (wind, rain, waves, currents) |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- OpenAI API key (for the LLM Agent)

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
.venv/Scripts/activate  # Windows
# source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
# Optional: add STORMGLASS_API_KEY and AQICN_API_KEY to enable v2.1 features

# Initialize database and seed data
python -m scripts.init_db
python -m scripts.seed_history

# (Optional) Expand dataset with 90 days of historical weather
python -m scripts.expand_dataset

# (Optional) Train ML models
python -m scripts.train_model

# Start the API server
python -m scripts.run_api --reload
```

### Optional providers (v2.1)

| Env var | Default | Purpose |
|---|---|---|
| `SEASID_PROVIDER_WEATHER` | `open_meteo` | Surface weather (precip, wind, basic waves) |
| `SEASID_PROVIDER_MARINE` | `open_meteo` | Marine augmentation (set to `stormglass` to enable) |
| `SEASID_PROVIDER_AIR` | `off` | Air quality (set to `aqicn` to enable) |
| `STORMGLASS_API_KEY` | — | Storm Glass API key (free tier: 50 req/day) |
| `AQICN_API_KEY` | — | AQICN API key (free tier: 1000 req/day) |

See [`backend/app/lib/providers/README.md`](backend/app/lib/providers/README.md) for the full provider contract and migration guide.

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (connects to backend on :8000)
npm run dev
```

### 3. Open the Dashboard

- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/sites` | List dive sites |
| GET | `/api/v1/forecast?site=<key>` | 48-hour forecast |
| POST | `/api/v1/ingest` | Pull weather + marine + air + tide data |
| POST | `/api/v1/verify` | Submit operator verification |
| GET | `/api/v1/labels?site=<key>` | Label history |
| GET | `/api/v1/alerts?site=<key>` | Recent alerts |
| POST | `/api/v1/agent/chat` | Agent conversation |
| GET | `/api/v1/agent/briefing?site=<key>` | Auto-generated briefing |
| GET | `/api/v1/experiments/results` | Experiment results |
| POST | `/api/v1/experiments/run` | Run experiment suite |

## 11-Feature Vector

| # | Feature | Window | Unit | Source |
|---|---------|--------|------|--------|
| 1 | precip_24h_mm | 24h sum | mm | Open-Meteo |
| 2 | precip_48h_mm | 48h sum | mm | Open-Meteo |
| 3 | precip_recent_3h | 3h sum | mm | Open-Meteo |
| 4 | wind_max_24h_kmh | 24h max | km/h | Open-Meteo |
| 5 | wind_mean_24h_kmh | 24h mean | km/h | Open-Meteo |
| 6 | wave_max_24h_m | 24h max | m | Open-Meteo Marine |
| 7 | sea_temp_mean_24h | 24h mean | °C | Open-Meteo Marine |
| 8 | tide_max_24h_m | 24h max | m | WorldTides |
| 9 | tide_min_24h_m | 24h min | m | WorldTides |
| 10 | tide_range_24h_m | max − min | m | WorldTides |
| 11 | is_muck_site | static | 0/1 | site registry |
| 12 | aqi_recent | current | AQI | AQICN (optional) |
| 13 | pm25_recent | current | µg/m³ | AQICN (optional) |
| 14 | wave_period_s_mean | 24h mean | s | Storm Glass (optional) |

The first 11 features are the **v2 contract**; columns 12-14 are the **v2.1 extension** for air-quality (AQICN) and marine augmentation (Storm Glass). Defaults are used when the optional providers are not configured.

## Running Tests

```bash
cd backend
.venv/Scripts/python -m pytest tests/ -v
```

**Test count: 45 tests** (11 features + 8 LSTM + 7 XGBoost + 10 agent + 9 API)

## Docker

```bash
# Build and run
docker compose up --build

# Or just the backend
docker build -t seasid .
docker run -p 8000:8000 -e OPENAI_API_KEY=your-key seasid
```

## Project Structure

```
SeaSID/
├── backend/
│   ├── app/
│   │   ├── api/           # FastAPI routes, schemas, services
│   │   └── lib/           # Core library
│   │       ├── agent.py         # LLM Agent (OpenAI function-calling)
│   │       ├── agent_tools.py   # 6 tool definitions
│   │       ├── alerts.py        # Threshold-based alert system
│   │       ├── db.py            # SQLAlchemy models (6 tables)
│   │       ├── experiments.py   # Model comparison + ablation
│   │       ├── features.py      # 11-feature engineering
│   │       ├── ingest.py        # Data ingestion
│   │       ├── model.py         # Unified model interface
│   │       ├── model_lstm.py    # PyTorch LSTM/GRU
│   │       ├── model_xgb.py     # XGBoost baseline
│   │       ├── scoring.py       # Rule-based baseline
│   │       ├── sites.py         # Site registry
│   │       ├── tides.py         # WorldTides client
│   │       └── weather.py       # Open-Meteo client
│   ├── data/              # SQLite DB, models, CSVs
│   ├── scripts/           # CLI utilities
│   └── tests/             # pytest suite (45 tests)
├── frontend/
│   └── src/
│       ├── components/    # Navbar, ForecastCard, AgentChat, etc.
│       └── pages/         # Dashboard, Agent, Experiments, Verify
├── Dockerfile
├── docker-compose.yml
└── SeaSID.md              # Full specification
```

## Team

| Role | Responsibility |
|------|---------------|
| ML Engineer | LSTM model, feature engineering, experiments |
| Agent Developer | OpenAI integration, tools, briefing generation |
| Backend Engineer | FastAPI, database, data pipeline |
| Frontend Engineer | React UI, design system, components |
| DevOps | Docker, deployment, CI/CD |

## License

Academic project — Foundation University, Dumaguete City.
