# B1 — Backend Core Audit: db, features, ingest, weather, tides, sites, freshness, scoring, alerts

> Audited 2026-09-19 · Total ~2,450 lines across 9 modules · Safety-lens applied throughout

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `backend/app/lib/db.py` | 340 | SQLAlchemy 2.x models, engine, WAL, 10 tables |
| `backend/app/lib/features.py` | 540 | 14-feature engineering (single source of truth) |
| `backend/app/lib/ingest.py` | 336 | Provider → DB persistence, dedupe, archive backfill |
| `backend/app/lib/weather.py` | 236 | Open-Meteo forecast/marine/archive client + retry + synthetic fallback |
| `backend/app/lib/tides.py` | 96 | WorldTides v3 client |
| `backend/app/lib/sites.py` | 55 | Static site registry (dauin_muck, apo_reef) |
| `backend/app/lib/freshness.py` | 252 | Live/stale/unavailable classification + model version strings |
| `backend/app/lib/scoring.py` | 117 | Rule-based baseline + label derivation |
| `backend/app/lib/alerts.py` | 183 | Threshold alerts + idempotency + SMTP email |

Core functions audited individually: `build_features`, `build_features_for_window`, `build_sequence`, `build_sequences_for_window`, `build_features_from_arrays`, `_compute_features_from_dfs`, `_fetch_*`, `ingest_site`, `ingest_archive`, `_persist_weather/marine/air/tides`, `fetch_forecast`, `fetch_archive`, `_retry_get`, `_synthetic_*`, `fetch_tides`, `compute_freshness`, `model_version`, `score_hour`, `risk_label`, `p_bad_from_rules`, `derive_label`, `check_and_create_alerts`, `get_recent_alerts`, `_send_email_alerts`, `init_db`.

---

## 2. How it works

**Data flow:** providers (Open-Meteo weather/marine, Storm Glass, AQICN, WorldTides) → `ingest_site()` → dedupe-aware upserts (`on_conflict_do_nothing` on `(site_key, ts)`) → `weather_obs` / `marine_obs` / `air_quality_obs` / `tide_obs` tables → `features.py` reads rolling windows (48h weather, 24h tide/marine, latest air snapshot) → 14-feature vector consumed by XGBoost/rules (single row) or LSTM (24-row sequence) → `scoring.py` derives labels → `alerts.py` checks thresholds.

**Feature windows (all trailing/causal):** `precip_24h/48h/3h` sums, `wind_max/mean_24h`, `wave_max_24h` (from weather_obs — the marine endpoint's wave height is merged into weather rows), `sea_temp_mean_24h` (climatology default 28 °C), `tide_max/min/range_24h` (zeros when absent), `is_muck_site` (static), `aqi_recent`/`pm25_recent` (latest snapshot ≤ ts; defaults 30/8 when absent), `wave_period_s_mean` (24h mean from marine_obs; default 6.0 s).

**Freshness:** per-source thresholds — weather/marine live ≤3h / stale ≤24h; tide live ≤6h; air live ≤2h / stale ≤12h. Air is omitted entirely for the two registered sites because both have `air_provider_disabled=True` (nearest AQICN station ~1,100 km away).

**SQLite:** WAL enabled at connect; `check_same_thread=False`; no other pragmas. Legacy-column migration runs at `init_db()`.

---

## 3. Findings

### P0 — Safety-critical

**F-B1-01 · API outage silently fabricates "plausible" weather that is persisted as real observations** — `weather.py:100-102`, `weather.py:159-161`, consumed by `ingest.py:230-231` and `ingest.py:302`.
When Open-Meteo fails after 3 retries, `fetch_forecast()` and `fetch_archive()` fall back to `_synthetic_forecast()` / `_generate_synthetic()` (`weather.py:207-224`), which generate Gaussian weather (mean precip 2 mm/h, wind ~15 km/h, waves ~0.8 m, sea temp ~28 °C). `ingest_site()` then persists those rows via `_persist_weather` — and the synthetic rows carry **no `source` value** (`row.get("source")` → `NULL`, `ingest.py:83`), while real Open-Meteo rows presumably do. Consequences: (a) an operator sees a fresh-looking forecast built from invented data; (b) training (`expand_dataset` → `ingest_archive` → `fetch_archive`) can bake fabricated history into the model weights; (c) there is no API-visible marker distinguishing invented from measured data. For a *diver-safety* product, a wrong-but-plausible "everything is calm" dataset is the worst failure mode. **The fallback is appropriate for smoke-tests, not for the production ingest path.**

**F-B1-02 · Missing sensor data is zero-filled, which biases every feature toward "calm"** — `features.py:118-121` (`build_features_for_window` catches *all* exceptions and substitutes `[0.0] * 14`), `features.py:477-486` (`precip/wind/wave` default 0.0 when a window is empty), `weather.py:229-236` (`_safe_float` maps missing API values to 0.0).
Zero is the *safest-looking* value for precip/wind/wave: an outage or partial fetch makes conditions look flat-calm. A safety-gating system should fail toward *more* caution or at least surface "data unavailable", never silently toward "go". Note the comment at `features.py:206` claims "the per-hour fallback in services will handle it" — verified in B3: services only falls back to the rule-based tier when *sequences* are all-zero, not when individual hours are zero-filled; partially-zeroed sequences pass straight into the LSTM.

**F-B1-03 · Alerts are pull-only — nothing evaluates them on a schedule** — `alerts.py:36-104`; README states `/alerts/run` is "explicit". `check_all_sites()` exists but no scheduler, background task, or cron invokes it (verified: no caller outside `api/main.py`'s manual endpoint and tests). A dive-safety alert system that only fires when someone remembers to press a button is not an alert system. FastAPI ships `asyncio` background schedulers; even a simple `APScheduler`/`repeat_every` loop would close the gap.

### P1 — High

**F-B1-04 · SQLite has WAL but no `busy_timeout`, no foreign-keys pragma, and a default connection pool** — `db.py:39-54`.
With `check_same_thread=False` and FastAPI's threadpool, concurrent write paths (ingest, verify, agent chat persistence, alert creation) can hit `sqlite3.OperationalError: database is locked` immediately under contention; WAL alone does not eliminate it (it allows one writer + many readers, but writers still serialize and short readers can lock). Standard practice is `PRAGMA busy_timeout=5000` (and `PRAGMA foreign_keys=ON` if FKs are ever added; `PRAGMA synchronous=NORMAL` is the usual WAL pairing). Sources: [SQLAlchemy SQLite docs](http://docs.sqlalchemy.org), [Hynek Schlawack — WAL can lock short-lived readers](https://hynek.me), [SQLite forum on busy timeout](https://sqlite.org).

**F-B1-05 · Archive (training) data hardcodes wave_max_m = 0.0 — historical training set has no wave signal** — `weather.py:176`.
`fetch_archive()` sets `wave_max_m: 0.0` for every historical row ("archive may not have marine data"). This is factually outdated: Open-Meteo's **Historical Marine Weather API** (ERA5/WAM back to 1950) provides `wave_height`, `wave_period`, swell components, and `sea_surface_temperature` on the same hourly grid ([Open-Meteo marine docs](https://open-meteo.com/en/docs/marine-weather-api)). Every model trained on archive-expanded data therefore learns `wave_max_24h_m ≈ 0` for the historical regime and only sees nonzero waves in recent rows — a distribution shift that undermines the single most safety-relevant feature. (Cross-ref F-B2-03 in the ML audit.)

**F-B1-06 · `precip_48h` is actually "sum of whatever rows exist in the last 48h" — no coverage check** — `features.py:477-479` and window helpers `features.py:246-253`.
If ingest gaps exist (provider outage, fresh DB), a 48h window containing only 6 rows yields precip ≈ 1/8 of reality. There is no expected-row-count/coverage assertion, no interpolation, and no missingness indicator exposed to the model or UI. Best practice for smooth weather covariates is causal (forward-only) interpolation plus an explicit missingness flag, and never future-aware imputation inside validation folds ([climate time-series imputation review 2025](https://www.sciencedirect.com/science/article/pii/S2215016125003000), [IBM on time-series leakage](https://www.ibm.com)). Precip is one of the few variables where zero is meaningful — but only when you *know* the window was fully covered.

**F-B1-07 · Air-quality snapshot has no maximum-age bound at feature time** — `features.py:400-423`.
`_fetch_air_snapshot` takes "the most recent row ≤ target_ts" with no cutoff, so a week-old AQI snapshot is silently used. `freshness.py` computes the right answer for the UI badge but the *feature builder* never consults it. Currently masked because both sites disable air, but the code path is live for any future site with `air_provider_disabled=False`.

**F-B1-08 · `build_sequence()` is N+1 — 24 sequential DB round-trips per sequence, ×4 queries each** — `features.py:127-145`.
96 queries + a pandas DataFrame construction *per forecast hour*. `build_sequences_for_window()` fixes this (`features.py:148-208`, docstring documents the Phase-4 history: 4,608 sessions per 48h forecast → 30-50 s page loads), but the slow path remains callable and is still used by `alerts.py:46` (`build_features`) — acceptable there — and potentially by tests/older callers. Recommend deleting or gating the slow path.

### P2 — Medium

**F-B1-09 · SMTP alerts: no timeout, no TLS cert verification, no auth retry** — `alerts.py:173-176`.
`smtplib.SMTP(host, port)` has no socket timeout — a hung SMTP server blocks the request thread indefinitely. `server.starttls()` without an explicit `ssl.create_default_context()` does not enforce certificate verification. Also, plaintext passwords in env vars is acceptable but should be noted in SECURITY.md (checked: not currently documented there).

**F-B1-10 · `freshness._classify` builds a placeholder source "??" then callers mutate the dataclass after construction** — `freshness.py:81, 146, 155, 164, 176`. Fragile pattern: any new caller that forgets `x.source = "..."` ships a badge labeled `??`. Pass `source` into `_classify` as a parameter.

**F-B1-11 · Tide freshness reports the *weather* provider name** — `freshness.py:162` (`providers.get("weather")` — "piggy-back on weather provider for now"). Tides come from WorldTides; the badge therefore shows e.g. `open_meteo` as the provider for tide data, which is misleading provenance shown to operators.

**F-B1-12 · `ingest_site` resolves the site twice and re-imports stdlib inside the function** — `ingest.py:223 vs 240`, `ingest.py:257`. Harmless but sloppy; the `fetch_archive` import inside the try block exists only to avoid a circular import smell.

**F-B1-13 · Duplicate-check + insert is not atomic** — `ingest.py:43-59, 66-92`. `_existing_ts()` reads, then inserts; two concurrent ingests can both pass the check. The `on_conflict_do_nothing` upsert saves correctness but the returned *count* can overstate what persisted (the exact bug item #13's row-count fix was meant to solve). Benign in practice.

**F-B1-14 · `scoring.derive_label` is site-type-blind** — `scoring.py:95-107`. viz < 5 m ⇒ no_dive, < 10 m ⇒ poor_viz. Muck diving legitimately happens at 3-6 m viz at Dauin; the threshold set is reef-calibrated and will over-trigger no_dive for the muck site (and the synthetic labels generated from it).

**F-B1-15 · `p_bad_from_rules` is a 3-level step function (0.10 / 0.45 / 0.85)** — `scoring.py:78-92`. As a cold-start fallback this is fine, but it is also surfaced in the UI as "P(no-go)" with the same visual treatment as calibrated model output (verified in F2). Consider a fractional score or a distinct visual tier.

**F-B1-16 · Alert threshold evaluation uses `>=` on 24h-window aggregates computed *now*** — `alerts.py:61`. The same threshold can fire repeatedly hour after hour during a multi-day event (one alert per hour, per kind, per site — by design of the idempotency key), which will spam 24+ in-app alerts during a 24h storm. No auto-expiry or "still active" dedupe.

**F-B1-17 · `db.Base` tables have no `created_at` on observation tables** — `weather.py` obs tables lack ingest timestamps, so it is impossible to distinguish "observed at hour X, ingested at hour X" from "observed at hour X, ingested 3 days later" — the very signal needed to audit the synthetic-data leak (F-B1-01) and measure ingest lag. `source` exists but is NULL for synthetic rows (and for archive rows — `ingest.py:314-323` omits `source` entirely for archive inserts).

### P3 — Low

**F-B1-18 · `weather.py` defines `MARINE_ARCHIVE_URL` that is never used** — `weather.py:135`.
**F-B1-19 · `tides.py` swallows all exceptions when resolving the key (`except Exception: pass`)** — `tides.py:39-40, 94-95`; at minimum log at debug level.
**F-B1-20 · `sites.py` registry is code, not data** — adding a site requires a deploy; no admin CRUD. Acceptable for 2 sites, a blocker at 10+.
**F-B1-21 · `_retry_get` sleeps 1+2+4 s synchronously in the request path** — `weather.py:27-42`; worst case ~50 s (3×15 s timeout + 7 s sleeps) inside a synchronous FastAPI route. Consider circuit-breaker state so a dead provider fails fast.
**F-B1-22 · `_synthetic_*` uses `np.random.RandomState` (legacy API) + MD5 seeding** — `weather.py:213-214`; fine functionally, `numpy.random.default_rng(seed)` is the modern replacement.
**F-B1-23 · `_to_naive_utc`/`_normalize_ts_column` handle pandas 3.x strictness well — but the naive/aware dance is repeated in 4 modules** (`features.py`, `ingest.py`, `freshness.py`, `db.py` defaults). Centralize in one `timeutil.py`.

---

## 4. Web research (what current best practice says)

1. **SQLite + FastAPI concurrency** — WAL is necessary but not sufficient; set `busy_timeout`, keep transactions short, and pool writes. `SQLAlchemy` docs recommend the pysqlite "_time-based_ busy timeout via connect args" pattern and warn about the driver's implicit transaction handling. Sources: [SQLAlchemy SQLite docs](http://docs.sqlalchemy.org) · [Hynek — WAL can lock short-lived readers](https://hynek.me) · [berthub.eu — SQLITE_BUSY despite timeout](https://berthub.eu) · [Simon Willison TIL](https://til.simonwillison.net).
2. **Historical marine data exists** — Open-Meteo's Historical Marine Weather API (ERA5/WAM, from 1950) provides hourly `wave_height`, `wave_period`, swell height/period/direction, and SST — directly usable to fix F-B1-05 instead of zero-filling waves in archives. Source: [Open-Meteo Marine Weather API docs](https://open-meteo.com/en/docs/marine-weather-api), [open-meteo.com](https://open-meteo.com).
3. **Missing-data handling for weather features** — zero-fill biases smooth autocorrelated series; use causal interpolation, model-based imputation for long gaps, add missingness indicator flags, and never leak future data into training-time imputation. Sources: [Missing data imputation of climate time series: A review (2025)](https://www.sciencedirect.com/science/article/pii/S2215016125003000) · [MDPI MMDIF](https://www.mdpi.com/1999-4893/16/9/422) · [IBM — data leakage in time series](https://www.ibm.com) · [Springer 2024 UNet interpolation study](https://link.springer.com/article/10.1007/s41060-024-00611-z).
4. **WorldTides v3** — `heights` + `datum=MSL` + `step` usage matches the official docs; free tier is request-limited (README's "100 req/day" is plausible but should be verified against the account page). Source: [WorldTides API documentation](https://www.worldtides.info).

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Never fabricate data on provider failure; fail loudly | Synthetic fallback persisted with NULL source | **Major** (P0) |
| Missing data → causal interpolation + missingness flags | Zero-fill everywhere, no flags | **Major** (P0/P1) |
| `busy_timeout` + short transactions on SQLite | WAL only | Missing (P1) |
| Marine archive via ERA5 | Waves hardcoded 0.0 in archive path | Missing (P1) |
| Alerts evaluated continuously | Manual endpoint only | **Major** (P0) |
| Feature provenance (source, ingested_at, coverage) per row | `source` partially populated; no ingested_at, no coverage metric | Partial (P2) |
| Air snapshot max-age bound at feature time | Freshness computed for UI only | Partial (P1) |
| Data freshness surfaced to user | ✅ `freshness.py` + FreshnessBadge — genuinely good | Met |
| Timezone normalization single source of truth | Reimplemented in 4 modules | Partial (P3) |

## 6. Recommendations (prioritized)

1. **P0 — Remove synthetic fallback from all persist paths.** On provider failure, return `[]` + warning, persist nothing, and let `freshness` report `unavailable`; keep `_synthetic_*` behind an explicit test-only flag (e.g. `SEASID_ALLOW_SYNTHETIC=1` used only by smoke scripts). Also backfill `source` on every insert (`open_meteo`, `open_meteo_archive`, `worldtides`, `synthetic`) and add an `ingested_at` column so bad data is auditable and purgable.
2. **P0 — Schedule alerts.** Add an APScheduler/background task (e.g. every 30 min) calling `check_all_sites()`, with startup env toggle `SEASID_ALERT_SCHED_ENABLED` (default on), plus storm-active dedupe so a multi-hour event yields one alert + "still active" updates.
3. **P0 — Fail-safe feature defaults.** Replace the `[0.0]*14` exception fallback with a "data unavailable" marker that forces the rule-based tier + an explicit UI warning; add a coverage check (rows_present / rows_expected) and expose it in provenance; bound `_fetch_air_snapshot` to ≤ AIR_STALE_HOURS.
4. **P1 — SQLite pragmas:** `busy_timeout=5000`, `synchronous=NORMAL`, and a write-serialization strategy (single writer session or `NullPool` + retry).
5. **P1 — Real marine archive:** switch `fetch_archive` to the Historical Marine Weather API for `wave_height` (+ `wave_period`), re-expand the training set, retrain (coordinates with B2 rec #3).
6. **P1 — Missingness flags + causal interpolation** for wind/sea-temp windows; precip stays zero-but-only-when-covered.
7. **P2 — SMTP hardening** (`timeout=`, `ssl.create_default_context()`), site-aware `derive_label` thresholds, tide provenance fix, `_classify(source=...)` param.
8. **P3 — Consolidate tz/naive-UTC helpers into `timeutil.py`; delete dead `MARINE_ARCHIVE_URL`; gate `build_sequence` slow path.**

---

### What this module does well (worth keeping)

- `freshness.py` is a genuinely good design: one auditable policy, dumb renderer on the frontend.
- Dedupe-aware ingest counting (`_existing_ts` pre-check) fixed a real prior bug and is well-commented.
- The `build_sequences_for_window` docstring documents *why* it exists with quantified before/after (4,608 → 4 queries) — exemplary.
- Phase-5 label schema (structured `no_go_reason` + `confidence` as training weight) is a strong design choice rarely seen at this scale.
- WorldTides client never raises and degrades to zeros *with* a log warning — correct for its tier.
