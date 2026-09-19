# F3 — Map & Verify Screens Audit: MapPage, Verify, SiteSelector, ConfirmDialog

> Audited 2026-09-19 · ~1,380 lines · Lens: geospatial UX, data-entry correctness, operator trust

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/pages/MapPage.jsx` | 594 | Leaflet map, risk heat-radii, theme tiles, site tiles |
| `frontend/src/pages/Verify.jsx` | 579 | Operator ground-truth form (dialog) + observations table |
| `frontend/src/components/SiteSelector.jsx` | 89 | Shared site picker with loading/error states |
| `frontend/src/components/ConfirmDialog.jsx` | 117 | Accessible confirm dialog + `useConfirmDialog` hook |

---

## 2. How it works

**MapPage** builds one Leaflet instance (scroll/zoom locked behind a click-to-enable overlay), swaps OSM↔CARTO-dark tile layers on theme change, and redraws concentric "heat" circles + pulsing markers per site whenever `sites`/`forecasts` change. Forecasts for all sites load in parallel with a monotonic fetch token; `seasid:refresh` triggers a silent reload. Popup/tooltip HTML is hand-built with `escapeHtml()`. Below the map, `SiteTile` cards mirror the same data for keyboard/screen-reader users and — notably — wire `FreshnessStack` with `forecast.degraded` (the only screen that does).

**Verify** lists the last 15 labels (all sites) and opens a dialog form (site, optional operator name, date, current, verdict cards, viz meters, Phase-5 reason + confidence, comments) that POSTs `/verify` and refreshes the table.

---

## 3. Findings

### P1 — High

**F-F3-01 · Verify table's "Site" column shows wrong values** — `Verify.jsx:505` renders `lbl.site_key || lbl.source?.split('_')[0]`. The `/labels` API (`schemas.py:120-129`) does **not** return `site_key`, so the first branch is always falsy and the column displays the first token of `source` — an operator submission shows "operator", synthetic rows show "synthetic". Misattributing *whose observation this was* on the ground-truth review screen erodes exactly the trust the screen exists to build. Fix: add `site_key` to `LabelEntry` (one line in `get_labels`) and render it.

**F-F3-02 · The "Operator name" input is dead** — `Verify.jsx:228-237` collects a free-text operator name, but the backend deliberately overwrites it with the authenticated principal (`main.py:308-324`: "recorded … regardless of any spoofed value in the request body"; `services.py:356` prefers `actor_username`). The UI field silently does nothing — worse, it *implies* the entry is recorded. Rename to "Shop / team (notes only)" and move it into comments, or persist it as a separate `shop_name` field (the DB column exists — `db.py:168` — and is unused by this path).

**F-F3-03 · SiteSelector ignores the signed-in user's site scope** — `SiteSelector.jsx:18-49` renders every registered site; a `dauin_muck`-scoped operator can select Apo Reef and receive a raw 403 ("You are not assigned to this site") as the page's error banner. Filter `sites` against `useAuth().user.site_keys` (hide unscoped sites; show a hint when only one remains).

### P2 — Medium

**F-F3-04 · MapPage provenance strip borrows an arbitrary site's data** — `MapPage.jsx:344-353`: `Object.values(forecasts).filter(Boolean)[0]` — the "Data as of / Providers / Model" shown page-wide belongs to whichever site JSON-serialized first. With two sites ingested at different times the strip can disagree with one of the tiles directly beneath it. Aggregate (min data_as_of, union of providers) or render per-site chips in each tile.
**F-F3-05 · Map redraw calls `fitBounds` on every data change** — `MapPage.jsx:283`: a background `seasid:refresh` (e.g. after an experiment run) yanks the user's pan/zoom back to the site bounds. Only fit on first draw or when the site set changes.
**F-F3-06 · `today()` uses UTC date** — `Verify.jsx:61`: `new Date().toISOString()` — a Philippine operator submitting at 01:00 local (17:00 UTC prev. day) gets *yesterday's* date pre-filled for "today's" conditions. Use the local date (`new Date().toLocaleDateString('en-CA')`) or the site's timezone.
**F-F3-07 · Duplicate submission UX** — submitting the same (site, date, operator) twice returns the backend's 500 (F-B3-05); the dialog shows "Could not save observation" with no hint that the observation already exists. Map a 409/500-with-constraint message to "An observation for this date already exists."
**F-F3-08 · Comments input is a single-line `Input` with no max length** — `Verify.jsx:382-388`; multi-line field notes are natural here (`Textarea` exists in the UI kit), and the missing client bound pairs with F-B3-15's missing server bound.
**F-F3-09 · Light theme uses `tile.openstreetmap.org`** — `MapPage.jsx:31-32`: the OSMF tile policy reserves the public tile server for testing/low-traffic, explicitly directing production apps to OSM-derived providers ([OSMF Tile Usage Policy](https://operations.osmfoundation.org)). The dark theme already uses CARTO — use CARTO `light_all` for the light theme too and the policy concern disappears.

### P3 — Low

**F-F3-10 · Pulse animation runs a permanent rAF loop per site** — `MapPage.jsx:224-238`; fine at 2 sites, costly at 20; respect `prefers-reduced-motion` (the nudge dialog does).
**F-F3-11 · Popup "Coords" row has no link** — rendering the lat/lon as a plain string misses a free win: link to the same coordinates in Google Maps / OSM for route planning.
**F-F3-12 · `ConfirmDialog.handleConfirm` closes the dialog even if `onConfirm` throws** — `ConfirmDialog.jsx:48-51`; callers doing async work in `onConfirm` should control closing (the docstring says so; the default still closes synchronously — harmless today, trap later).
**F-F3-13 · `SiteSelector` refetches `/sites` in every mounted instance** — Dashboard, Forecast, Verify, Map tiles each hit the endpoint; a tiny module-level cache (TTL 5 min) or context would cut chatter.
**F-F3-14 · Verify table has no empty-vs-loading distinction** — initial load shows "No observations yet" while the request is in flight.

---

## 4. Web research (what current best practice says)

1. **Map scroll-capture** — inline scrollable maps hijacking page scroll is a documented anti-pattern (Baymard: 26 % of sites get it wrong); the recommended pattern is *exactly* what MapPage implements: `scrollWheelZoom: false` by default plus a click-to-activate overlay with an explicit lock toggle. Sources: [Baymard Institute — inline scroll areas](https://baymard.com) · [NN/g on scrolljacking](https://www.nngroup.com) · [UX StackExchange — interactive mobile maps](https://ux.stackexchange.com).
2. **Tile providers** — OSMF policy: public tiles for dev/low traffic only; CARTO/MapTiler/self-hosted for production. Source: [OSMF Tile Usage Policy](https://operations.osmfoundation.org).
3. **Ground-truth data entry** — form guidance for safety domains: capture structured reason + confidence (SeaSID's Phase-5 design is textbook), never pre-fill trust-max defaults, and always show the *effective* attribution (who is recorded) rather than an ignored input.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Click-to-activate map overlay + lock toggle | ✅ Implemented exactly as recommended | Met |
| Keyboard/screen-reader alternative for map data | ✅ SiteTile cards mirror all data | Met |
| Production tile provider | OSM public tiles for light theme | Partial (P2) |
| Effective attribution shown to the user | Operator input dead; site column wrong | Major (P1 ×2) |
| Scope-aware site picker | All sites rendered | Missing (P1) |
| Aggregate provenance on multi-site screens | First-site provenance page-wide | Partial (P2) |
| Local-date correctness for field records | UTC date pre-fill | Partial (P2) |
| Structured reason + confidence capture | ✅ Phase-5 fields with good labels | Met |

## 6. Recommendations (prioritized)

1. **P1 — Add `site_key` to the labels API response** and render it; remove/repurpose the dead operator input (use `shop_name`).
2. **P1 — Scope the SiteSelector** by `useAuth().user.site_keys`; for `*` users show all.
3. **P2 — MapPage: aggregate provenance; fitBounds only on first load; switch light tiles to CARTO; guard fitBounds behind "sites changed".**
4. **P2 — Verify: local-date pre-fill; duplicate handling message; `Textarea` + maxLength for comments.**
5. **P3 — Reduced-motion for map pulses; coordinate links; site-list caching; loading state for the table.**

---

### What these screens do well (worth keeping)

- The map interaction model (locked by default → click to enable → explicit lock button) is a best-practice implementation of a pattern most dashboards get wrong, with correct `requestAnimationFrame` cleanup and a thoughtful `invalidateSize` strategy that avoids blank tiles under Radix overlays.
- `escapeHtml()` on every interpolated popup field shows real XSS discipline in the one place React doesn't control the DOM.
- MapPage is the only screen that wires `forecast.degraded` into `FreshnessStack` — copy this wiring to Dashboard/Forecast (F-F2-02).
- Verify's verdict cards with plain-language descriptions, optional-vs-required labeling, and the Phase-5 reason/confidence selectors are a model ground-truth form.
- `ConfirmDialog` + `useConfirmDialog` is the right replacement for `window.confirm`, built test-first ("give tests a real DOM node").
