# Lessons & Checks Log

Durable owner for **recurring failures that have been turned into a check**. This
is the one place where a repeated bug, flaky test, or spec drift is recorded
alongside the guard that now prevents it from coming back.

This file is different from `nextMove.md` and `data/phase_reports/*.json`: those
are static, point-in-time notes. This log has an explicit **update rule**, so it
stays current as the suite grows.

Linked from [`AGENTS.md`](AGENTS.md) → "Learning & decisions".

---

## The rule (update trigger)

> **Whenever a recurring failure gets a new check, add one row below.**

A "recurring failure" is anything that has bitten us more than once or is likely
to regress: a fixed logic bug, a flaky test, an environment quirk, or a
doc/spec drift. As soon as you add the guard that catches it, record it here.

Each row names exactly three things:

1. **Trigger** — the recurring failure the check exists to catch.
2. **Added check** — the specific test / assertion / guard that was added.
3. **Where it runs** — the command or hook that executes the check.

Keep each entry to a single line. Do not delete rows when a check is refactored;
update the "Added check" / "Where it runs" cells instead so the history stays
readable.

**One-line format**

```
| YYYY-MM-DD | <trigger> | <added check> | <where it runs> |
```

---

## Entries

| Date | Trigger (recurring failure) | Added check | Where it runs |
|------|-----------------------------|-------------|---------------|
| 2026-07-21 | `ingest_site` counted *attempted* rows, so `IngestResponse.*_rows` overcounted on duplicate re-ingest (`on_conflict_do_nothing`). | `TestFix13IngestCounts` — `_persist_*` must return the true inserted count (3, then 0 on re-insert). | `cd backend && python -m pytest tests/test_roadmap_fixes.py -k Fix13` |
| 2026-07-21 | `services.get_forecast` attached an `air` block but `ForecastResponse` had no `air` field, so Pydantic silently dropped it before clients saw it. | `TestFix12AirFieldInSchema::test_schema_declares_air_field` — asserts `"air" in ForecastResponse.model_fields`. | `cd backend && python -m pytest tests/test_roadmap_fixes.py -k Fix12` |
| 2026-07-21 | `_run_ablations` trained the LSTM twice inside one dict literal (`"model": train_lstm(...)`, `"scaler": train_lstm(...)`) — wasteful and non-deterministic. | `TestFix11LstmAll11TrainOnce::test_all_11_block_does_not_call_train_lstm_twice_inline` — static-source guard that the `'"model": train_lstm('` pattern is gone. | `cd backend && python -m pytest tests/test_roadmap_fixes.py -k Fix11` |
| 2026-07-21 | `operator_verifications` had no unique constraint, so re-submitting the same (site, date, operator) created duplicate rows and duplicate training labels. | `TestFix14OperatorUniqueCstr` — asserts `uq_opver_site_date_operator` exists and a duplicate raises `IntegrityError`. | `cd backend && python -m pytest tests/test_roadmap_fixes.py -k Fix14` |
| 2026-07-21 | Sites with `air_provider_disabled=True` could still expose an `air` block built from stale rows on disk. | `TestFix15AirQualityDisabled` — `_latest_air_snapshot` must return `None` for disabled and unknown sites. | `cd backend && python -m pytest tests/test_roadmap_fixes.py -k Fix15` |
| 2026-07-21 | On Windows, `socket.socketpair()` intermittently raised WinError 10013 and `ProactorEventLoop` teardown crashed on a missing `_ssock`; SQLite WAL handles broke temp-db cleanup — the whole suite was flaky. | Autouse guards in `tests/conftest.py`: retrying `socketpair`, a safe `_close_self_pipe`, and a retry-unlink loop for the temp DB. | Runs on every backend test: `cd backend && python -m pytest tests/` |
| 2026-07-22 | The Experiments page POSTs to `/api/v1/experiments/run/stream` for live progress, but the backend had no such route — every "Run suite" click 404'd silently while the page just showed "Experiment stream failed: HTTP 404". Classic spec drift between frontend (api.js) and backend (main.py). | `TestExperimentsStreamEndpoint` — three tests in `tests/test_api.py`: (1) `test_stream_endpoint_is_registered` confirms the route exists, (2) `test_stream_emits_error_when_no_labels` pins the wire format on the empty-DB path, (3) `test_stream_emits_status_log_metric_done_in_order` monkeypatches the suite + feature builders and asserts the full lifecycle frame order. | `cd backend && python -m pytest tests/test_api.py -k StreamEndpoint` |

| 2026-07-24 | Dashboard's container order was reshuffled (chart moved above timeline, ForecastProvenance inserted between timeline and optimal-window summary), but the loading skeleton still rendered KPI → ForecastGrid → Chart, so the user saw a noticeable layout jump when real data arrived. | `Dashboard.test.jsx` (`renders the KPI strip, chart, provenance, forecast grid, optimal window, and footer skeletons in the post-swap order`) — mocks the API to keep `loading=true`, then asserts document order of `skeleton-kpi-strip < skeleton-chart < skeleton-provenance < skeleton-forecast-grid < skeleton-optimal-window < skeleton-footer`. | `cd frontend && npm test -- src/__tests__/Dashboard.test.jsx` |
| 2026-07-30 | `run_api.py`'s Windows SelectorEventLoop cannot spawn subprocesses, so the MiniMax MCP died with a bare `NotImplementedError` ("Failed to spawn MiniMax MCP: ") on every boot — web_search/understand_image never worked. | `test_run_mcp_spawns_subprocess_under_selector_loop` — `agent_mcp._run_mcp` must spawn a subprocess via the dedicated proactor loop even under a selector loop. | `cd backend && python -m pytest tests/test_mcp_minimax.py -k selector_loop` |
| 2026-07-30 | Every failed MCP boot called `mark_provider_error` on the *shared LLM key*, cooling it down / racking up error_count until agent chat 401'd and the operator had to re-enter the key after each refresh. | `test_local_boot_failure_does_not_cooldown_shared_llm_key` + `test_auth_boot_failure_marks_shared_llm_key` — only upstream auth rejections may blame the key; plus `pick_provider_key` half-open retry after cooldown expiry pinned in `test_provider_keys_pick_rotates_and_skips_disabled`. | `cd backend && python -m pytest tests/test_mcp_minimax.py tests/test_admin_api_keys.py` |
| 2026-07-30 | Node >= 22's experimental global `localStorage` (the `--localstorage-file` Web Storage) shadows jsdom's implementation under Vitest, so every storage-touching frontend test (`forecastCache.test.js`, auth-token flows) failed with `localStorage.clear is not a function` on newer Node. | In-memory Storage stand-in installed by `src/test/setup.js` whenever `window.localStorage.clear` is not callable (covers `localStorage` + `sessionStorage` on `window` and `globalThis`). | Runs on every frontend test: `cd frontend && npm test` |
| 2026-07-30 | `_compute_features` only lower-bounded its rolling windows and used the tide frame unfiltered, so the batched forecast path (`build_features_for_window`) leaked future horizon rows into every hour's trailing stats and computed `tide_range_24h_m` over the whole multi-day span — every dashboard hour showed rule-based `HIGH` current risk while the (correctly-windowed) LSTM said 4% P(no-go). | `TestPerHourWindowClamp` in `tests/test_features.py` — future weather rows excluded, tide range from the hour's own trailing 24h only, and horizon-wide vs exactly-windowed frames must produce identical features. | `cd backend && python -m pytest tests/test_features.py -k PerHourWindowClamp` |
<!-- Add new rows above this line. Newest entries at the bottom of the table. -->
