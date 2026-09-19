# F6 — Cockpit Shell & Experiments Audit: Layout, cockpit/*, Experiments, Skeleton, Dropdown, Icons

> Audited 2026-09-19 · ~1,430 lines · Lens: app-shell quality, live-run UX, metric presentation honesty

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/pages/Experiments.jsx` | 486 | Results table + SSE live run progress |
| `frontend/src/components/Layout.jsx` | 129 | Desktop rail shell / mobile shell, ⌘K palette, FAB mount |
| `frontend/src/components/cockpit/SidebarNav.jsx` | 164 | Nav rail with collapse |
| `frontend/src/components/Skeleton.jsx` | 188 | Skeleton primitives + page-shape composites |
| `frontend/src/components/Dropdown.jsx` | 89 | Legacy dropdown (pre-Radix) |
| `frontend/src/components/cockpit/CommandPalette.jsx` | 114 | ⌘K palette (cmdk) |
| `frontend/src/components/cockpit/StatusBar.jsx` | 88 | Branding + clock + theme toggle |
| `frontend/src/components/cockpit/useLayoutPrefs.js` | 80 | Collapsed-state persistence + multi-tab sync |
| `frontend/src/components/cockpit/MobileDrawers.jsx` | 50 | Mobile nav sheet |
| `frontend/src/components/Icons.jsx` | 48 | Brand icon helpers |

---

## 2. How it works

`Layout` renders a desktop shell (collapsible rail + outlet + StatusBar) or a mobile shell (outlet + StatusBar with drawer triggers), mounts the CommandPalette (⌘K / `Ctrl+K`) and the `AgentFab` above both, and snaps the rail open when crossing back from mobile. `useLayoutPrefs` persists collapse state in localStorage with `storage`-event sync across tabs. `Experiments` loads `/experiments/results`, renders a 4-model × 5-metric table (tolerant of four payload shapes), and streams runs via `runExperimentsStream` with staged progress (`starting → loading → running → complete/error`), a bounded 500-line log with stick-to-bottom scrolling, live metric rows, and `seasid:experiments-complete` + `seasid:refresh` broadcasts on completion.

---

## 3. Findings

### P1 — High

**F-F6-01 · "Cancel" stops the UI, not the training** — `Experiments.jsx:169-176` closes the client SSE stream, but the backend runs the suite in a daemon worker thread (`main.py:799-817`) with no cancellation flag; the run trains to completion and *then still reloads the model and invalidates every forecast cache*. The operator believes they stopped a multi-minute job that is actually still consuming CPU and will mutate serving state on completion. Minimum fix: a server-side cancellation token checked between suites (thread-safe `Event`), surfaced as a `cancelled` terminal frame; label the button "Detach" until then.

### P2 — Medium

**F-F6-02 · Results table silently mixes held-out and CV metrics** — `Experiments.jsx:296-307`: missing top-level metrics fall back to `train_metrics.cv_*` in the same cell, so a row can show test-set F1 for one model and cross-validation accuracy for the next with no visual distinction. MLOps guidance is to default every dashboard to held-out metrics and label anything else explicitly ([LaunchDarkly on experiment-tracking governance](https://launchdarkly.com), [Comet on comparison layouts](https://comet.com)). Show a per-cell source tag or a separate "CV" column.
**F-F6-03 · Stale copy: "LeaveOneOut cross-validation"** — `Experiments.jsx:184` and the table description (`:320`) describe the *XGBoost trainer's* small-data CV, while the suite actually uses the time-aware blocked split (70/15/15 with purge). Operators comparing "LOO" in the header against logs showing "Train: …, Test: …" get contradictory stories.
**F-F6-04 · StatusBar doesn't render the model chip its own docs promise** — `main.jsx:8-13` says the StatusBar reads ModelStatusContext "instead of issuing a second GET /health"; the component (`StatusBar.jsx`) shows branding, clock, and theme toggle only — `useModelStatus` is unused there. The "which model am I being served by?" chip was the documented point of the context. Either render it (one badge) or fix the docstrings.
**F-F6-05 · Results payload's richer data is dropped** — the backend includes `dataset` (split boundaries, purge, per-site counts, positive ratio), `ablations`, `timestamp`, and `confusion_matrix` per model; the page renders only the 5-metric table + best-model badge. Ablations (the page's headline feature per README: "4 models × 4 ablations") are computed, persisted, and never shown.

### P3 — Low

**F-F6-06 · `Dropdown.jsx` (legacy, 89 lines) survives alongside Radix dropdown-menu** — referenced by older components/tests only; mark deprecated or delete.
**F-F6-07 · `RunProgress` highlights lines by prefix matching "Training:"/"Evaluating:"** — `Experiments.jsx:473`; the actual log lines from `experiments.py` begin "  Training:" / "  Evaluating:" (leading spaces are preserved, `.trim()` handles it — but the text has moved across refactors before); keying on structured `status`/`metric` events would be robust.
**F-F6-08 · Experiments refresh loop refetches on every `seasid:refresh`** — including the one *this page dispatches* after a run (harmless double-fetch of results).
**F-F6-09 · `useLayoutPrefs` stores booleans as '1'/'0' strings** — fine, but a JSON `true/false` would survive future shape changes better; legacy-key cleanup exists (nice).
**F-F6-10 · StatusBar clock updates every 30 s** — a clock that can be up to 29 s stale on a wall-clock display; 1 s tick with CSS-minuted rendering is the usual approach (cost trivial).
**F-F6-11 · CommandPalette/`Skeleton`/`Icons` are clean** — no findings beyond style consistency; the Skeleton composites mirror each page's real layout order, which is the right way to avoid CLS.

---

## 4. Web research (what current best practice says)

1. **Experiment-tracking UIs** — surface held-out metrics by default with plain-language framing ("performance on data the model never saw"), keep training/CV metrics secondary, show run lineage (timestamp, dataset boundaries), and frame promotion decisions ("safe to serve?") for non-experts; parallel-comparison tables and diffs are the digestible format. Sources: [LaunchDarkly — experiment tracking best practices](https://launchdarkly.com) · [Comet — experiment management](https://comet.com) · [DagsHub guide](https://dagshub.com).
2. **Long-running job UX** — cancellable work needs a *server-side* cancellation path; client-only detach must be labeled as such, and the UI should reflect the true terminal state (the job later finishing must still update the page).
3. **App-shell** — persisted view state with cross-tab sync (as `useLayoutPrefs` does) and responsive rail/mobile switching are current best practice; this shell is well ahead of typical dashboards.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Server-side cancellation for long jobs | Client-detach only; job completes anyway | Major (P1) |
| Held-out metrics clearly separated from CV | Silent per-cell fallback mixing | Major (P2) |
| Show the data you already computed (ablations, lineage) | Rendered: 5 metrics only | Partial (P2) |
| Consistent doc ↔ behavior (model chip) | Docstring promises, component lacks | Partial (P2) |
| Accurate methodology copy | "LOO" while suite uses blocked split | Partial (P3) |
| Log viewer with stick-to-bottom + bounds | ✅ Best-in-repo implementation | Met |
| Responsive shell, persisted prefs, multi-tab sync | ✅ | Met |
| Event-driven cross-page refresh | ✅ Well-orchestrated two-event broadcast | Met |

## 6. Recommendations (prioritized)

1. **P1 — Implement server-side cancellation** (`threading.Event` checked between models; new SSE frame `{"type":"cancelled"}`), and make Cancel deterministic.
2. **P2 — Render ablations + dataset lineage** (boundaries, purge, per-site counts, run timestamp) — the data is already in the payload; a collapsible section suffices.
3. **P2 — Per-metric source tags or a CV column; fix the "LeaveOneOut" copy; add the model chip to StatusBar (or update `main.jsx` docs).**
4. **P3 — Retire legacy `Dropdown.jsx`; robust log highlighting via structured events; faster clock tick.**

---

## 7. Addendum (post-verification pass): `components/ui/*` primitives spot-check

> Audited 2026-09-19, second pass · 22 files, ~1,775 lines · All primitives opened or scanned; import graph counted.

### 7.1 Method

The six most substantial primitives (`dropdown-menu` 221, `select` 168, `command` 157, `dialog` 147, `sheet` 141, `table` 121) were read directly; the remaining 16 were scanned via grep for hardcoded colors, `displayName`/naming, aria attributes, and consumer counts across the whole app (all import forms: `@/components/ui/*`, `./ui/*`).

### 7.2 What the scan found

**Quality: high and uniform.** Every primitive is a faithful shadcn/ui v4-style wrapper: Radix behavior underneath (focus trap, Escape, `aria-modal`, roving focus in menus), CVA variant maps, `data-slot` attributes for testability, and **semantic design tokens only — zero hardcoded hex colors in any of the 22 files** (grep-verified). Inputs carry `aria-invalid:` styling; dialog/sheet close buttons include `sr-only` labels; the `showCloseButton` extension is threaded through both dialog and sheet consistently. Missing `displayName` on a few files is harmless — they're named function declarations, so React infers names for DevTools.

**P2 · F-F6-A1 · Six primitives have zero consumers — ~370 lines of dead surface.** Verified import census across the app: `resizable` (0 imports; its `react-resizable-panels` dependency in `package.json` exists *only* for this unused file), `alert` (0 — while Dashboard/Verify/Experiments hand-roll error banners with identical border/icon/role="alert" styling), `popover` (0), `scroll-area` (0), `checkbox` (0 — UsersAdmin/ApiKeysAdmin use raw `<input type="checkbox">` instead), `textarea` (0 — while the F3 audit recommends exactly this component for Verify's comments field). Either delete them or, better, adopt `alert` + `textarea` where pages currently hand-roll equivalents (F3 rec #4, F4 polish).

**P3 · F-F6-A2 · Minor inconsistencies inside otherwise-identical wrappers** — dialog's close button uses `focus:ring-2 focus:ring-offset-2` while sheet's uses the newer `outline-hidden`/`rounded-xs` tokens; the two were copied from different shadcn generations. Cosmetic; unify on one generation.

**P3 · F-F6-A3 · `label.jsx`/`input.jsx` pair is correct** (htmlFor/id wiring used consistently by callers; `aria-invalid` data-attribute hooks present), and `command.jsx` correctly wraps cmdk for the palette. No accessibility findings anywhere in the primitive layer — the Radix foundations do the heavy lifting and were not bypassed.

### 7.3 Verdict

The primitive layer is the least problematic code in the repository: consistent, token-pure, accessible by construction, and testable via `data-slot`. The only real action item is deleting or adopting the six unused primitives (F-F6-A1) so the UI kit matches reality.

---

### What this area does well (worth keeping)

- `RunProgress` is the reference implementation for log streaming in this repo: bounded buffer, stick-to-bottom ref pattern with scroll-distance detection (exactly what AgentFab's transcript needs — F-F5-07), stage icons with motion, and structured stage badges.
- The two-event completion broadcast (`experiments-complete` + `refresh`) is a clean, decoupled way to push model changes through every screen without polling.
- The shell work is excellent: width-transition rail with persisted state, mobile→desktop snap-back, ⌘K palette, single FAB mount, and a StatusBar that stays one `h-8` strip across breakpoints.
- `ResultsCard`'s four-shape tolerance keeps the page rendering across backend schema evolution — defensive without being unreadable.
- Skeleton composites per page shape are consistently used; no layout-shift anywhere in the cockpit.
