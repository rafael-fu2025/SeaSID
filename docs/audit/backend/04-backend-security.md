# B4 — Security Audit: auth.py, secret_store.py, provider_keys.py, SECURITY.md claims

> Audited 2026-09-19 · ~1,030 lines + SECURITY.md · Assumption-breaking reviewed per file

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `backend/app/auth.py` | 393 | PBKDF2 password hashing, HS256 JWT, roles, site scopes, dev defaults |
| `backend/app/secret_store.py` | 149 | Homegrown Fernet-style envelope for provider keys |
| `backend/app/lib/provider_keys.py` | 489 | Key CRUD, LRU rotation, cooldown/error tracking, MCP key resolution |
| `SECURITY.md` | 71 | Authoritative security claims (checked against code) |

Functions audited: `auth_enabled`, `auth_secret`, `configured_users`, `get_active_users`, `hash_password`, `verify_password`, `authenticate_user`, `create_access_token`, `get_current_principal`, `ensure_role`, `ensure_site_access`, `encrypt`, `decrypt`, `load_or_create_master_key`, `pick_provider_key`, `mark/clear_provider_error`, `resolve_mcp_minimax_key`, `normalize_legacy_provider_rows`, admin key handlers (cross-ref B3).

---

## 2. How it works

**Auth:** PBKDF2-SHA256 (310 k iterations, 16-byte salt, urlsafe-b64 envelope) for DB users; env-configured users may carry plaintext (`password`) or precomputed hashes. Login → HS256 JWT (issuer `seasid`, 60-min default expiry) embedding subject/username/role/site_keys. `get_current_principal` verifies signature+issuer+expiry and reconstructs a `Principal` from claims. Roles checked per-route via `ensure_role`; site scope via `ensure_site_access`. Dev fallback: 5 well-known accounts + placeholder signing secret, warned once, disable-able via `SEASID_AUTH_REQUIRE_EXPLICIT_USERS=true`.

**Secrets at rest:** a stdlib-only envelope — PBKDF2(master_key, salt, 200 k) → enc/mac subkeys; SHA-256-CTR-like keystream encryption; HMAC-SHA256 (encrypt-then-MAC) over version‖iterations‖salt‖nonce‖ciphertext; constant-time MAC compare; version byte + iteration bounds. Master key from `SEASID_DB_ENCRYPTION_KEY` or auto-created `backend/data/seasid.key` (chmod 600 attempted).

**Key store:** provider rows with rotation (LRU on last_used_at), per-key error count/cooldown, use counters; admin reveal endpoint for plaintext; MCP key resolution cascade (dedicated row → LLM row → env bootstrap).

---

## 3. Findings

### P0 — Critical

**F-B4-01 · SECURITY.md's central claim ("Protected routes use signed bearer tokens") is false for 10 routes** — cross-ref F-B3-01. The doc is the operator's source of truth; as written it overstates the deployed guarantee. Either the routes get auth or the doc must list the exceptions. Included here because a security doc that doesn't match the code is itself a vulnerability (operators make deployment decisions based on it).

### P1 — High

**F-B4-02 · Homegrown cryptographic construction** — `secret_store.py:1-114`.
The envelope is a hand-rolled SHA-256-CTR stream cipher + hand-rolled EtM HMAC. The composition is *actually done mostly right* (independent subkeys via PBKDF2 dklen split, MAC covers version+iterations+salt+nonce+ciphertext, constant-time compare, version byte, iteration bounds) — better than most homegrown attempts — but it violates the primary OWASP rule: don't build crypto compositions yourself when a vetted primitive exists ([OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html), [Percival — Encrypt-then-MAC](https://www.daemonology.net/blog/2009-06-24-encrypt-then-mac.html)). Concrete gaps vs `cryptography`'s Fernet/AES-GCM: no associated-data binding (an envelope can be swapped between provider rows — decrypt succeeds under the same master key), no key-rotation versioning, and every future maintainer must re-verify the construction. AGENTS.md already flags this file as the #1 high-risk artifact. Recommendation: keep the envelope format reader for backward compat, but switch `encrypt()` to AES-GCM (or Fernet) with a new version byte — the migration path is exactly the "keep the format back-compatible" guardrail AGENTS.md demands.

**F-B4-03 · Master key lives beside the ciphertext** — `secret_store.py:139-149` writes `backend/data/seasid.key` into the same `backend/data/` directory as `seasid.db`, and the Docker volume mounts that whole directory (`docker-compose.yml`, verified in C2). The encryption therefore only defends against *DB-file-only* exfiltration — the most common scenario (backups, log bundles, directory tars) includes both files. SECURITY.md says "must be protected and backed up with the database" — accurate but it never states that co-location means the at-rest encryption provides no protection against full-directory compromise. Also `os.chmod(0o600)` is a no-op on Windows (this project's own dev platform). Fix: document the threat model honestly; prefer `SEASID_DB_ENCRYPTION_KEY` from a real secret store in any deployment that matters.

**F-B4-04 · PBKDF2 (200 k iterations) runs on every key access, with no plaintext cache** — `provider_keys.py:114-115` → `pick_provider_key` (every provider API call), `list_provider_keys` (every admin list, decrypts *all* rows just to mask them), `create/update` paths. At ~50-150 ms per derivation, every forecast ingest and every admin page pays it; `list_provider_keys` with 5 keys ≈ 0.5 s of pure KDF. Add a short-TTL (60 s) decrypted-value cache keyed by row `updated_at`, and mask previews from a stored hash/last-4 column instead of decrypting.

**F-B4-05 · JWT claims are never re-validated against the user store** — `auth.py:342-375`. Role/site_keys come solely from the token; disabling a user or demoting an admin leaves their token fully authoritative for up to 60 min (or `SEASID_ACCESS_TOKEN_MINUTES`). There is no revocation list, no token versioning, and no `enabled` check at request time. Standard mitigations: check `user.enabled` (one indexed DB read) inside `get_current_principal`, or keep tokens short and document the window. Also note `authenticate_user` performs **no failed-attempt logging or lockout** (`auth.py:299-321`) — combined with no rate limiting (F-B3-04) brute force is unlogged and unthrottled.

### P2 — Medium

**F-B4-06 · `get_active_users` leaks a DB session per auth check** — `auth.py:231`: `_db.SessionLocal().query(_db.User).all()` without a context manager or close (contrast `user_store.py`, which consistently uses `with db.SessionLocal()`). Called on every login (and any route that hits `configured_users` fallback). Under concurrency this holds pooled connections until GC.

**F-B4-07 · `ensure_site_access` passes unknown sites** — `auth.py:390-391`: `if requested_site not in site_keys(): return`. The fail-open exists so routes can 404 later, but any future caller that forgets the 404 check gets an access check that silently succeeds. Return-value should be explicit, or unknown keys should be denied.

**F-B4-08 · Dev-default secret decision is inverted from fail-safe** — `auth_secret()` returns the *public placeholder* secret whenever explicit users aren't configured, even with auth enabled. The 32-char check at `create_access_token` is bypassed because the placeholder is 48 chars. A production deploy that forgets `SEASID_AUTH_SECRET` boots happily with publicly-known signing keys and `admin/admin-dev`. Fail-fast alternative: refuse to sign tokens when no explicit secret is configured *and* `SEASID_AUTH_REQUIRE_EXPLICIT_USERS` is set; keep the dev fallback only when neither env users nor the strict flag exist *and* the app binds to localhost.

**F-B4-09 · Plaintext `password` comparisons for env-configured users** — `auth.py:294-296` (`hmac.compare_digest(password, str(expected))`). Constant-time, but plaintext credentials in env vars contradict SECURITY.md's own guidance to prefer hashes ("production deployments should use a PBKDF2 hash"). No startup warning when a plaintext password is loaded.

**F-B4-10 · Custom LLM base_url allows `http://` and arbitrary hosts** — `provider_keys.py:369-373`. Admin-configurable; combined with the server-side chat proxy it's an SSRF primitive against the internal network (metadata endpoints, admin panels on localhost). Allow `https://` by default; require an explicit `SEASID_ALLOW_INSECURE_LLM_BASE_URL=true` for http.

**F-B4-11 · `create_provider_key` returns "last row" of a re-listed provider** — `provider_keys.py:203`: `list_provider_keys(provider=...)[-1]` — with two concurrent creates the wrong row can be returned to one caller. Return a properly masked dict for the row you just committed.

### P3 — Low

**F-B4-12 · `mask_value` reveals the last 4 chars of provider keys** — `provider_keys.py:135-140`; acceptable and standard, but worth documenting that last-4 of e.g. Stormglass keys has low entropy value.
**F-B4-13 · `normalize_legacy_provider_rows` decrypts every row twice** — `provider_keys.py:414-420`; rare maintenance path, fine.
**F-B4-14 · No startup check that `SEASID_AUTH_SECRET` ≠ placeholder when `REQUIRE_EXPLICIT_USERS` is set** — the strict flag disables default *users* but not the default *secret*; an operator can satisfy one and not the other.
**F-B4-15 · Token has no `aud` claim** — `auth.py:330-338`; issuer checked, audience not. Single-audience app; note for future multi-service splits.

---

## 4. Web research (what current best practice says)

1. **Crypto storage** — prefer AEAD (AES-GCM) or a vetted library construction (Fernet); homegrown EtM is only acceptable when independently reviewed; bind AAD; never co-locate keys with ciphertext without an explicit threat model. Sources: [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) · [Percival, Encrypt-then-MAC](https://www.daemonology.net/blog/2009-06-24-encrypt-then-mac.html) · [pythonsheets — Python crypto recommendations](https://www.pythonsheets.com/notes/security/python-crypto.html) · [cryptography.io](https://cryptography.io/en/3.4/hazmat/primitives/symmetric-encryption.html).
2. **Stateless JWT trade-offs** — claim-only authorization means revocation latency = token TTL; standard mitigations are short TTLs, `enabled` re-checks, or denylist versioning. Sources: [FastAPI security docs](https://fastapi.tiangolo.com) · [Auth0 JWT best practices](https://auth0.com).
3. **Password storage** — PBKDF2-HMAC-SHA256 ≥ 600 k iterations per current OWASP guidance (SeaSID uses 310 k — reasonable but below the 2023+ recommendation; argon2id/bcrypt preferred when available). Iteration counts should be re-checked at each major release.
4. **Secrets management** — env vars are acceptable for bootstrapping; file-based keys must be explicitly documented as same-directory-trust; KMS/secret managers for anything internet-facing.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Vetted AEAD primitive | Hand-rolled SHA256-CTR+HMAC | Major (P1) |
| Key/ciphertext separation or documented trust boundary | Same directory, undocumented | Major (P1) |
| Auth on every protected route (matches SECURITY.md) | 10 routes open (F-B3-01) | **Major** (P0) |
| Runtime user-state re-check / revocation | Token-claims only | Missing (P1) |
| Login throttling + lockout + failure logging | None | Missing (P1) |
| KDF cost amortization | Full PBKDF2 per access, no cache | Partial (P1) |
| Fail-safe secret configuration | Dev secret served by default | Partial (P2) |
| SSRF-safe configurable endpoints | http:// + arbitrary host allowed | Partial (P2) |
| Constant-time comparisons, versioned envelope, iteration bounds | ✅ Implemented | Met |
| Masked key previews, no-store on reveal, rotation metadata | ✅ Implemented | Met |

## 6. Recommendations (prioritized)

1. **P0 — Make code match SECURITY.md:** close the 10 unauthenticated routes (B3 rec #1) or amend the doc with an explicit "known gaps" section *today*; until then the doc is misleading.
2. **P1 — Re-check `enabled` + role from the user store in `get_current_principal`** (single indexed query; makes disable/demote effective within one request and enables future revocation).
3. **P1 — Add a 60 s TTL cache for decrypted provider values** (invalidated by row `updated_at`); store `last4` at create/update so admin lists stop decrypting.
4. **P1 — Migration path off homegrown crypto:** envelope version 2 = AES-GCM via `cryptography` (or Fernet), reader stays version-1-compatible, background re-encrypt on next admin save.
5. **P1 — Login hardening:** rate limit (SlowAPI), log failed attempts with IP, temporary lockout after N failures per username+IP.
6. **P2 — Fail-fast secret policy:** if `SEASID_AUTH_REQUIRE_EXPLICIT_USERS=true` and no explicit `SEASID_AUTH_SECRET`, refuse to boot; warn when env users carry plaintext passwords.
7. **P2 — Document the key-file threat model in SECURITY.md** (co-location ⇒ encryption defends DB-only exfiltration; chmod moot on Windows); prefer env/KMS key in docker-compose deployments.
8. **P2 — Restrict LLM base_url to https:// unless explicitly overridden.**
9. **P3 — `aud` claim; fix `get_active_users` session leak; make `ensure_site_access` deny unknown sites.**

---

### What this area does well (worth keeping)

- The hand-rolled envelope, judged as a *construction*, is unusually careful: independent subkeys, EtM ordering, constant-time MAC, version byte, iteration sanity bounds — the problem is that it exists at all, not how it's built.
- Key rotation with LRU + cooldown + error attribution (`key_id` propagated to MCP errors) is a genuinely production-grade design.
- Dev-default credentials are loud (unique passwords per role, one-time warning, explicit kill switch) — a good middle ground for an academic project.
- PBKDF2 password hashing with per-hash salt and version-tagged scheme string leaves room for algorithm upgrades.
- SECURITY.md's leak-response runbook (rotate upstream first, disable row, replace, audit) is exactly right.
