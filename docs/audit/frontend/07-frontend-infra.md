# F1 — Frontend Infrastructure Audit: api.js, AuthContext, LoginPage, ThemeContext, ModelStatusContext, forecastCache, useMediaQuery, utils, entry/routing, build config

> Audited 2026-09-19 · ~1,100 lines + configs · Lens: SPA security, performance, maintainability

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/api.js` | 306 | Backend client: REST + two SSE stream readers |
| `frontend/src/auth/AuthContext.jsx` | 71 | Session bootstrap, login/logout, AuthGate |
| `frontend/src/theme/ThemeContext.jsx` | 60 | dark/light persistence on `<html data-theme>` |
| `frontend/src/components/ModelStatusContext.jsx` | 171 | App-wide model tier + experiment winner cache |
| `frontend/src/lib/forecastCache.js` | 37 | localStorage forecast cache (5-min TTL) |
| `frontend/src/main.jsx`, `App.jsx` | 77 | Provider stack, routes |
| `vite.config.js`, `vitest.config.js`, `eslint.config.js`, `package.json`, `index.html` | — | Tooling |

---

## 2. How it works

`api.js` wraps `fetch` with bearer-token injection from `localStorage` (`seasid.authToken`), a global 401 hook (clear token + `seasid:auth-expired` event), and two hand-rolled SSE readers over `ReadableStream` (agent chat, experiments stream — POST-based, since `EventSource` is GET-only). `AuthContext` validates a stored token on mount via `/auth/me`; `ModelStatusProvider` caches `/health`'s selected tier and listens for `seasid:refresh` / `seasid:experiments-complete` window events to avoid redundant round-trips. `forecastCache` mirrors the backend's 5-minute TTL in `localStorage`. Routes are declared flat under a single `Layout`; the provider stack is Theme → Tooltip → ModelStatus → App.

---

## 3. Findings

### P1 — High

**F-F1-01 · Bearer JWT persisted in `localStorage`** — `api.js:4-13`, `AuthContext.jsx:23`.
2025 consensus: `localStorage` tokens are fully readable by any injected script (a single compromised npm dependency counts); the hardened pattern is a short-lived in-memory access token + `HttpOnly; Secure; SameSite` cookie (with CSRF protection), or at minimum a strict CSP ([Security StackExchange discussion](https://security.stackexchange.com), [Plain English — stop using localStorage for JWTs](https://javascript.plainenglish.io), [Ian London — don't use JWTs for browser sessions](https://ianlondon.github.io)). SeaSID's exposure is bounded (MarkdownResponse sanitizes agent output — verified in F5; no `dangerouslySetInnerHTML` found anywhere in `src`), but the supply-chain risk stands. Combined with the 60-minute token TTL and no revocation (F-B4-05), a stolen token is good for an hour of operator-grade access. Recommendation: in-memory token + silent refresh via cookie; meanwhile add a CSP.

**F-F1-02 · No request timeout anywhere** — `api.js:97-117` uses bare `fetch` with no `AbortSignal.timeout`. A hung backend (e.g. during the unauthenticated `/experiments/run` blocking for minutes, or a dead tunnel) leaves the UI spinner-locked with no recovery path. `setTimeout`-based abort wrappers or `AbortSignal.timeout(15000)` for REST calls are standard.

**F-F1-03 · No route-level code splitting** — `App.jsx:3-10` imports all 8 pages eagerly; Leaflet (~150 KB gz), Recharts (~100 KB gz), and Radix land in one bundle on first paint even though most users visit Dashboard only. `React.lazy` + `Suspense` per route is a one-hour change with a large LCP win on mobile (dive boats run on throttled connections — this is the product's actual audience).

### P2 — Medium

**F-F1-04 · Phantom `hours` parameter sent to `/forecast`** — `api.js:139-140` appends `&hours=${hours}` but the backend route (`main.py:238-246`) declares only `site`; FastAPI silently ignores it. Either wire the parameter through (the backend caches per-horizon already) or drop it — currently the client *believes* it can request other horizons.

**F-F1-05 · No catch-all route** — `App.jsx:19-29` has no `path="*"`; unknown URLs render the Layout chrome with an empty content pane. Add a 404 element that links back to the dashboard.

**F-F1-06 · Duplicated SSE-parsing implementations** — `api.js:38-95` (`streamChat`) vs `api.js:187-265` (`runExperimentsStream`): two hand-rolled frame parsers with subtly different data-line prefixes (`'data:'` vs `'data: '` — the latter breaks if the backend ever emits `data:{json}` without a space). Extract one `parseSseStream(reader, onEvent)` helper; the backend's wire format is identical for both.

**F-F1-07 · `AUTH_TOKEN_KEY` duplicated as a string literal** — `AuthContext.jsx:23` reads `'seasid.authToken'` directly instead of importing the constant from `api.js`; a rename breaks session restore silently.

**F-F1-08 · `VITE_AUTH_ENABLED=false` frontend toggle has no backend counterpart** — `AuthContext.jsx:6`: disabling auth in the UI only fakes a *client-side* session; every real API call still fails (or worse, succeeds unauthenticated given F-B3-01). The flag should also be surfaced from `/health` rather than guessed at build time.

**F-F1-09 · Forecast cache ignores auth scope** — `forecastCache.js`: a site-scoped operator's cached forecast for their site remains in `localStorage` after logout, readable by the next user of the browser (trivially — it's the same data any authenticated user of that site could fetch, but it outlives the session). Clear `seasid.forecast.*` keys on `seasid:auth-expired`/logout.

### P3 — Low

**F-F1-10 · Vite template leftovers ship in the repo** — `src/main.ts`, `src/counter.ts`, `src/style.css` (plus `index.css.fetched.txt` and `frontend/.tmp_eye_hover*.png` at repo root per git status) are dead Vite-scaffold files; `main.ts` even renders its own `#app` DOM. Delete them (they also typecheck/lint for no reason).
**F-F1-11 · Both the `radix-ui` meta-package *and* individual `@radix-ui/react-*` packages are dependencies** — `package.json:35-49`; pick one convention to halve install surface.
**F-F1-12 · `vite.config` dev `host: true` + `.trycloudflare.com` allowedHosts** — `vite.config.js:16-26`: intentional for tunnel demos and commented as dev-only; keep an eye that the prod image builds with a different config.
**F-F1-13 · Google Fonts loaded from CDN without `preconnect` failure fallback or self-hosting** — `index.html:9-11`; offline/boat-network usage falls back to system fonts (acceptable), but self-hosting Inter + JetBrains Mono via @fontsource would remove an external dependency and a privacy leak.
**F-F1-14 · ESLint `react-hooks/exhaustive-deps` only `warn`** — `eslint.config.js:57`; a passing `npm run lint` can still contain stale-closure bugs. Consider `error` and fixing current findings.
**F-F1-15 · No CSP / security headers on the served SPA** — depends on the backend static mount (C2); nothing client-side sets them.

---

## 4. Web research (what current best practice says)

1. **Token storage** — HttpOnly cookies or memory-only tokens; localStorage is acceptable only with strong CSP + dependency integrity. Sources: [Security StackExchange](https://security.stackexchange.com) · [Syncfusion JWT best practices](https://www.syncfusion.com) · [Plain English (2025)](https://javascript.plainenglish.io) · [Ian London](https://ianlondon.github.io).
2. **SPA performance** — route-based code splitting, prefetching likely routes, and lazy-loading map/chart libraries are the standard dashboard pattern; Leaflet and Recharts are both documented as lazy-load candidates.
3. **React 18 patterns** — context + window-event hybrid (as `ModelStatusProvider` does) is fine, but the project should migrate to `useSyncExternalStore` or keep contexts small; the current implementation is already careful about in-flight dedup.
4. **Vite** — `build.rollupOptions.output.manualChunks` is the low-effort alternative to route-splitting when you want to isolate vendor chunks (leaflet, recharts, markdown).

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| HttpOnly/memory token + CSP | localStorage JWT, no CSP | Major (P1) |
| Request timeouts / abortable fetch | None | Major (P1) |
| Route-level code splitting | Single eager bundle | Missing (P1) |
| One SSE parser implementation | Two divergent copies | Partial (P2) |
| 404 route | Missing | Missing (P2) |
| Cache/secret hygiene on logout | Partial (token cleared, forecast cache not) | Partial (P2) |
| Central API client with typed errors + 401 hook | ✅ Good single client, event-driven 401 | Met |
| Theme/model status providers avoid prop-drilling | ✅ Well documented, dedup'd fetches | Met |
| Dead code hygiene | Vite scaffold files remain | Partial (P3) |

## 6. Recommendations (prioritized)

1. **P1 — Timeouts + abort:** default `AbortSignal.timeout(20_000)` in `request()`, longer for SSE; wire the existing abort plumbing through page-level effects.
2. **P1 — Code split:** `const Dashboard = lazy(() => import('./pages/Dashboard'))` etc., with `manualChunks` for leaflet/recharts; measure with `vite build` output sizes.
3. **P2 — Token storage hardening phase 1:** add CSP via backend static middleware; phase 2: move access token to memory + refresh cookie.
4. **P2 — Unify SSE parsing; drop the phantom `hours` param (or implement it); add the 404 route; clear forecast cache on auth events.**
5. **P3 — Delete Vite scaffold leftovers; dedupe Radix packages; self-host fonts; consider `exhaustive-deps: error`.**

---

## 7. Addendum (post-verification pass): LoginPage, useMediaQuery, lib/utils

> Audited 2026-09-19, second pass · ~325 lines · These files complete the F1 coverage claim.

### 7.1 Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/auth/LoginPage.jsx` | 251 | The sign-in screen every user sees (two-panel branded layout) |
| `frontend/src/hooks/useMediaQuery.js` | 55 | SSR-safe matchMedia hook + `useIsDesktop` |
| `frontend/src/lib/utils.js` | 16 | `cn()` clsx+tailwind-merge helper |

### 7.2 Findings — LoginPage

**P2 · F-F1-A1 · Raw backend error text rendered on the login screen** — `LoginPage.jsx:66` (`setError(requestError.message)`). For the expected 401 path this is exactly right: the backend returns the generic "Invalid username or password", which prevents username enumeration ([Security StackExchange — generic auth errors](https://security.stackexchange.com/questions/62661/)). But any non-401 failure — a 500 carrying `detail=str(exc)` (F-B3-11), a network hiccup (`Failed to fetch`), or a future 429 — surfaces its raw message to unauthenticated visitors. Map 401 → generic message, everything else → a sanitized "Cannot reach the sign-in service" with a retry affordance.

**P2 · F-F1-A2 · No rate-limit feedback path exists** — related to F-B3-04 (no throttling server-side). When rate limiting is added, the login form must render "Too many attempts — try again in N minutes" rather than folding a 429 into the generic auth-failure message; PortSwigger documents that showing "invalid credentials" for rate-limit rejections breaks user feedback while still allowing enumeration timing attacks ([PortSwigger — password-based login](https://portswigger.net/web-security/authentication/password-based), [progressive rate limiting](https://medium.com/@erwindev/rate-limiting-for-login-endpoints-stopping-brute-force-without-angering-users-7e8821b139bb)).

**P3 · F-F1-A3 · No `autoFocus` on the username field** — [web.dev's sign-in-form checklist](https://web.dev/articles/sign-in-form-best-practices) recommends focusing the first field on mount (password managers partly cover this; trivially added).

**P3 · F-F1-A4 · No password-recovery affordance** — no "forgot password" link and no self-service reset flow exists; with SMTP configured only for alerts, an operator who forgets a password needs an admin. Even a static hint ("contact your administrator") sets expectations.

**P3 · F-F1-A5 · `blockAsset` right-click/drag prevention is cosmetic** — `LoginPage.jsx:57, 91-93` prevents context menus on branding, but the assets are plain `<img src>` URLs fetchable from devtools/network tab. Harmless, just not protection; a comment saying so would be more honest than the current "kept from being… saved" framing.

**What's done right (verified against the [web.dev checklist](https://web.dev/articles/sign-in-form-best-practices) and [Evil Martians' 11 HTML rules](https://evilmartians.com/chronicles/11-html-best-practices-for-login-and-sign-up-forms)):** correct `autocomplete="username"` / `autocomplete="current-password"` (never `off`); a show-password toggle with `aria-pressed` instead of a type-it-twice field ([Authgear 2025 guide](https://www.authgear.com)); generic auth-failure copy from the backend; native form submit with `required` fields; submit disabled while busy (no double-login); decorative panel + SVG correctly `aria-hidden`; theme toggle reachable; error uses `role="alert"`. The DepthContours/diver atmosphere panel is genuinely tasteful and costs nothing functionally.

### 7.3 Findings — useMediaQuery / utils

**useMediaQuery** is exemplary: SSR-safe initial read, mount-time resync, a *documented* deliberate `exhaustive-deps` suppression with a full explanation of the stale-closure bug it avoids (a zoom desktop→mobile→desktop cycle would otherwise never report `true` again), and `change`-event-driven updates (not the deprecated `addListener`). The `LG_BREAKPOINT_PX` constant ties the JS breakpoint to Tailwind's `lg` — one nit: nothing enforces that coupling if the Tailwind config changes; a comment cross-link exists, keep it accurate.

**lib/utils.js** is the standard `cn()` helper; nothing to find. Its only observation is architectural: 22 `ui/*` primitives + every page depend on it, so tailwind-merge's class-conflict resolution is load-bearing for the whole design system (fine — just don't swap it casually).

### 7.4 Research recap (login UX/security)

Sources: [web.dev — sign-in form best practices](https://web.dev/articles/sign-in-form-best-practices) · [Evil Martians — 11 HTML best practices for login forms](https://evilmartians.com/chronicles/11-html-best-practices-for-login-and-sign-up-forms) · [Authgear — Login & Signup UX 2025](https://www.authgear.com) · [Security StackExchange — generic auth errors](https://security.stackexchange.com/questions/62661/) · [NN/g error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/) · [PortSwigger — password-based login vulnerabilities](https://portswigger.net/web-security/authentication/password-based).

**Verdict:** LoginPage implements most of the canonical checklist natively (autocomplete, toggle, generic errors, busy state, a11y); the gaps are the error-sanitization funnel (F-F1-A1), rate-limit feedback (blocked on backend F-B3-04), autofocus, and a recovery hint.

### 7.5 Findings — useMediaQuery verdict

No material issues; the deliberate-deps suppression is documented well enough to serve as the repo's reference example for `exhaustive-deps` exceptions. `lib/utils.js` is fine as-is.

---

### What this area does well (worth keeping)

- The global `seasid:auth-expired` event → context reset pattern is clean and tested; 401 handling lives in exactly one place.
- `ModelStatusContext` is thoughtfully engineered: in-flight dedup, event piggybacking on existing refresh channels, frozen fallback for tests — and the docstring explains the tier-vs-winner distinction correctly (which matters given F-B2-01).
- `forecastCache` mirrors the backend TTL exactly and degrades silently under quota/private mode.
- The POST-SSE experiment stream with `AbortController` cleanup and `close()` return is the right design for a cancellable long-running job.
- ESLint flat config is modern and scoped (test globals isolated; JSX-aware unused-vars).
