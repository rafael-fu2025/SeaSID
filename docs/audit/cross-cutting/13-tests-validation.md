# C1 — Tests & Validation Gates Audit: backend pytest, frontend vitest, lint, pre-push hook, CI posture

> Audited 2026-09-19 · Suites **executed** during this audit, not just read

---

## 1. Scope & execution evidence

| Check | Result (2026-09-19, this machine) |
|---|---|
| `cd backend && python -m pytest tests/ -q` | **257 passed, 1 skipped** in 126.7 s ✅ (one asyncio `Event loop is closed` noise traceback at interpreter shutdown) |
| `cd backend && python -m ruff check .` | **All checks passed** ✅ |
| `cd frontend && npx vitest run` | **1 failed / 198 passed** ❌ — `AgentFab.test.jsx › "shows a site context selector (roadmap #10)"` expects `data-testid="agent-site-context"`; the component renders `agent-site-selector` |
| `cd frontend && npm run lint` | Passes ✅ |
| CI (`.github/workflows/`) | **Absent** — no remote enforcement |

Suite inventory: **24 backend test files, 258 test functions**; **30 frontend test files, 199 test cases**. README claims "66 tests across 8 files" / "81 tests across 20 files" — the documented counts are ~4× stale.

Files read in detail: `backend/tests/conftest.py` (211), `githooks/pre-push` (header + scoping logic), `vitest.config.js`, `eslint.config.js`, `pytest.ini` (referenced), plus test-name survey of all 24 backend files.

---

## 2. How the harness works

**Backend:** `conftest.py` sets `SEASID_AUTH_ENABLED=false` globally, then gives *every* test a fresh SQLite file in `tmp_path` by monkeypatching `db.engine`/`db.SessionLocal` (WAL on, `create_all`, ordered teardown: drop → dispose → gc → retry-unlink). Windows-specific guards patch `socket.socketpair` with a 10× retry (WinError 10013 race after WAL churn) and make `ProactorEventLoop._close_self_pipe` tolerant of unfinished self-pipes — documented lessons wired in from LESSONS.md. Domain fixtures seed 48 h weather / 24 h tides / a realistic toy feature matrix.

**Frontend:** vitest + jsdom + Testing Library, `globals: true`, setup file for jest-dom; eslint flat config isolates test globals.

**Gate:** `githooks/pre-push` scopes checks to changed areas (backend→ruff+pytest; frontend→eslint+vitest), *always* runs the security-critical suites (api-keys, auth, label-schema), logs PASS/FAIL to `<git-dir>/seasid-prepush.log`, and is installed per-clone via `githooks/install.sh`/`install.ps1`.

---

## 3. Findings

### P1 — High

**F-C1-01 · The whole suite runs with authentication disabled, so auth regressions are structurally invisible** — `conftest.py:20` (`SEASID_AUTH_ENABLED=false`) combined with the per-route opt-in auth model (F-B3-01) means: if a route *loses* its `Depends(get_current_principal)` tomorrow, or role/site checks are deleted, no test turns red — the endpoint tests all exercise the `auth_enabled() == False` bypass path. This is exactly how ten open routes shipped alongside a passing suite. The OWASP Authorization Testing Cheat Sheet calls for regression tests that specifically target authorization decay, with both negative (401/403) and positive assertions per role ([OWASP AuthZ Testing](https://cheatsheetseries.owasp.org), [OWASP A01 Broken Access Control](https://top10.owasp.org)). Fix: a dedicated `test_auth_coverage.py` that runs with `SEASID_AUTH_ENABLED=true` (env-override fixture), asserting every non-allowlisted route returns 401 anonymous / 403 viewer for admin-only paths — one parametrized test over `app.routes` makes the gate structural, not per-route.

**F-C1-02 · The frontend gate is red right now** — the failing AgentFab test (testid renamed in the component during the cockpit polish, test not updated) means `npm test` — and therefore `githooks/pre-push` — **fails on the current working tree**. This audit's execution is the evidence; a green-gate claim in README is stale. Also demonstrates the flip side of a client-side gate: it only protects clones that installed the hook.

**F-C1-03 · No CI** — there is no `.github/`; the only enforcement is the per-clone, per-machine pre-push hook (bypassable via `--no-verify`, and absent on any clone that skipped `install.sh`). Hook-vs-CI consensus: hooks accelerate local feedback; CI is the authoritative, unbypassable gate ([Witowski — pre-commit vs CI](https://switowski.com), [dev.to — pre-push trade-offs](https://dev.to)). One GitHub Actions workflow running the two documented commands would close the loop.

### P2 — Medium

**F-C1-04 · Test-count documentation is ~4× stale** — README "Running Tests" table (66/81 across 8/20 files) predates ~15 backend test files. Anyone sizing a change against the docs misjudges the suite; the same drift infects AGENTS.md's wording. Regenerate counts in CI or de-number the docs.
**F-C1-05 · Global `SEASID_AUTH_ENABLED=false` also masks the *frontend's* assumptions** — frontend tests mock `api` rather than exercising the 401→`seasid:auth-expired` path end-to-end; the auth-expired flow is only unit-shaped.
**F-C1-06 · Backend suite runs in ~127 s with visible training tests inside** — acceptable, but the LSTM/GRU training tests dominate; marking them `@pytest.mark.slow` and running them in the pre-push/CI gate while skipping on watch-loops would keep iteration fast. (No marker taxonomy exists.)
**F-C1-07 · No coverage measurement** — `pytest-cov`/`vitest --coverage` aren't wired; the audit found entire paths (e.g. rule-based fallback in services, `reveal` endpoint, scraper `run_all`) with thin or no direct tests. Not every line needs a test — but without a number, gaps like F-B3-01 stay invisible.
**F-C1-08 · Frontend suite has no auth-context negative tests** and no test that the *unauthenticated* redirect works; `AuthGate` is tested only in the happy path.

### P3 — Low

**F-C1-09 · Interpreter-shutdown asyncio traceback** after the backend suite (cosmetic but trains eyes to ignore red text; a `pytest-asyncio` teardown fix or `loop.close()` guard clears it).
**F-C1-10 · conftest monkeypatches `db.engine` module-wide — modules that imported `SessionLocal` *by reference* at import time would bypass the fixture** (none currently do — `features.py` etc. access `db.SessionLocal` attribute-style, which is why the fixture works; worth a LESSONS.md note to keep that property).
**F-C1-11 · `test_freshness.py` pins `model_version` strings exactly** — every model format tweak breaks string tests; consider parsing the shape instead.
**F-C1-12 · Frontend tests rely on `IS_TEST` admin-user injection** (`AuthContext.jsx:16-18`) — production code branches on test mode; prefer test-only provider wrappers.

---

## 4. Web research (what current best practice says)

1. **Hooks vs CI** — hooks are for fast local feedback; CI is the enforcement point, because hooks are voluntary and machine-dependent; the standard split is lint/typecheck pre-commit, full suite pre-push, everything authoritative in CI. Sources: [Witowski — pre-commit vs CI](https://switowski.com) · [dev.to pre-push hooks](https://dev.to) · [jerrycodes](https://blog.jerrycodes.com).
2. **Authorization regression testing** — suites must include negative tests per role and per route; auth-disabled harnesses hide exactly the "authorization degrades over time" failures OWASP calls out; IDOR/horizontal-escalation checks belong in the permanent suite. Sources: [OWASP Authorization Testing Cheat Sheet](https://cheatsheetseries.owasp.org) · [OWASP Top 10 A01](https://top10.owasp.org) · [SuperTokens — authn vs authz bypass](https://supertokens.com).
3. **Test-suite hygiene** — marker taxonomies for slow tests, coverage as a tripwire (not a target), and keeping docs' counts machine-generated are standard hygiene at this scale.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| AuthZ negative tests (per role/route) | Suite runs auth-disabled; none exist | **Major** (P1) |
| Remote CI enforcement | None | **Major** (P1) |
| Gate green on main working tree | Frontend currently red | **Major** (P1) |
| Documentation matches suite reality | Counts ~4× stale | Partial (P2) |
| Slow-test markers / fast iteration loop | None | Partial (P2) |
| Coverage signal | None | Missing (P2) |
| Windows-safe harness with documented lessons | ✅ conftest is exemplary | Met |
| Security-critical suites always run at push | ✅ pre-push hook design | Met (local only) |
| Deterministic per-test DB isolation | ✅ tmp_path + ordered teardown | Met |

## 6. Recommendations (prioritized)

1. **P1 — Add `test_auth_coverage.py`:** parametrize over `app.routes`; with auth enabled assert 401 for unauthenticated calls to every non-public route and 403 for viewer→admin paths; run it with `SEASID_AUTH_ENABLED=true` via a fixture-scoped env override. This single test would have caught F-B3-01 and guards every future route.
2. **P1 — Fix the failing AgentFab testid** (update test to `agent-site-selector` or vice versa) and restore the green gate.
3. **P1 — Add GitHub Actions:** one workflow — backend job (ruff + pytest) and frontend job (lint + typecheck + vitest) on PR + push to main; cache pip/npm; ~4 min total on free runners.
4. **P2 — Regenerate README/AGENTS.md test counts** (or drop counts); wire coverage reporting with a soft baseline; add `slow` markers to training tests.
5. **P3 — Clean up the asyncio shutdown traceback; add the `db.SessionLocal` attribute-access invariant to LESSONS.md.**

---

### What this area does well (worth keeping)

- `conftest.py` is production-grade: per-test isolated DB, ordered Windows-safe teardown with retries, socketpair race patch with a full explanation, and lessons from LESSONS.md actually encoded as guards — this is the best test infrastructure file in the repo.
- The pre-push hook's design (changed-area scoping + always-run security suites + append-only gate log) is smarter than most academic projects ever get; it only needs CI as its unbypassable sibling.
- Backend suite is genuinely broad (257 tests incl. phase regressions, arg-validation, time-aware splits) and currently green in ~2 minutes.
- Frontend tests exercise real interaction paths (streaming aborts, focus after reset, deck advancement) rather than snapshot smoke.
