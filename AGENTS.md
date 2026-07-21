# AGENTS.md — SeaSID navigation entrypoint

SeaSID (Sea Safety Intelligence Dashboard) is an AI dive-condition forecaster
for Dauin & Apo Island, Philippines. A **FastAPI** backend (`:8000`) serves an
**LSTM** (primary), **XGBoost** (baseline), and rule-based forecast plus an
**LLM agent**, all fed by a **pluggable weather/marine/air provider registry**
over a WAL-mode **SQLite** database. A **React 18 + Vite** frontend (`:5173`)
renders the dashboard, map, experiments, verification, and a floating AI chat.

This file is a router, not a spec. For depth, read the linked docs below —
do not duplicate their content here.

| Read this | For |
|---|---|
| [README.md](README.md) | Quick start, endpoints, 14-feature vector, dev accounts |
| [SECURITY.md](SECURITY.md) | Provider-key encryption, auth secrets, leak response |
| [SeaSID.md](SeaSID.md) | Original v1 spec + v1→v2.1 drift notes |
| [backend/app/lib/providers/README.md](backend/app/lib/providers/README.md) | Provider registry contract |

## Directory route

**`backend/app/`** — Python service.
- `api/` — FastAPI routes ([main.py](backend/app/api/main.py)), Pydantic
  `schemas.py`, business logic `services.py`, admin routes `admin.py`.
- `lib/` — core library: `agent.py` + `agent_tools.py` + `agent_mcp.py`
  (LLM agent), `providers/` + `scrapers/` (external data), `ingest.py`,
  `features.py`, `weather.py`, `tides.py`, `model*.py`, `scoring.py`,
  `calibration.py`, `active_learning.py`, `freshness.py`, `sites.py`, `db.py`,
  `provider_keys.py`.
- `auth.py`, `secret_store.py` — auth + secret-at-rest (see high-risk below).

**`frontend/src/`** — React app.
- `pages/` — Dashboard, Forecast, MapPage, Experiments, Verify, Settings,
  Profile, Agent.
- `components/` — UI incl. `agent/` (chat), `admin/` (users + API keys),
  `cockpit/` (nav), `ui/` (shadcn primitives).
- `api.js` — backend client · `auth/` — login/session · `agent/registry.js` —
  agent tool render registry · `theme/`, `hooks/`, `lib/`.

**`backend/scripts/`** — CLI tools, run as modules from `backend/`
(`python -m scripts.<name>`): `init_db`, `seed_history`, `expand_dataset`,
`train_model`, `run_experiments`, `run_api`, and the schema migrations
`migrate_v21` / `migrate_v22` / `migrate_v23`.

## High-risk — change with care

| File(s) | Why sensitive | Guardrail |
|---|---|---|
| [backend/app/secret_store.py](backend/app/secret_store.py) | Encrypts provider keys at rest; envelope-format changes can make existing keys + `backend/data/seasid.key` undecryptable | Keep the format back-compatible; never log plaintext; see SECURITY.md |
| [backend/app/auth.py](backend/app/auth.py) | Bearer-token signing, roles, dev-default accounts | Don't weaken defaults; production sets `SEASID_AUTH_SECRET` + explicit users |
| `backend/scripts/migrate_v2*.py` | Forward-only `ALTER TABLE` on `seasid.db` | Keep idempotent (`PRAGMA table_info` guard); back up the DB first |
| [backend/app/lib/agent_tools.py](backend/app/lib/agent_tools.py) | 7 tools the LLM can invoke against live data | Validate args (`_require_site_key`); keep tools read-safe |
| [backend/app/lib/agent_mcp.py](backend/app/lib/agent_mcp.py) | Spawns the MiniMax MCP subprocess with an API key; grants web search | Never leak the key; keep the graceful "MCP unavailable" fallback |

## Lint

Both stacks have a lint layer. Run it first on any code change — it is fast and
prints `file:line: rule` so you can fix the exact location.

| Stack | Command (from the stack dir) | Config |
|---|---|---|
| Backend | `python -m ruff check .` (add `--fix` for safe auto-fixes) | [backend/pyproject.toml](backend/pyproject.toml) |
| Frontend | `npm run lint` (add `-- --fix` for safe auto-fixes) | [frontend/eslint.config.js](frontend/eslint.config.js) |

Prefer fixing the reported line over loosening a rule. When a rule is genuinely
wrong for one line, use a scoped, commented `# noqa: <CODE>` (Python) or
`// eslint-disable-next-line <rule>` (JS), never a blanket ignore.

## When you change X, run Y

Backend tests need `backend/` as CWD (`pytest.ini` → `testpaths = tests`).

| Change | Run |
|---|---|
| Any backend code | `cd backend && python -m ruff check . && python -m pytest tests/ -v` |
| `providers/`, `scrapers/`, `ingest.py`, `features.py`, `weather.py`, `tides.py` | `cd backend && python -m ruff check . && python -m pytest tests/test_providers.py tests/test_features.py tests/test_phase6_scrapers.py -v` |
| `agent.py`, `agent_tools.py` | `cd backend && python -m ruff check . && python -m pytest tests/test_agent.py tests/test_agent_arg_validation.py -v` |
| `agent_mcp.py` (MCP) | `cd backend && python -m ruff check . && python -m pytest tests/test_mcp_minimax.py -v` |
| `auth.py`, `admin.py`, `user_store.py` | `cd backend && python -m ruff check . && python -m pytest tests/test_auth.py tests/test_admin_users.py -v` |
| `secret_store.py`, `provider_keys.py` | `cd backend && python -m ruff check . && python -m pytest tests/test_admin_api_keys.py -v` |
| `model*.py`, `calibration.py` | `cd backend && python -m ruff check . && python -m pytest tests/test_lstm.py tests/test_xgb.py tests/test_phase7_calibration.py -v` |
| `api/` routes or schemas | `cd backend && python -m ruff check . && python -m pytest tests/test_api.py -v` then `python -m scripts.run_api --reload` |
| `db.py` schema | add `scripts/migrate_v2N.py`, run `cd backend && python -m scripts.migrate_v2N`, then `ruff check .` + the backend suite |
| Any `frontend/src` code | `cd frontend && npm run lint && npm test` |
| Frontend types / build | `cd frontend && npm run typecheck && npm run build` |

**Validation gate — full pre-PR check.** Every command must exit 0:

```bash
cd backend  && python -m ruff check . && python -m pytest tests/ -v
cd frontend && npm run lint && npm run typecheck && npm test
```

The [`githooks/pre-push`](githooks/pre-push) hook enforces this gate on `git push`
(ruff + backend pytest when `backend/` changed; eslint + vitest when `frontend/`
changed). Install it once per clone: `sh githooks/install.sh` (Windows:
`pwsh -File githooks/install.ps1`). Docker smoke: `docker compose up --build`.

## Worked example — "add a weather provider"

1. Subclass `WeatherProvider` (or `MarineProvider` / `AirQualityProvider`) in
   [backend/app/lib/providers/base.py](backend/app/lib/providers/base.py) and
   implement its `fetch_*` method(s), returning the canonical units documented
   there.
2. If it needs a key, resolve it through
   [backend/app/lib/provider_keys.py](backend/app/lib/provider_keys.py) and
   tolerate a missing key (return empty data + a warning log).
3. Register it in a `_build_*()` branch of
   [backend/app/lib/providers/registry.py](backend/app/lib/providers/registry.py),
   keyed off the `SEASID_PROVIDER_WEATHER` value.
4. Ingest and features pick it up automatically through the registry
   (`ingest.py` → `features.py`) — no route or schema changes needed.
5. Validate: `cd backend && python -m ruff check . && python -m pytest tests/test_providers.py -v`.

Deeper contract + rate-limit notes:
[backend/app/lib/providers/README.md](backend/app/lib/providers/README.md).

## Learning & decisions

**Durable learning owner:** [LESSONS.md](LESSONS.md) — the Lessons & Checks Log.
It exists so recurring failures become maintained guards instead of tribal
knowledge, and it carries one binding rule:

> **Whenever a recurring failure gets a new check, add a one-line entry to
> [LESSONS.md](LESSONS.md) naming the trigger, the added check, and where it
> runs.**

Apply this in the same change that adds the check — after fixing a repeat bug,
stabilizing a flaky test, or guarding a spec/doc drift. The seeded entries
(roadmap fixes #11–15 and the Windows test-harness guards in
[backend/tests/conftest.py](backend/tests/conftest.py)) show the expected
format.
