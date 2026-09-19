# B3 — API Layer Audit: main.py, schemas.py, services.py, admin.py, user_store.py

> Audited 2026-09-19 · ~2,250 lines · Security- and safety-lens applied

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `backend/app/api/main.py` | 870 | 20+ FastAPI routes incl. two SSE streaming endpoints |
| `backend/app/api/services.py` | 442 | Forecast pipeline + 5-min cache, verification, labels |
| `backend/app/api/schemas.py` | 358 | Pydantic request/response models |
| `backend/app/api/admin.py` | 303 | Admin users + provider API keys CRUD |
| `backend/app/lib/user_store.py` | 268 | DB-backed users, seeding, password change |

Endpoints audited individually: `/health`, `/auth/login|me|password`, `/sites`, `/forecast`, `/ingest`, `/verify`, `/labels`, `/active-learning/suggestions|summary`, `/alerts`, `/alerts/run`, `/agent/chat(+ /stream)`, `/agent/briefing`, `/agent/tools`, `/experiments/results|run(+ /stream)`, `/admin/users*`, `/admin/api-keys*`, `/admin/provider-configs/*`.

---

## 2. How it works

`main.py` wires a CORS allow-list (env-overridable, includes `*.trycloudflare.com` wildcard), a lifespan `init_db()`, and route handlers that delegate to `services.py` / `app.lib`. Auth is a `Depends(get_current_principal)` bearer-token dependency applied **per-route** (no global router dependency). `services.get_forecast()` is the heart: 5-minute in-memory cache keyed `(site, 5-min bucket, horizon)`, batched feature/sequence builders, batched LSTM inference, per-hour rule-scored viz/current labels, freshness/provenance assembly, and an "optimal window" = argmin p_bad. `admin.py` gates every route behind `ensure_role(principal, "admin")` and never returns raw key values except the explicit `/reveal` endpoint.

---

## 3. Findings

### P0 — Safety-critical / security-critical

**F-B3-01 · Ten routes ship without the authentication the README promises** — `main.py:283-284 (ingest), 335-339 (labels), 351-356 (active-learning/suggestions), 389-390 (active-learning/summary), 424-425 (alerts/run), 449-450 (agent/chat), 468-469 (agent/chat/stream), 504-505 (agent/briefing), 600-601 (experiments/run), 577-578 (experiments/results)`.
README's Authentication section states "forecasts, agent conversations, operator verification, ingestion, alerts, and experiment operations require a token." In code, `Depends(get_current_principal)` is missing from every one of the routes above (the `/experiments/run/stream` sibling *does* have it — the inconsistency proves the omission is accidental, not policy). Concrete consequences:
- `/ingest` (unauthenticated): triggers outbound provider calls + DB writes at will.
- `/agent/chat` + `/briefing` (unauthenticated): open proxy to the paid MiniMax LLM; tokens/owner recorded as NULL; a scanner can burn the API budget.
- `/experiments/run` (unauthenticated): multi-minute CPU-bound training on demand — trivial DoS; concurrent calls also race the module-level model cache.
- `/alerts/run` (unauthenticated): write-side trigger + SMTP emails.
- `/labels` (unauthenticated): exposes the full label history including operator comments.
Fix pattern: apply `dependencies=[Depends(get_current_principal)]` at the app or router level with a public-path allow-list (`/health`, `/sites`, `/auth/login`, `/docs`) so new routes default to protected ([FastAPI security docs](https://fastapi.tiangolo.com), [Auth0 FastAPI best practices](https://auth0.com)).

**F-B3-02 · Degraded hours fabricate P(no-go) = 0.5 and can become the "optimal window"** — `services.py:192` (`p_bad: float = 0.5`), `services.py:218-223` (on LSTM failure the neutral 0.5 is kept, `model_used` stays `"lstm"`), `services.py:242` (`optimal = min(forecast_hours, key=lambda x: x["p_bad"])`).
When the model errors for an hour, the API does not fall back to rules (despite docstrings in `model.py:237` and comments here claiming a "rules fallback" — `p_bad_from_rules` isn't even imported); it emits a *fabricated neutral 0.5*. On a day when every real p_bad > 0.5 (dangerous conditions), the optimal-window computation selects a degraded hour's fake 0.5 and tells the operator the best dive time is that hour. `degraded_reason` is set, but the headline `optimal_window.p_bad` is still a made-up number for a safety decision. Fix: on failure either use the rule-based estimate (correctly labeled) or exclude degraded hours from `optimal` and surface "no trustworthy window".

### P1 — High

**F-B3-03 · `user_store._parse_site_keys` fails open** — `user_store.py:60-69`: corrupt/empty `site_keys_json` → `("*",)` = **all sites**. A truncated DB write or manual edit silently grants global access. Fail closed (empty tuple → deny, or log + restrict to owned site).

**F-B3-04 · No rate limiting anywhere, including `/auth/login`** — whole app. SlowAPI/limiter patterns are standard for FastAPI; the login endpoint is unthrottled (brute-force), and the unauthenticated `/agent/chat` proxy (F-B3-01) is unthrottled LLM spend. [SlowAPI](https://github.com/laurentS/slowapi), [OneUptime guide](https://oneuptime.com).

**F-B3-05 · Verification resubmission returns HTTP 500 instead of 409/update** — `services.py:359-388` inserts `OperatorVerification` guarded by `uq_opver_site_date_operator`; a second submission by the same operator for the same site+date raises `IntegrityError`, which the route maps to 500 (`main.py:328-330` only converts `ValueError` to 400). The UI's ActiveLearningNudge flow makes accidental double-submits likely. Upsert or map to 409.

**F-B3-06 · `get_forecast` cache returns a shared mutable dict by reference** — `services.py:317-321` ("Callers MUST NOT mutate the returned dict"). Every caller within the TTL window receives the *same object*; `main.py` currently doesn't mutate, but any future handler that touches it (e.g. adding a per-request field) corrupts all concurrent responses. Return a deep copy or freeze the shape.

**F-B3-07 · `health()` 500s when the LSTM artifact is missing** — `main.py:199` calls `load_best()` inside the health check, which *raises* `RuntimeError` (F-B2-01 path). A deployment error should make health report `status: "degraded"` + reason — that's exactly what `selected_tier`/`selection_reason` fields exist for — not crash the endpoint monitors poll.

### P2 — Medium

**F-B3-08 · CORS allow-list includes `https://*.trycloudflare.com` with `allow_credentials=True`** — `main.py:86-89, 173-186`. Anyone can mint a trycloudflare quick-tunnel subdomain; wildcarding it with credentials is an open invitation for cross-origin calls from attacker-controlled origins. Bearer-token auth (no cookies) limits exploitability today, but the correct pattern is to inject the *actual* tunnel hostname via `SEASID_ALLOWED_ORIGINS` when a tunnel is used.

**F-B3-09 · `/experiments/run` runs minutes-long training synchronously in the threadpool** — `main.py:600-680`. The `/stream` variant correctly offloads to a daemon thread (`main.py:817`); the blocking variant holds a threadpool worker for the duration and can't be cancelled. Also runs the N+1 feature build (F-B2-06).

**F-B3-10 · `model_used` and `forecast_source` misreport degraded hours** — `services.py:194` sets `source = model_type_str` up front and never updates it on the degraded path, so an hour that actually served a fabricated 0.5 is labeled `model_used: "lstm"`. The schema comment (`schemas.py:42-45`) even documents a `"*+rules_fallback"` value that is never produced.

**F-B3-11 · Internal error details leaked to clients** — every failure path does `raise HTTPException(500, detail=str(exc))` (`main.py:278, 300, 330, 346, 421, 465, 517, 597, 680`). Exception text can include paths, SQL fragments, provider errors. Log full detail server-side; return generic messages + correlation IDs.

**F-B3-12 · Unbounded attachment lists** — `schemas.py:159-160`: `images: list[ChatImage]` (each up to 12 MB) and `documents: list[ChatDocument]` (each 200 k chars) have **no max_items**. A single request can ship ~100 MB+ to `/agent/chat`. Add `max_length=5` (images) / `max_length=10` (documents).

**F-B3-13 · No audit events for sensitive actions** — key reveal (F-B3 `admin.py:250-288` relies on generic access logs), user creation/deletion, role changes, and `/alerts/run` produce no structured audit records. The ADMIN endpoints themselves are properly role-gated (good).

**F-B3-14 · Admin can lock themselves out** — `admin.py:115-123` allows deleting/disabling the last admin account and `update_user_route` allows a self-demotion; no guard or confirmation.

**F-B3-15 · Verify payload accepts arbitrary future dates and unbounded comments** — `schemas.py:93-100` (`date: date` — no upper bound; `comments: str | None` — no max length → unbounded DB write). Add `le=today` semantics and a `max_length` on comments (e.g. 2000).

**F-B3-16 · No pagination/total on `/labels`** — `services.py:406-442` `total` is the *page* count, not the dataset count; the UI cannot show "N more".

### P3 — Low

**F-B3-17 · Version strings disagree** — `main.py:110` (`version="2.0.0"`) vs `schemas.py`/`services` health payload `version="1.0.0"` (`main.py:217`). Single-source from one constant.
**F-B3-18 · Redundant specific trycloudflare hostnames in the default CORS list** — `main.py:86-87` (dead entries once the wildcard exists).
**F-B3-19 · `/agent/tools` boots the MCP subprocess lazily on first GET** — `main.py:520-572`; a monitoring scrape or curious user triggers subprocess spawn. Consider lazy-with-timeout + explicit warmup endpoint.
**F-B3-20 · `ingest` accepts `hours` up to 168 → archive_days default 7 re-pulled on every ingest** — `main.py:293`; fine, but `ingest_site` re-fetches archive even when explicitly ingesting forward-only; a `archive_days=0` request option would help.
**F-B3-21 · `seed_from_auth_loader` checks-then-inserts across two sessions** — `user_store.py:235-240`; race on concurrent boots, mitigated by `create_user`'s unique check.
**F-B3-22 · `Iterable` imported at module bottom with `# noqa: E402`** — `user_store.py:268`; works but reads as an accident.
**F-B3-23 · `_user_to_out` includes escaped-quote artifact** (`we don\\'t` in comment) — `admin.py:128`; cosmetic sign of an automated edit.

---

## 4. Web research (what current best practice says)

1. **Auth coverage** — enforce authentication with a *global* dependency (app/router-level `dependencies=[...]`) plus an explicit public-path allow-list, so a missing per-route dependency can't ship a protected operation open; validate claims; short expiry + refresh. Sources: [FastAPI Security docs](https://fastapi.tiangolo.com) · [Auth0 FastAPI best practices](https://auth0.com) · [WorkOS FastAPI guide](https://workos.com) · [OneUptime auth middleware guide](https://oneuptime.com).
2. **Rate limiting** — SlowAPI (`limiter.limit`) on auth and expensive endpoints; Redis storage for multi-worker deployments. Sources: [laurentS/slowapi](https://github.com/laurentS/slowapi) · [CodeSignal rate limiting](https://codesignal.com) · [FastAPI + Redis limiter walkthrough](https://bryananthonio.com).
3. **Hardening checklist** — HTTPS/HSTS, restricted CORS, security headers, input validation everywhere, SCA scanning. Sources: [Xygeni FastAPI security FAQ](https://xygeni.io).
4. **Audit logging** — ASGI middleware logging method/path/IP/user/status for every request; admin actions and auth failures as structured events; never log tokens/secrets.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Global auth dependency; default-deny routes | Per-route opt-in; 10 routes open | **Major** (P0) |
| Rate limit login + expensive endpoints | None | Major (P1) |
| Fail-closed authorization data | `site_keys_json` corrupt → full access | Major (P1) |
| Never emit fabricated certainty on degraded path | p_bad=0.5 + optimal-window selection | **Major** (P0, safety) |
| Generic errors + correlation IDs, details server-side | `str(exc)` to client | Partial (P2) |
| Bounded request bodies | Message bounded; attachment lists unbounded | Partial (P2) |
| Admin audit trail | None beyond access log | Missing (P2) |
| Health endpoint reflects degraded deps | 500s when model missing | Partial (P1) |
| Role-gated admin surface | ✅ Every admin route gated, keys never listed in plaintext | Met |
| Response validation via Pydantic everywhere | ✅ Consistent, well-documented schemas | Met |

## 6. Recommendations (prioritized)

1. **P0 — Lock the API down:** add `dependencies=[Depends(get_current_principal)]` to the app with an explicit public-path exception set (`/api/v1/health`, `/api/v1/sites`, `/api/v1/auth/login`, `/docs`, `/openapi.json`); keep role checks on verify/admin; then re-run the auth tests and the new "no route without auth" test (assert every route in `app.routes` either is public-listed or has the dependency).
2. **P0 — Fix the degraded-p_bad path:** on per-hour model failure compute `p_bad_from_rules` and set `model_used: "rule_based"` + `degraded_reason`; exclude degraded hours from `optimal` (or mark `optimal_degraded: true`).
3. **P1 — Rate limiting:** SlowAPI on `/auth/login` (5/min/IP), `/agent/chat*` (10/min/user), `/ingest`, `/experiments/run*` (2/min); Redis backend noted for multi-worker deploy.
4. **P1 — Fail-closed `_parse_site_keys`** + a warning log; add migration to repair corrupt rows.
5. **P1 — Verification upsert (or 409) + comment bounds + date upper bound.**
6. **P1 — Health endpoint: wrap `load_best()` in try/except and emit `status: "degraded"` with the selection reason.**
7. **P2 — Error hygiene:** exception middleware → `logger.exception` + UUID correlation id + generic client message; remove `detail=str(exc)` from all 500s.
8. **P2 — Bounded attachments (`max_length` on lists), structured audit events for admin actions, admin lockout guard.**
9. **P3 — Version constant unification, CORS list cleanup, `/labels` pagination with real total.**

---

### What this layer does well (worth keeping)

- The 5-minute forecast cache with explicit invalidation hooks (ingest/experiments) is a clean, well-documented design that solved a measured 30-50 s p95.
- Provenance fields (`data_as_of`, `freshness`, `providers`, `model_version`, `forecast_source`, `fallback_hours`, `degraded`) are exactly the right transparency surface — the gap is only that degraded hours still emit fabricated numbers.
- SSE experiment streaming with thread→asyncio queue bridging (`call_soon_threadsafe`, `_eof` sentinel) is correctly implemented.
- Admin key handling: masked previews, `Cache-Control: no-store` on reveal, role gates everywhere.
- Pydantic schemas are consistently bounded (`Field(ge=…, le=…)`) with helpful docstrings tracking feature phases.
