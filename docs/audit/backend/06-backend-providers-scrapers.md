# B6 — Providers & Scrapers Audit: providers/*, scrapers/*, registry contract

> Audited 2026-09-19 · ~1,340 lines · Includes verification against provider API docs

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `backend/app/lib/providers/base.py` | 101 | Abstract contracts + canonical units |
| `backend/app/lib/providers/registry.py` | 145 | Per-role selection via env, lazy singletons |
| `backend/app/lib/providers/open_meteo.py` | 132 | Weather + marine adapters over `weather.py` |
| `backend/app/lib/providers/stormglass.py` | 164 | Storm Glass marine (NOAA source preference) |
| `backend/app/lib/providers/aqicn.py` | 209 | AQICN air quality + station-distance buckets |
| `backend/app/lib/scrapers/base.py` | 188 | Scraper ABC + registry + bulk upsert |
| `backend/app/lib/scrapers/pagasa_synop.py` | 159 | PAGASA CSV seed scraper + label heuristics |
| `backend/app/lib/scrapers/open_meteo_archive.py` | 85 | Rule-based label synthesis from archive |
| `backend/app/lib/scrapers/viz_apps.py` | 112 | Viz App / DiveViz CSV-fallback stubs |
| `backend/app/lib/providers/README.md` | — | Contract doc (spot-checked against code) |

---

## 2. How it works

Providers implement one of three abstract roles (`weather` / `marine` / `air`) with normalized units and `source` tagging; the registry lazily builds one provider per role from `SEASID_PROVIDER_{WEATHER,MARINE,AIR}` (default `open_meteo`/`open_meteo`/`off`), warning when a keyed provider has no DB key. Scrapers implement a label-producing `fetch(site_key, since, until)` and persist via a single bulk `INSERT … ON CONFLICT DO NOTHING` keyed on `(site_key, date, source)` with rowcount-based insert counting. Two scrapers are live (PAGASA CSV seeds, archive-synthetic); the crowd-sourced dive-report scrapers are documented stubs reading operator-curated CSVs.

---

## 3. Findings

### P0 — Safety-critical

**F-B6-01 · Open-Meteo providers request only ~1 hour of *future* data for any `hours` ≤ 168 — the entire forward forecast is built on empty windows** — `open_meteo.py:51-52` (weather) and `open_meteo.py:92-93` (marine):
```python
past_hours = min(int(hours), 168)
forecast_hours = max(1, int(hours) - past_hours)   # == 1 whenever hours ≤ 168
```
`ingest_site(hours=48)` (the default; API caps at 168) therefore stores 48 past rows + **1** future row. `services.get_forecast()` then targets `now+0 … now+47h`; for every target ≥ now+2 h the 24 h trailing feature windows fall entirely beyond the newest stored row, so `_compute_features_from_dfs` receives empty DataFrames and emits the calm defaults (precip/wind/wave = 0, sea temp 28 °C, AQI 30, period 6 s — `features.py:477-523`). In effect the "48-hour LSTM forecast" is: hour 0-1 computed on real data, hours 2-47 computed on fabricated calm defaults — and `freshness` still reports "live" because the newest row (now+1 h) is fresh. This is the single most consequential data bug in the codebase: it systematically biases the forward forecast toward "safe" and defeats the entire purpose of a forward-looking safety product. The ingest docstring (`ingest.py:210-213`) even states the intended semantics ("forward-looking window… also asked for the same number of hours in the past"), i.e. `fetch_forecast(past_hours=hours, forecast_hours=hours)`. Fix: `forecast_hours = max(int(hours), 48)` and `past_hours = min(int(hours), 168)` (total 2×hours, still within Open-Meteo's 384 h combined cap), then re-ingest and re-verify forecast values against live Open-Meteo output.

### P1 — High

**F-B6-02 · Storm Glass request has no time window** — `stormglass.py:98-103` sends `lat/lng/params` but no `start`/`end`; the API's default window covers only the near future, so the marine lookback (needed for LSTM sequences and `wave_period_s_mean` history) is never populated from Storm Glass even when it's the configured marine provider. The API expects ISO `start`/`end` with at least one present ([Storm Glass query-optimization docs](https://stormglass.io), [v2 point endpoint references](https://learn.microsoft.com)). Fix: pass `start=now-min(hours,168h)`, `end=now+hours` — matching the Open-Meteo semantics — mindful of the 50 req/day free tier (one request covers the whole window, so this is free).

**F-B6-03 · `to_label_rows` defaults missing labels to `"dive"`** — `scrapers/base.py:78` (`label=r.get("label", "dive")`). A malformed/blank CSV row silently becomes a *safe* training label. Labels should be required (`KeyError` → row skipped + counted in `errors`) — the fail-open direction is the dangerous one for a safety model (same lens as F-B1-02).

### P2 — Medium

**F-B6-04 · Synchronous `time.sleep` retries inside provider `fetch_*`** — `stormglass.py:106-133`, `aqicn.py:115-136` (mirrors `weather.py::_retry_get`, F-B1-21). Worst case ~50 s of blocking inside ingest routes. A shared async-tolerant retry helper (or threadpool offload) would bound the damage; also no jitter — thundering-herd behavior on provider recovery.
**F-B6-05 · Registry fallback masks misconfiguration** — `registry.py:48, 65`: an unknown `SEASID_PROVIDER_WEATHER=stomglass` typo logs a warning and *silently serves Open-Meteo*. For a system whose provenance chips claim to show "which provider produced this data", typo-tolerance equals provenance lies. Fail fast (raise at build) or at minimum surface `provider="open_meteo(fallback)"` in `ProviderInfo`.
**F-B6-06 · Registry caches providers by env name only** — `registry.py:97-99`: a rotated/enabled DB key doesn't rebuild a keyed provider (Storm Glass/AQICN read their key in `__init__`), so a newly added key is invisible until `reset_registry()` — which admin key writes *do* call (B3), but env-based deployments restart rarely. Document or cache by (name, key_id).
**F-B6-07 · AQICN `data.time.iso` may be local station time without offset in some responses** — `aqicn.py:157-166` handles `Z` suffix but a bare local timestamp is pinned to UTC (`ts.replace(tzinfo=timezone.utc)`), which can mislabel the snapshot by up to ±8 h. Low impact for the ≤2 h live threshold; note for future stations.
**F-B6-08 · PAGASA heuristic label thresholds diverge from `scoring.py`** — `pagasa_synop.py:122-141` re-implements the rain/wind/wave thresholds with slightly different values (wave > 2.0/1.2 match, but `scoring.derive_label`/`score_hour` use different feature combinations). Two threshold tables to keep in sync = drift; import and reuse `score_hour`/`risk_label` (as `open_meteo_archive.py` correctly does).
**F-B6-09 · `viz_apps` docstring vs behavior mismatch on missing `site_key`** — `viz_apps.py:51-53` claims rows default to `dauin_muck`; the code sets `None` and `_filter_by_site` then drops those rows unless the site key appears in comments. Either default as documented or fix the docstring; comment-matching (`if site_key in comments`) is fragile either way.

### P3 — Low

**F-B6-10 · Dead code** — `OpenMeteoAirProvider` is registered nowhere (registry has no "open_meteo" air branch — it just disables air) — `open_meteo.py:117-132`; `StormGlassMarineProvider._last_request_lat/lon` assigned, never read — `aqicn.py:111-112` and `stormglass.py` equivalent.
**F-B6-11 · `_pick_value` fallback chain order is a guess** — `stormglass.py:51`: `("noaa", "sg", "icon", "ecmwf")` then "any numeric" — mixing model sources across hours makes the series inconsistent; prefer per-parameter constant source with explicit NaN gaps.
**F-B6-12 · Scraper registry duplicates source naming logic** — `source=f"{self.name}_{sub_source}"` (`base.py:79`) means the `(site,date,source)` unique key changes when a scraper renames its sub_source — old rows orphan. Document sub_source as part of the contract.
**F-B6-13 · `pagasa_synop` duplicate label-derivation branches** — `pagasa_synop.py:118-141`; the two branches differ only in `confidence`.
**F-B6-14 · `open_meteo_archive` scraper silently skips error days at DEBUG** — `open_meteo_archive.py:79-83`; fine, but a run summary count of skipped days would surface ingest gaps.

---

## 4. Web research (what current best practice says)

1. **Open-Meteo window semantics** — the forecast API accepts `past_hours` (up to 92 for some models, 168 combined-capped at 384 h total) *and* `forecast_hours` independently; a correct adapter must request both sides explicitly. Verified against [open-meteo.com docs](https://open-meteo.com/en/docs) and the Historical Marine API (F-B1-05): marine archive goes back to 1950 with wave/period/SST parameters.
2. **Storm Glass** — point endpoint takes `lat`, `lng`, `params`, `start`, `end` (ISO, at least one required); smaller windows perform better; free tier 50 req/day / 10 per hour — one request per window is the designed usage. Sources: [Storm Glass docs](https://stormglass.io), [Storm Glass connector reference](https://learn.microsoft.com).
3. **AQICN** — `feed/geo:` returns nearest global station with per-pollutant `iaqi`; the distance/quality bucketing SeaSID implements (local <25 km, regional <100 km, distant <500 km, very_distant ≥500 km) is a sound, documented answer to the free tier's nearest-station problem. Source: [aqicn.org JSON API doc](https://aqicn.org/json-api/doc/).
4. **Rate-limit etiquette** — honor 429 with exponential backoff + jitter, cache aggressively, and expose per-key cooldown state (SeaSID's `provider_keys` cooldown design matches this well; the jitter is the missing piece).

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Request both past and future windows explicitly | Future window ≈ 1 h (P0) | **Major** (F-B6-01) |
| Explicit time window on every provider call | Storm Glass sends none | Missing (P1) |
| Fail-closed label ingestion | Missing label → "dive" | Major (P1) |
| Strict provider selection (no silent fallback) | Typo → Open-Meteo silently | Partial (P2) |
| Backoff with jitter; bounded blocking | Backoff without jitter; blocking sleeps | Partial (P2) |
| Single threshold table for label heuristics | Duplicated in scraper | Partial (P2) |
| Canonical units + `source` tagging contract | ✅ Documented and honored | Met |
| Per-site opt-out (air) + distance-quality buckets | ✅ Well implemented | Met |
| Keyless providers degrade silently | ✅ Contract honored | Met |

## 6. Recommendations (prioritized)

1. **P0 — Fix the Open-Meteo window math** (F-B6-01): request `forecast_hours = max(hours, 48)` and `past_hours = min(hours, 168)` in *both* Open-Meteo providers; add a regression test asserting `len(rows) >= past + forecast` and that `weather_obs` contains rows with `ts > now` after ingest; re-ingest all sites afterward.
2. **P1 — Storm Glass `start`/`end`** per F-B6-02; add the same window semantics to its docstring.
3. **P1 — Require `label` in `to_label_rows`**; skip + count malformed rows in `ScraperResult.errors`.
4. **P2 — Fail-fast registry** for unknown provider names (env typo) with the intended name in the error; add jitter to all backoff loops; consolidate PAGASA thresholds onto `score_hour`.
5. **P3 — Delete dead code (F-B6-10); fix viz_apps docstring; pin Storm Glass to one source per parameter.**

---

### What this area does well (worth keeping)

- The provider contract (canonical units, `source` tags, tolerate-missing-keys, never-raise) is clearly written in `base.py` AND `providers/README.md`, and the implementations honor it.
- AQICN's station-distance bucketing with per-site opt-out is a thoughtful answer to a real free-tier limitation, and the warning text is surfaced to the agent and API.
- The scraper framework's bulk upsert with rowcount-based insert accounting avoids the N+1 pre-check pattern used in `ingest.py` — the better of the two patterns in the codebase.
- Honest stubs: viz_apps says plainly "these are stubs, here's the CSV fallback" instead of pretending.
