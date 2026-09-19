# C3 — Consolidated Findings & Prioritized Improvement Roadmap

> Every finding from audits B1–B6, F1–F6, C1–C2, deduplicated, cross-referenced, and ranked.
> Severity rubric and method: see [README.md](../README.md). File:line evidence lives in the per-area docs.

---

## 0. Executive summary

**258 backend tests and 199 frontend tests pass** (one frontend test currently fails — C1), both linters are green, and the codebase is far above typical academic quality: documented provenance surfaces, a calibration layer, time-aware splits with purge, LRU key rotation, and an SSE experiment pipeline. But the audit surfaced **13 P0-class issues**, and they cluster around one theme: **the system fails silently toward "safe."** Fabricated calm weather on API outages, a forward forecast computed on empty feature windows, a quality gate that exists only as dead code, a calibrator trained on the wrong label semantics, unauthenticated write endpoints, placebo settings, and an image that ships the encryption key alongside the encrypted database.

The single most consequential bug is **F-B6-01**: for any ingest ≤168 h, the Open-Meteo providers request exactly **1 hour of future data**, so hours 2–47 of the "48-hour forecast" are computed entirely from calm-default feature windows — while the freshness chips report "live."

| Area | P0 | P1 | P2 | P3 |
|---|---:|---:|---:|---:|
| B1 backend core | 3 | 5 | 9 | 6 |
| B2 ML stack | 2 | 5 | 8 | 4 |
| B3 API layer | 2 | 5 | 9 | 7 |
| B4 security | 1 | 4 | 6 | 4 |
| B5 LLM agent | 1 | 4 | 6 | 5 |
| B6 providers/scrapers | 1 | 2 | 6 | 5 |
| F1 frontend infra | — | 3 | 6 | 6 |
| F2 dashboard/forecast | 2 | 3 | 7 | 6 |
| F3 map/verify | — | 3 | 6 | 5 |
| F4 settings/admin | 2 | 3 | 7 | 5 |
| F5 agent chat | — | 2 | 5 | 5 |
| F6 cockpit/experiments | — | 1 | 4 | 6 |
| C1 tests/gates | — | 3 | 5 | 4 |
| C2 deployment | 1 | 2 | 5 | 3 |
| **Total** | **13** | **45** | **86** | **71** |

---

## 1. P0 — Fix now (safety/security-critical)

Ordered by expected impact on real users:

1. **F-B6-01 · Forward-forecast data window is empty beyond +1 h** — `open_meteo.py:51-52, 92-93` request `forecast_hours = max(1, hours - past_hours)` ≈ 1. Every forward hour past now+1 is scored on calm-default features (zeros + 28 °C + AQI 30) while freshness says "live." Fix: `forecast_hours = max(hours, 48)`, `past_hours = min(hours, 168)`; add a regression test asserting rows exist with `ts > now`; re-ingest all sites.
2. **F-B1-01 · Synthetic weather is persisted as real data on API failure** — `weather.py:100-102, 159-161` + `ingest.py:230`. Remove the fallback from persist paths (return `[]` + warn; let freshness report `unavailable`); keep synthetic behind a test-only env flag; add `source` + `ingested_at` to every insert so bad data is auditable/purgable.
3. **F-B3-01 / F-B4-01 · Ten routes ship without the authentication the docs promise** — ingest, labels, alerts/run, agent chat×2, briefing, tools, experiments run(+results), active-learning×2. Add app-level `dependencies=[Depends(get_current_principal)]` with a public-path allow-list + a structural route-coverage test (C1 rec #1).
4. **F-B2-02 · Calibrator trained on the wrong label semantics** — `train_calibrator.py:61` treats `poor_viz` as "go"; everywhere else it's "no-go." One-line fix + retrain; this directly understates risk on marginal days.
5. **F-B2-01 · The model-quality gate is dead code; an unqualified LSTM serves production** — `model.py:127-187` unreachable. Either re-activate the gates (after fixing honest metrics, B2 rec #3) or delete them and document LSTM-only + publish measured metrics in `/health`.
6. **F-C2-01 · Docker image ships the DB *and* its master key** — no `.dockerignore`; `COPY backend/ .` bakes `seasid.db` + `seasid.key` into layers. Add `.dockerignore`; rotate any pushed credentials.
7. **F-B3-02 / F-F2-02 · Degraded predictions render as safe numbers** — fabricated `p_bad=0.5` (services) can become the "optimal window"; frontend plots null as 0% and never reads `degraded`/`fallback_hours`. Fail to rule-based + label it; exclude degraded hours from `optimal`; render gaps, not zeros.
8. **F-B1-03 · Alerts never run on a schedule** — pull-only `/alerts/run`. Add a background scheduler (30-min) + storm-active dedupe.
9. **F-B1-02 · Missing data is zero-filled toward "calm" everywhere** — feature windows, `_safe_float`, per-window fallbacks, and scraper labels defaulting to `"dive"` (F-B6-03). Fail toward caution: coverage checks + missingness flags + rule-based fallback.
10. **F-B5-01 · Every MCP tool is auto-exposed to the LLM** — add a default allowlist (`web_search,web_browse`) before the upstream package grows more powerful tools.
11. **F-F2-01 · Timestamps render browser-local but are labeled "UTC"** — Dashboard KPI + provenance strip; an 8-hour mislabel for the actual operator population.
12. **F-F4-01/02 · Placebo settings** — tool toggles and default site are stored but consumed by nothing; the copy claims otherwise. Wire them or remove them.
13. **F-C2-02/03 · Docker serves no frontend and boots insecurely by default** — mount StaticFiles (or fix docs), and fail-fast when auth is enabled without an explicit secret.

---

## 2. P1 — High (fix next sprint's worth of effort)

**Data & ML**
- Honest metrics: scaler fit on train only; persisted LSTM metrics from the val block; XGBoost out-of-fold AUC (`model_lstm.py:171-174, 314-316`; `model_xgb.py:96-104`).
- Real marine archive via Open-Meteo Historical Marine API instead of `wave_max_m: 0.0` (`weather.py:176`); Storm Glass `start`/`end` windows (`stormglass.py:98`).
- Label provenance (`per_source`) in experiment results + UI caveat.
- Route `predict()` and active learning through the batched feature builder (kills the N+1 that once caused 30–50 s pages).
- Close the retrain loop: reload model + calibrator after `train_model`/`train_calibrator`; label-count gauges in `/health`.

**Security**
- Rate limiting (login 5/min; chat 10/min; ingest/experiments 2/min) — SlowAPI.
- Runtime re-check of user `enabled`/role in `get_current_principal` (revocation ≤1 request).
- Fail-closed `_parse_site_keys` (`user_store.py:60`); login lockout + failure logging.
- Conversation `owner_id` actually passed from the route (`main.py:449`).
- AES-GCM migration path off the homegrown envelope; TTL cache for decrypted provider keys.
- MCP subprocess least-privilege env + `shutdown()` in lifespan.

**Frontend**
- Fix tool-error status detection in AgentFab (never matches); Dashboard stale-response race (boolean→counter).
- Request timeouts (`AbortSignal.timeout`); route-level code splitting.
- Verify table site column (API omits `site_key`); remove/repurpose the dead operator input; scope the site selector by user.
- Reveal hardening: step-up auth + clipboard auto-clear; "Sign out everywhere" relabel.

**Tests & CI**
- `test_auth_coverage.py` (parametrized over `app.routes`, auth enabled) — would have caught F-B3-01.
- Fix the failing AgentFab test; add GitHub Actions (ruff+pytest / lint+typecheck+vitest).

---

## 3. P2 — Medium (scheduled hygiene)

Highlights among the 86: SQLite `busy_timeout`/synchronous pragmas; SMTP timeout+TLS context; val/test purge + `label_dates` into experiment training; calibrator select/report split; replay-hour unification; CORS wildcard tunnel removal; error-hygiene middleware (no `str(exc)` to clients); bounded attachment lists; sanitized error funnel on the Login screen + rate-limit feedback path (F1 §7, blocked on backend throttling); `ForecastChart.jsx` + Vite scaffold deletion; adopt-or-delete the six unused `ui/*` primitives (`alert`, `textarea`, `popover`, `checkbox`, `scroll-area`, `resizable` + its `react-resizable-panels` dependency); forecast-page briefing generation strategy; ablations + dataset lineage rendered; held-out vs CV metric separation; map provenance aggregation; non-root Docker user + healthcheck; dev deps out of the runtime image; authZ in frontend test coverage; README test-count regeneration; coverage measurement; `no-empty-catch` cleanup; STATUSbar model chip or doc fix.

## 4. P3 — Low (polish backlog)

71 items recorded in the per-area docs: dead code (`MARINE_ARCHIVE_URL`, duplicate air handler, legacy `Dropdown`, `ForecastChart`), naming drift (`all_11` ablation), mojibake glyphs, radix package dedup, font self-hosting, coordinate links, reduced-motion for map pulses, timezone helper consolidation (`timeutil.py`), `.env.example`/compose/code default unification, and similar.

---

## 5. Suggested execution order (if worked sequentially)

1. **Data-truth sprint** (P0 #1, #2, #9 + P1 marine archive/Storm Glass): make the data layer honest. Everything downstream (models, UI, trust) depends on this.
2. **Auth lockdown sprint** (P0 #3 + P1 security block + C1 authZ test + CI): close the gap between SECURITY.md and the code, and make the gap structurally un-reopenable.
3. **Model-integrity sprint** (P0 #4, #5 + P1 honest metrics + retrain loop + label provenance): only then does the served probability mean what the UI says it means.
4. **Degraded-state UX sprint** (P0 #7, #11 + F2 wiring): the UI stops showing fabricated certainty.
5. **Deployment sprint** (P0 #6, #13 + P2 Docker hygiene): image hygiene and fail-fast boot.
6. **Operator-experience sprint** (P0 #8, #12 + P1 frontend block + remaining F-doc items): alerts that run themselves, settings that do things, and the N+1/perf wins.
7. Ongoing: P2/P3 hygiene in dependency order.

---

## 6. Audit completeness statement

- **Every backend module** (`app/*.py`, `app/api/*`, `app/lib/*` incl. providers/scrapers, `scripts/*` core training/expansion) was read and audited; ~18,600 lines.
- **Every frontend screen and shared component** (8 pages incl. the Login screen, 30+ components, hooks/utils, and all 22 `components/ui/*` primitives via direct reads + a full import census) was read and audited; ~10,300 lines. Findings for LoginPage/hooks/utils live in F1 §7 (addendum); ui primitives in F6 §7 (addendum).
- **Both test suites were executed** on the audited tree (257 pass backend; 1 fail/198 pass frontend); both linters executed (pass).
- **Provider API behavior verified against live documentation** (Open-Meteo forecast/marine/archive, Storm Glass, AQICN, WorldTides) — the F-B6-01 and F-B6-02 findings are doc-verified, not stylistic.
- **Web research performed after each area audit** (SQLite concurrency, missing-data imputation, small-sample ML, calibration practice, FastAPI auth/rate-limit posture, OWASP LLM Top-10 + MCP security, crypto storage, JWT/token storage, map UX + tile policy, secrets-display patterns, uncertainty communication, experiment-tracking UI, hook-vs-CI testing, Docker secrets) — each recorded with sources in its parent doc.
