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

<!-- Add new rows above this line. Newest entries at the bottom of the table. -->
