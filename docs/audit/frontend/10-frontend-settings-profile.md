# F4 — Settings, Profile & Admin Screens Audit: Settings, Profile, ApiKeysAdmin, UsersAdmin, UserMenu

> Audited 2026-09-19 · ~1,960 lines · Lens: settings honesty, secrets-display security, admin ergonomics

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/pages/Settings.jsx` | 575 | Appearance / Agent (tools + default site) / Users / API keys / About tabs |
| `frontend/src/components/admin/ApiKeysAdmin.jsx` | 681 | Provider tabs, key CRUD, reveal/copy with 30 s auto-hide, LLM base URL |
| `frontend/src/components/admin/UsersAdmin.jsx` | 367 | User table + create/edit/delete dialogs |
| `frontend/src/pages/Profile.jsx` | 209 | Identity card, password change, "sign out everywhere" |
| `frontend/src/components/UserMenu.jsx` | 132 | Account dropdown with role badge + sign-out confirm |
| `frontend/src/agent/registry.js` | ~130 | Static tool snapshot merged with live `/agent/tools` |

---

## 2. How it works

Settings persists tab / default-site / tool-toggles in `localStorage`, merges a static tool snapshot with the live `/api/v1/agent/tools` payload (built-ins win; MCP tools appended), and gates the Users/API-keys tabs behind `user.role === 'admin'` (client-side only; the server re-checks). ApiKeysAdmin groups keys per provider tab, supports reveal (`/reveal` → plaintext in state, auto-hidden after 30 s via a timer ref cleaned up on unmount), clipboard copy, edit (blank value keeps the secret), and delete with `ConfirmDialog`. UsersAdmin is straightforward CRUD with comma-separated site-scope editing, 8-char password checks, and a dedicated delete-confirmation dialog.

---

## 3. Findings

### P0 — Critical (trust)

**F-F4-01 · The "Tool access" toggles are a placebo** — `Settings.jsx:153-155` writes `seasid.toolsEnabled` to localStorage; **no other file reads it** (verified by repo-wide grep — the agent chat and backend never see it). The on-screen copy states "Disabled tools are omitted from the model tool list" (`Settings.jsx:290`), which is false: the backend always sends every enabled tool. An operator who believes they've revoked `web_search` from the assistant has done nothing — on a feature whose whole purpose is constraining what the AI may consult. Fix: send the disable-list with each `/agent/chat` request and filter `get_active_tool_definitions()` server-side, or relabel the table "Tool reference (read-only)" until supported.

**F-F4-02 · "Default site" setting is likewise never consumed** — `Settings.jsx:88, 139` persists `seasid.defaultSite`; grep shows zero consumers. The Agent FAB and Forecast page hardcode `dauin_muck`. Either wire it into `AgentFab`/`Forecast` initial state or remove the control.

### P1 — High

**F-F4-03 · "Sign out everywhere" overpromises** — `Profile.jsx:174-188`: the button and its confirm dialog ("End this session on every device currently signed in") actually just clear localStorage on *this* device; other sessions keep valid tokens for up to 60 minutes (no server-side revocation exists — F-B4-05). Rename to "Sign out" until token revocation exists, or implement it (token version column checked in `get_current_principal`).

**F-F4-04 · Revealed API key sits in React state + DOM for 30 s with no re-auth** — `ApiKeysAdmin.jsx:144-168`. The pattern matches industry practice (mask by default, temporary reveal — [Phase docs](https://docs.phase.dev), [Keycloak issue #18296](https://github.com/keycloak/keycloak/issues/18296)) and SECURITY.md documents the 30 s auto-hide. Gaps vs the OWASP secrets-management guidance: no step-up authentication before reveal (any unattended admin browser = one click to plaintext), no clipboard auto-clear after copy (clipboard history/sync keeps the secret — [OWASP Secrets Management](https://cheatsheetseries.owasp.org)), and the reveal/copy events are unlogged beyond URL access logs. Minimum hardening: re-enter password to reveal, clear clipboard after ~30 s, emit an audit event.
**F-F4-05 · Key-value input uses `type="password"` + `autoComplete="off"`** — `ApiKeysAdmin.jsx:644-652`: reasonable, but browser extensions that "read all form data" and built-in password managers remain an exposure path for the typed key ([Vaultwarden discussion](https://github.com/dani-garcia/vaultwarden/discussions/7226)). Show-once-at-creation (never re-reveal) is the stronger pattern if the workflow allows it.

### P2 — Medium

**F-F4-06 · Admin lockout is one click away** — `UsersAdmin.jsx` offers disable/delete for every row including the signed-in admin; no "this is you" guard (mirrors F-B3-14). Combined with no second admin requirement, a single misclick bricks operator access until CLI surgery.
**F-F4-07 · Site scopes are free-text commas** — `UsersAdmin.jsx` edit dialog parses `site_keys` from a comma string with no validation against `site_keys()`; a typo (`apo reef`) creates a scope that silently matches nothing (fail-closed at least) — show the two valid keys as toggle chips instead.
**F-F4-08 · Settings tool table shows MCP tools as toggleable** — same placebo issue as F-F4-01 but worse optics: `web_search` renders a Switch an admin can turn "off" while the agent keeps using it.
**F-F4-09 · Default-site selector uses hardcoded `fallbackSites`, not the server list** — `Settings.jsx:148-151, 270-282`: the picker always shows exactly two sites (labeled from code), with only a textual hint "Server has N sites registered" when they disagree. Feed it the fetched `sites`.
**F-F4-10 · `ProviderStatus` infers "Default provider, no key required" from name equality** — `Settings.jsx:506-526`: a custom provider *named* `open_meteo` would render the default blurb; also shows nothing about whether a *key* exists (the actual operator question). Cross-link to the API-keys tab.
**F-F4-11 · Profile password change lacks a strength hint** — accepts `12345678`; the backend matches (min 8). A zxcvbn-style meter or at least a composition hint is standard for a system guarding dive-safety configuration.
**F-F4-12 · ApiKeysAdmin hardcodes the provider list** — `ApiKeysAdmin.jsx:41-66` duplicates the backend's `PROVIDER_LABELS`; adding a provider (e.g. `mcp_minimax` override) requires a frontend deploy, and the tabs ignore rows from unknown providers (they vanish from the UI though still active server-side — visible only via `/admin/api-keys` raw JSON).

### P3 — Low

**F-F4-13 · `Settings` persists tab state globally per browser, not per user** — two admin accounts sharing a browser inherit each other's last tab; harmless but surprising.
**F-F4-14 · UserMenu role badge colors keyed off `data_steward: 'amber'` / `operator: 'emerald'` custom tokens** — works, but duplicates the role→color mapping that `Profile.jsx` also encodes; extract one map.
**F-F4-15 · `McpStatusBadge` uses raw Tailwind emerald/amber instead of the semantic tokens used everywhere else** — `Settings.jsx:545-558`; theme drift risk.
**F-F4-16 · ApiKeysAdmin "last used" timestamp has no relative formatting** — raw `toLocaleString` while FreshnessBadge elsewhere shows "3h"; consistency nit.
**F-F4-17 · UsersAdmin "Loading users…" is text while sibling screens use Skeletons** — minor inconsistency.

---

## 4. Web research (what current best practice says)

1. **Secret display** — mask by default; explicit temporary reveal; prefer copy-over-display; auto-hide after seconds; write-once for high-value keys; audit reveal/copy events; step-up auth for reveals on privileged consoles. Sources: [Phase — secret reveal pattern](https://docs.phase.dev) · [Keycloak admin-UI masking issue](https://github.com/keycloak/keycloak/issues/18296) · [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org).
2. **Clipboard & browser exposure** — clipboard contents persist in history/sync; auto-clear after ~30 s; `type="password"` reduces but does not eliminate extension/manager capture. Sources: [Sailfish clipboard discussion](https://forum.sailfishos.org) · [Vaultwarden on managers vs masking](https://github.com/dani-garcia/vaultwarden/discussions/7226) · [Dashlane on password-manager risk](https://www.dashlane.com/blog/risks-using-browser-password-manager).
3. **Settings UX** — every control that *appears* to change server behavior must either do so or be explicitly labeled as local/reference; "dark patterns" of the accidental kind (placebo toggles) are a recurring trust-killer in admin consoles.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Settings controls do what they claim | Tool toggles + default site are placebos | **Major** (P0, trust) |
| Mask-by-default + temporary reveal + no-store | ✅ Implemented, matches SECURITY.md | Met |
| Step-up auth + audit for secret reveal | Neither | Missing (P1) |
| Clipboard auto-clear for secrets | Copy persists indefinitely | Missing (P1) |
| Admin self-lockout guards | None | Missing (P2) |
| Scope validation against site registry | Free-text commas | Partial (P2) |
| Provider list single-sourced | Duplicated frontend/backend | Partial (P2) |
| Consistent CRUD dialogs, destructive confirmations | ✅ Delete user/key both confirmed | Met |
| Role-gated admin surfaces (client + server) | ✅ Both layers | Met |

## 6. Recommendations (prioritized)

1. **P0 — Make the tool toggles real:** pass `disabled_tools` in `AgentChatRequest`, filter in `get_active_tool_definitions()`, persist per-user server-side (a small `user_prefs` table) — or relabel the section as reference-only today.
2. **P0 — Wire or remove the "Default site" setting** (one `useState` initializer in AgentFab/Forecast reads localStorage).
3. **P1 — Reveal hardening:** require password re-entry before `/reveal`, auto-clear clipboard 30 s after copy, add audit events for reveal/copy.
4. **P1 — Relabel "Sign out everywhere" → "Sign out"** until server-side revocation exists (then implement F-B4-05's token-version check).
5. **P2 — Admin safety rails:** block disable/delete of the current admin; site-scope chips from `site_keys()`; provider list fetched from the backend.
6. **P3 — Token/color map extraction; semantic tokens in `McpStatusBadge`; relative timestamps; skeleton for UsersAdmin loading.**

---

### What these screens do well (worth keeping)

- ApiKeysAdmin is the most polished component in the repo: per-provider tabs with counts, LRU usage stats and last-error surfacing per key, edit-without-requiring-value, destructive confirmations, timer cleanup on unmount, and test-ids throughout.
- The static-tools + live-tools merge ("never replace a built-in") keeps the reference table populated during backend outages — a resilient pattern.
- Role gating is consistently doubled (tab visibility client-side + server 403s), and the About tab explains exactly which settings are browser-local.
- Profile's identity card correctly frames itself as "read-only details from your bearer token" — honest about the JWT-claims source.
- ConfirmDialog reuse across key deletion, user deletion, and sign-out gives the whole admin area a consistent destructive-action grammar.
