# SeaSID Comprehensive Audit — Documentation Index

> **Audit period:** 2026-09-19 → ongoing (no deadline)
> **Method:** every screen, module, and core function is read line-by-line, findings are recorded with `file:line` anchors, and **each audit is followed by targeted web research** against current best practices to surface gaps and improvement opportunities.
> **Status column in each file:** ✅ audited · 🔄 in progress · ⬜ not started

---

## Methodology

Each audit document follows the same six-part structure:

1. **Scope** — exact files, line counts, and the core functions enumerated.
2. **How it works** — a faithful architectural summary with data flow, so findings can be understood without re-reading the code.
3. **Findings** — numbered issues, each with severity, `file:line` anchor, evidence, and impact.
4. **Web research** — what current best practice says for this domain, with sources and dates.
5. **Gap analysis** — delta between the code and best practice.
6. **Recommendations** — prioritized improvements (P0 = do now … P3 = nice-to-have).

### Severity rubric

| Level | Meaning |
|---|---|
| **P0 · Critical** | Data loss, security vulnerability, wrong safety output (this app gates *diver safety* — a wrong "safe" answer is P0) |
| **P1 · High** | Correctness bug, performance cliff, or UX failure users will hit |
| **P2 · Medium** | Maintainability, robustness, or inconsistency that compounds |
| **P3 · Low** | Polish, style, documentation drift |

### Safety lens

SeaSID outputs drive **go/no-go dive decisions**. Every finding is additionally evaluated for whether it could make the system *under-state risk*: stale data presented as fresh, uncalibrated probabilities shown as certainties, forecast fallbacks that silently degrade, thresholds that could be bypassed.

---

## Audit index — backend

| # | Document | Covers | Status |
|---|---|---|---|
| B1 | [01-backend-core.md](backend/01-backend-core.md) | `db.py`, `features.py`, `ingest.py`, `weather.py`, `tides.py`, `sites.py`, `freshness.py`, `scoring.py`, `alerts.py` | ✅ |
| B2 | [02-backend-ml.md](backend/02-backend-ml.md) | `model.py`, `model_lstm.py`, `model_xgb.py`, `calibration.py`, `active_learning.py`, `experiments.py`, training scripts, synthetic data | ✅ |
| B3 | [03-backend-api.md](backend/03-backend-api.md) | `api/main.py`, `api/schemas.py`, `api/services.py`, `api/admin.py`, `user_store.py` | ✅ |
| B4 | [04-backend-security.md](backend/04-backend-security.md) | `auth.py`, `secret_store.py`, `provider_keys.py`, `SECURITY.md` claims vs reality | ✅ |
| B5 | [05-backend-agent.md](backend/05-backend-agent.md) | `agent.py`, `agent_tools.py`, `agent_mcp.py` | ✅ |
| B6 | [06-backend-providers-scrapers.md](backend/06-backend-providers-scrapers.md) | `providers/*`, `scrapers/*`, provider registry contract | ✅ |

## Audit index — frontend

| # | Document | Covers | Status |
|---|---|---|---|
| F1 | [07-frontend-infra.md](frontend/07-frontend-infra.md) | `api.js`, `AuthContext`, **`LoginPage`**, `ThemeContext`, `forecastCache`, **`useMediaQuery`, `lib/utils`**, `main.jsx`, `App.jsx`, Vite/vitest/eslint config, routing | ✅ |
| F2 | [08-frontend-dashboard-forecast.md](frontend/08-frontend-dashboard-forecast.md) | `Dashboard.jsx`, `Forecast.jsx`, `ForecastCard`, `ForecastChart`, `ForecastProvenance`, `PBadChart`, `RiskBadge`, `FreshnessBadge`, `ModelStatusContext`, `ActiveLearningNudge` | ✅ |
| F3 | [09-frontend-map-verify.md](frontend/09-frontend-map-verify.md) | `MapPage.jsx`, `Verify.jsx`, `SiteSelector`, `ConfirmDialog` | ✅ |
| F4 | [10-frontend-settings-profile.md](frontend/10-frontend-settings-profile.md) | `Settings.jsx`, `Profile.jsx`, `ApiKeysAdmin`, `UsersAdmin`, `UserMenu` | ✅ |
| F5 | [11-frontend-agent-chat.md](frontend/11-frontend-agent-chat.md) | `AgentFab.jsx`, `Agent.jsx`, `ChatComposer`, `Message`, `MarkdownResponse`, `ToolCall*`, `ThinkingBlock`, `StreamingDots`, `streaming-thinking.js`, `registry.js` | ✅ |
| F6 | [12-frontend-cockpit-experiments.md](frontend/12-frontend-cockpit-experiments.md) | `Layout.jsx`, `cockpit/*` (SidebarNav, CommandPalette, StatusBar, MobileDrawers, useLayoutPrefs), `Experiments.jsx`, `Skeleton`, `Dropdown`, `Icons`, **`components/ui/*` primitives (22 files spot-checked + import census)** | ✅ |

## Audit index — cross-cutting

| # | Document | Covers | Status |
|---|---|---|---|
| C1 | [13-tests-validation.md](cross-cutting/13-tests-validation.md) | Backend pytest suite, frontend vitest suite, lint gates, pre-push hook, CI posture | ✅ |
| C2 | [14-deployment-infra.md](cross-cutting/14-deployment-infra.md) | Dockerfile, docker-compose, cloudflared, dev.py, secrets-in-deployment | ✅ |
| C3 | [15-roadmap.md](cross-cutting/15-roadmap.md) | Consolidated, prioritized improvement roadmap across all audits | ✅ |

---

## Headline statistics (final — 2026-09-19)

**Coverage:** ~28,900 lines audited line-by-line (18.6 k backend / 10.3 k frontend incl. the Login screen, shared hooks/utils, and all 22 `ui/*` primitives) across 6 backend, 6 frontend, and 3 cross-cutting documents. Both test suites **executed** (backend 257 pass / 1 skip; frontend 1 fail / 198 pass — see C1); both linters executed (green). Provider behavior verified against live API docs; web research performed after every area audit with sources cited in-line.

**Finding totals:** 13 × P0 · 45 × P1 · 86 × P2 · 71 × P3 → **[15-roadmap.md](cross-cutting/15-roadmap.md)** has the consolidated, prioritized backlog and a suggested execution order.

**Top five if you read nothing else:**
1. The Open-Meteo providers request only ~1 h of future data, so the 48 h forward forecast is computed on empty/calm-default feature windows (B6/F-B6-01).
2. Provider outages silently fabricate plausible weather that is persisted as real, source-less observations (B1/F-B1-01).
3. Ten API routes — including ingest, alerts/run, and the LLM chat proxy — ship without the authentication the docs promise (B3/F-B3-01).
4. The model-quality tier gate is unreachable dead code; an unqualified LSTM serves production, and the calibrator is trained on the opposite label semantics (B2/F-B2-01, F-B2-02).
5. The Docker image bakes the live database *and* its master decryption key into the image layers (C2/F-C2-01).
