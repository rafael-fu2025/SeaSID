# F2 — Dashboard & Forecast Screens Audit: Dashboard, Forecast, PBadChart, ForecastCard/Chart/Provenance, RiskBadge, FreshnessBadge, ActiveLearningNudge

> Audited 2026-09-19 · ~2,300 lines · Lens: safety-decision UX, uncertainty communication, data-time correctness

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/pages/Dashboard.jsx` | 475 | KPI strip, paged 12-hour grid, chart, provenance, optimal window |
| `frontend/src/pages/Forecast.jsx` | 350 | AI briefing + live metrics + timeline + chart |
| `frontend/src/components/PBadChart.jsx` | 393 | Recharts P(no-go) line with theme-reactive colors |
| `frontend/src/components/ActiveLearningNudge.jsx` | 424 | Card-deck label dialog (Phase 8) |
| `frontend/src/components/ForecastProvenance.jsx` | 160 | "Where did this come from?" panel |
| `frontend/src/components/ForecastChart.jsx` | 129 | Legacy chart component (superseded by PBadChart) |
| `frontend/src/components/FreshnessBadge.jsx` | 108 | live/stale/unavailable chips + degraded stack |
| `frontend/src/components/RiskBadge.jsx` | 75 | Risk chip + ProbabilityMeter |
| `frontend/src/components/ForecastCard.jsx` | 55 | Single-hour card |

---

## 2. How it works

**Dashboard** fetches `/forecast` + `/alerts` in parallel, renders a 5-KPI strip (visibility / current risk / P(no-go) / AQI / model), a 12/24/48-hour window toggle over the same payload, a paged 12-card grid, `PBadChart`, `ForecastProvenance`, and an optimal-window summary. Refreshes via button and the global `seasid:refresh` event.

**Forecast** restores `briefing + forecast` from the localStorage cache (5-min TTL), else fetches `/agent/briefing` (a full LLM tool-loop run!) and `/forecast` together, and renders the briefing markdown next to a metric snapshot parsed from the agent's `get_forecast`/`get_weather` tool results, plus the same chart/timeline.

**ActiveLearningNudge** loads `/active-learning/suggestions`, auto-opens a dialog with a flinging card-deck animation, and submits verdicts through `/verify` with a machine-readable `comments` trail. Dismissals persist in `localStorage`.

---

## 3. Findings

### P0 — Safety-critical

**F-F2-01 · Timestamps render in the viewer's local timezone while explicitly labeled "UTC"** — `Dashboard.jsx:214` (`sub={`${fmtTime(currentHour.ts)} UTC`}`), `Dashboard.jsx:30-35` (`fmtTime`/`fmtTimeFull` use `toLocaleTimeString` with no `timeZone`), `ForecastProvenance.jsx:30-42` (same pattern: local render + `' UTC'` suffix).
`new Date(iso).toLocaleTimeString()` converts to the *browser's* zone; the appended "UTC" is a false claim. For a Philippine operator (UTC+8) every displayed time is 8 hours off from its label — on the exact KPI ("Visibility @ 12:00 UTC") and provenance strip ("Data as of") operators use to decide when to dive. Either drop the suffix (local time is the better UX) or pass `timeZone: 'UTC'` explicitly. This is the highest-leverage one-line-class fix in the frontend.

**F-F2-02 · Degraded/unavailable p_bad values are rendered as safe** — `PBadChart.jsx:241` (`p_bad: h.p_bad ?? 0` — null plots at 0% = "Go"), combined with the backend's fabricated 0.5 on model failure (F-B3-02) and `fallback_hours`/`degraded_reason`/`forecast_source` fields that **no screen reads** (verified: neither Dashboard nor Forecast renders `forecast.degraded`, `fallback_hours`, or per-hour `degraded_reason`). The UI therefore cannot distinguish a real 0% from "no data" or "model failed; here's a neutral number". Fix: render null p_bad as gaps (Recharts `connectNulls={false}` + null data points), badge degraded hours, and surface `fallback_hours > 0` as a prominent warning chip (`FreshnessStack` already supports it — it's just not fed `forecast.degraded`… actually the *reasons list* is available and unused).

### P1 — High

**F-F2-03 · Dashboard has a stale-response race on quick site switching** — `Dashboard.jsx:59, 61-84`: a single boolean `cancelRef` guards in-flight loads; cleanup sets `true`, but the *next* effect run's `load()` sets it back to `false` before the old promise resolves, so an older site's response can win and render under the new site's header. The Forecast page implements this correctly with a monotonic `requestRef` counter (`Forecast.jsx:42, 45, 62`). Copy that pattern (or extract `useLatestRequest`).

**F-F2-04 · Forecast page triggers a full LLM briefing on every cache miss** — `Forecast.jsx:58-61`: `getBriefing` runs the agent loop (up to 5 LLM rounds + tool calls). Multiplied by users × sites × 5-min TTL this is significant latency (multi-second page loads) and LLM spend — for content that changes only with the data (5-min forecast cache behind it). Recommendation: generate briefings server-side on ingest (cheap, one per site per TTL) or behind an explicit "Regenerate briefing" button instead of page load.

**F-F2-05 · Threshold constants (30 %/60 %) duplicated in four places** — `Dashboard.jsx:20` (`level()`), `ForecastTimeline` inline (`Forecast.jsx:282-287`), `PBadChart.jsx:40-41`, `RiskBadge.jsx:55`. A threshold policy change (e.g. site-specific no-go bands) currently requires four coordinated edits. Extract `lib/riskLevels.js` as the single source, ideally mirrored from a backend-served value so operators can tune it without a frontend deploy.

### P2 — Medium

**F-F2-06 · ActiveLearningNudge defaults operator confidence to "high"** — `ActiveLearningNudge.jsx:115` (`useState('high')`). Phase 5 weights training by confidence; pre-selecting the maximum weight for an answer the operator didn't ask to justify inflates label trust. Default `med`, and surface the weight implication in the helper text.
**F-F2-07 · Nudge dismissals persist forever across model retrains** — `ActiveLearningNudge.jsx:25-47`: once skipped, a date never returns even after the model that was uncertain about it has been replaced. Key the dismissal store by `(date, model_version)` or expire after N days.
**F-F2-08 · The optimal window ignores uncertainty entirely** — `Dashboard.jsx:372-391` presents "Optimal dive window = argmin p_bad" with three summary cells. With an LSTM at ~100 training samples and ±wide calibration error, the argmin between adjacent hours is noise; WMO/NOAA guidance for forecast-communication recommends pairing point values with a confidence/uncertainty cue ([WMO guidance](https://wmo.int), [NOAA/Ripberger 2022](https://www.noaa.gov)). Minimum viable version: show the calibrator's Brier/ECE (already persisted in the calibrator — F-B2) as a "model confidence: moderate" chip on the optimal-window card.
**F-F2-09 · `ForecastCard` accepts a `freshness` prop no caller passes** — `ForecastCard.jsx:24-52`; per-hour freshness is the exact thing an operator needs next to a given hour (and would expose F-B6-01's calm-default hours). Wire `ForecastProvenance`-style chips into the card or delete the prop.
**F-F2-10 · Dashboard page count math vs windowHours** — `Dashboard.jsx:102-105`: `visibleHours` slices to `windowHours` (12/24/48) of a fixed 48-hour payload; the timeline pagination ("Hours 1–12 of 48") silently re-paginates when the toggle changes, and `timelinePage` can exceed the new count (clamped, ok). Cosmetic, but the "of N" label reads as total-hours when it's the window size.
**F-F2-11 · Forecast "Live metrics" couples UI to agent tool-call JSON** — `Forecast.jsx:315-350` parses `tool_calls[].result` strings; if the agent skips `get_forecast` (already observed in practice with LLMs) the panel silently renders "No feature snapshot yet" with no retry affordance. Prefer sourcing metrics from `/forecast` (which has them) and demote tool-result parsing to fallback.
**F-F2-12 · Alert banner shows only the 3 most recent alerts** — `Dashboard.jsx:167-182`; with hourly re-alerting during a storm (F-B1-16) the "+N more" hides the fact that N+3 identical wind alerts exist. Deduplicate by `kind` for the summary line.

### P3 — Low

**F-F2-13 · `ForecastChart.jsx` (legacy, 129 lines) is superseded by `PBadChart` and unreferenced by pages** — verified imports: only PBadChart is used by Dashboard/Forecast; ForecastChart survives in tests. Delete or mark deprecated.
**F-F2-14 · `Dashboard` and `Forecast` re-implement `WindowToggle`** — `Dashboard.jsx:403-427` vs `Forecast.jsx:223-244` (near-identical, differing in padding classes). Extract.
**F-F2-15 · Loading state renders `Skeleton` as a *refresh icon substitute*** — `Dashboard.jsx:137-141`; a spinner icon exists in the same icon set (`Loader2`); using a skeleton as an animated icon is an odd semantic.
**F-F2-16 · `PBadChart` tooltip contains a mojibake character** — `PBadChart.jsx:170` (`� `) — an encoding artifact in the "·" separator, visible to users on hover. Also at line 376.
**F-F2-17 · KPI "Model in use" shows raw version string** (`lstm-lstm-24h-v1`) — `Dashboard.jsx:264`; fine for operators, noise for dive guides; the provenance strip already shows the full string.
**F-F2-18 · `formatDate` in ActiveLearningNudge constructs `iso + 'T00:00:00'`** — `ActiveLearningNudge.jsx:73-76` parses a date-only string as *local* midnight; consistent with the backend's date-only labels, but worth a comment given F-F2-01's timezone theme.

---

## 4. Web research (what current best practice says)

1. **Communicating forecast uncertainty** — WMO/NOAA guidance: numeric probabilities suit experts; verbal bands + confidence indices suit general users; salience should be tied to *action* thresholds; consistency of framing builds trust; always disclose when a value is a placeholder/fallback rather than a measurement. Sources: [WMO — Communicating Forecast Uncertainty](https://wmo.int) · [NOAA — Communicating Probability Information (Ripberger et al. 2022)](https://www.noaa.gov) · [National Academies, ch. 4](https://www.nationalacademies.org).
2. **Visualization** — confidence bands and error bars are the two canonical encodings for uncertainty around a line; progressive disclosure (simple default + drill-down) prevents clutter. Sources: [Claus Wilke — Visualizing Uncertainty](https://clauswilke.com) · [UX data-uncertainty visualization](https://medium.com).
3. **Safety-decision UIs** — degraded states must be *visually distinct* from nominal states; a system that silently renders fallback values as normal is the classic failure mode in decision-support audits. SeaSID has all the data it needs (`degraded`, `fallback_hours`, `degraded_reason`) — the gap is purely presentation.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Never render fallback as measurement | Fabricated 0.5 and null→0 plotted as safe | **Major** (P0) |
| Correct time semantics on decision screens | Local time labeled "UTC" | **Major** (P0) |
| Visual distinction for degraded data | Fields exist, unrendered | Major (P1) |
| Uncertainty cue next to point estimates | None | Missing (P2) |
| Single threshold source of truth | 4 copies | Partial (P1) |
| Race-safe data fetching | Counter in Forecast; boolean in Dashboard | Partial (P1) |
| Progressive disclosure / info hierarchy | ✅ Provenance strip + chips + KPIs well layered | Met |
| Accessible dialogs, aria labels, motion-reduce | ✅ Nudge dialog exemplary | Met |
| Optimistic UI / skeleton states | ✅ Skeletons mirror layout order | Met |

## 6. Recommendations (prioritized)

1. **P0 — Fix the UTC labels** (drop suffix or `timeZone: 'UTC'`) in Dashboard + ForecastProvenance; add a test that renders with a non-UTC timezone.
2. **P0 — Render degraded states:** feed `forecast.degraded` into `FreshnessStack` on both pages; badge hours with `degraded_reason`; plot null p_bad as gaps, never 0; show a warning banner when `fallback_hours > 0`.
3. **P1 — Replace Dashboard's boolean cancel with the request-counter pattern** (extract a shared hook).
4. **P1 — Centralize thresholds in `lib/riskLevels.js`** (and consider serving them from `/sites` or config so tuning doesn't need a rebuild).
5. **P2 — Briefing generation strategy** (server-side per ingest or explicit button); default nudge confidence to `med`; key dismissals to model version; uncertainty chip on the optimal-window card.
6. **P3 — Extract `WindowToggle`; delete `ForecastChart.jsx`; fix the two mojibake glyphs; dedupe alert summary by kind.**

---

### What these screens do well (worth keeping)

- The provenance surface (data-as-of, per-source freshness chips, provider map, model version, generated-at) is exactly what the WMO/NOAA material asks for — the design is ahead of typical dashboards; it just needs the degraded-state wiring.
- The ActiveLearningNudge is a genuinely well-crafted operator interaction: card-deck metaphor, motion-reduce support, persisted dismissal, machine-readable comment trail, and honest "model said 47%" framing.
- PBadChart's theme-reactive color system via `useSyncExternalStore` + CSS custom properties is a clean pattern for Recharts theming.
- Skeleton layouts mirror the loaded page structure order-for-order — no layout shift.
- Accessibility is consistently above average (aria-pressed toggles, labeled dialogs, roles on errors, aria-hidden decorative icons).
