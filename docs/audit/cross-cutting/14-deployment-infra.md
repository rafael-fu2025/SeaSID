# C2 — Deployment & Infrastructure Audit: Dockerfile, docker-compose, entrypoint, dev.py, cloudflared, env handling

> Audited 2026-09-19 · Lens: image hygiene, secrets-in-layers, deployment honesty

---

## 1. Scope

| File | Role |
|---|---|
| `Dockerfile` (root) | 3-stage build: backend → frontend-build → production |
| `docker-compose.yml` | Single `backend` service, named volume, env passthrough |
| `docker-entrypoint.sh` | First-run DB init + seed, then exec CMD |
| `backend/requirements.txt` | Fully pinned runtime + dev deps |
| `dev.py` (346 lines) | `setup` / `doctor` / run orchestration |
| `infra/cloudflared/README.md` + `tunnel.ps1` | Quick-tunnel exposure for demos |
| `backend/.env.example` | Runtime non-secret template |

---

## 2. How it works

The Dockerfile builds a Python backend stage (init DB + seed at *build* time), compiles the frontend in a Node stage, and assembles a production image (backend code + `frontend/dist` + entrypoint) that runs `uvicorn app.api.main:app` on `:8000`. Compose mounts `seasid-data` at `/app/backend/data`, passes auth/model env through, and restarts unless stopped. The entrypoint initializes and seeds the DB only when absent. `dev.py` automates venv setup, dependency installs, `.env` copying, and DB bootstrap with a `doctor` diagnostic. The cloudflared launcher exposes dev frontend/backend via quick tunnels and auto-writes `VITE_API_URL`.

---

## 3. Findings

### P0 — Critical

**F-C2-01 · The Docker image ships the production database *and its master decryption key*** — no `.dockerignore` exists (verified) and the Dockerfile does `COPY backend/ .` (backend stage) and `COPY backend/ ./backend/` (production stage). The build context includes `backend/data/` containing the live `seasid.db` (+ WAL/SHM) — with user password hashes, **Fernet-encrypted provider API keys**, agent conversations — *and* `seasid.key`, the master key that decrypts them (F-B4-03's co-location problem, realized at build time). Per Docker-layer semantics, copied files persist in image layers forever and flow into every push, registry cache, and `docker save` ([Truffle Security — how secrets leak out of images](https://trufflesecurity.com), [Xygeni — layer persistence](https://xygeni.io/blog/dockerfile-secrets-why-layers-keep-your-sensitive-data-forever), [Octopus — .dockerignore](https://octopus.com/blog/not-ignore-dockerignore-2)). Anyone who can pull the image owns every provider credential. SECURITY.md forbids committing these files — the build ships them anyway. Fix: add `.dockerignore` (at minimum `backend/data/`, `.env*`, `.venv`, `node_modules`, `.git`); for any already-published image, treat those keys as compromised (rotate per SECURITY.md's runbook).

### P1 — High

**F-C2-02 · The production image never serves the frontend it builds** — the Dockerfile builds `frontend/dist` and copies it into the production stage, and README states "the production image bundles the Vite-built frontend in a single Python image served on :8000" — but **no `StaticFiles` mount exists anywhere in the backend** (verified: grep for `StaticFiles|frontend/dist|FileResponse` across `app/api` is empty). Opening `:8000` in a browser 404s; the image serves only `/api/v1/*`. The Docker deployment story is broken as documented: either mount `app.mount("/", StaticFiles(directory="../frontend/dist", html=True))` with an API fallback, or drop the frontend from the image and document the two-process topology the cloudflared launcher actually uses.

**F-C2-03 · `docker compose up` with no env ships dev credentials on a public interface** — `SEASID_AUTH_SECRET` passes through unset; `SEASID_ADMIN_PASSWORD` defaults empty; `auth.py` then serves `admin/admin-dev` with the placeholder JWT secret, binding `0.0.0.0:8000` — the exact configuration SECURITY.md calls unacceptable for internet-facing deploys, made one command away. Fix: entrypoint/healthcheck refuses to start when `SEASID_AUTH_ENABLED=true` and `SEASID_AUTH_SECRET` is missing (fail-fast, per F-B4-08), with a clear error message.

### P2 — Medium

**F-C2-04 · Runs as root; no HEALTHCHECK; no resource limits** — the production stage has no `USER`; compose defines no `healthcheck` (the `/api/v1/health` endpoint exists and is ideal — though note F-B3-07: it 500s when the model artifact is missing, which would crash-loop the container on a broken deploy) and no memory caps despite PyTorch in the image ([Sysdig — Dockerfile security](https://www.sysdig.com/learn-cloud-native/dockerfile-best-practices), [TestDriven — Python Docker practices](https://testdriven.io/blog/docker-best-practices)).
**F-C2-05 · Dev tooling ships in the production image** — `pytest`, `ruff`, `matplotlib`, `seaborn` are pinned in the single `requirements.txt`; PyTorch alone makes the image multi-GB. Split `requirements-dev.txt`, consider CPU-only torch wheels, and drop the useless build-stage `RUN python -m scripts.init_db && … seed_history` (its DB is discarded — the production stage re-copies `backend/` without `data/`).
**F-C2-06 · `docker-entrypoint.sh` seeds synthetic history on first run** — `seed_history` inserts rule-derived demo labels; a production deploy silently starts with a model trained (later) on synthetic data unless operators know to clean it. Print a loud warning or gate seeding behind `SEASID_SEED_DEMO=1`.
**F-C2-07 · No image pinning by digest and no vulnerability scanning** — base images float (`python:3.12-slim`, `node:20-slim`); requirements are pinned (excellent) but the bases aren't; no trivy/grype step anywhere.
**F-C2-08 · The cloudflared demo path conflicts with the auth posture** — exposing the backend publicly via quick tunnel, with the wildcard CORS origin (F-B3-08) and unauthenticated write routes (F-B3-01), turns a demo into a public instance of those gaps. The launcher should print "demo mode: known gaps apply" at minimum.

### P3 — Low

**F-C2-09 · compose sets `OPENAI_MODEL` default `gpt-4o-mini` while `.env.example` documents `MiniMax-M3`** and the code default is `MiniMax-M1` — three defaults for one variable.
**F-C2-10 · `docker-entrypoint.sh` has a redundant second `cd /app/backend`** and no `exec`-form trap for SIGTERM propagation beyond `exec "$@"` (which is correct) — the init branch is fine.
**F-C2-11 · `dev.py` duplicates dev.py/README/AGENTS setup instructions** — three places to drift; doctor output mitigates.

---

## 4. Web research (what current best practice says)

1. **Secrets in build context** — files present in the context and COPYed persist in layers; use `.dockerignore` for data/keys and BuildKit `--mount=type=secret` for build-time needs; rotate anything already shipped. Sources: [Docker build best practices](https://docs.docker.com/build/building/best-practices) · [Truffle Security](https://trufflesecurity.com/blog/how-secrets-leak-out-of-docker-images) · [Xygeni](https://xygeni.io/blog/dockerfile-secrets-why-layers-keep-your-sensitive-data-forever) · [Octopus](https://octopus.com/blog/not-ignore-dockerignore-2).
2. **Production containers** — non-root `USER`, `HEALTHCHECK` wired to a real endpoint, pinned base images, minimal runtime deps, read-only rootfs where feasible, uvicorn behind worker management. Sources: [Sysdig top-21](https://www.sysdig.com/learn-cloud-native/dockerfile-best-practices) · [TestDriven Python practices](https://testdriven.io/blog/docker-best-practices).
3. **Fail-fast configuration** — containers that boot with known-insecure defaults on public interfaces are a recurring incident pattern; the entrypoint is the right place to refuse insecure startup.

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| `.dockerignore` excluding data/secrets | Absent; DB + master key in layers | **Major** (P0) |
| Image serves what the docs claim | Frontend built but unservable | Major (P1) |
| Refuse insecure boot in prod | Dev creds on 0.0.0.0 one command away | Major (P1) |
| Non-root USER + HEALTHCHECK + limits | None | Missing (P2) |
| Dev deps out of runtime image | pytest/ruff/matplotlib included | Partial (P2) |
| Pinned runtime dependencies | ✅ Every Python dep pinned with rationale | Met |
| First-run bootstrap | ✅ Entrypoint init/seed (with P2 caveat) | Met |
| Multi-stage build | ✅ Correct 3-stage structure | Met |
| Named volume for state | ✅ `seasid-data` mounted correctly | Met |

## 6. Recommendations (prioritized)

1. **P0 — Add `.dockerignore`** (`backend/data/`, `backend/.env*`, `.venv`, `frontend/node_modules`, `.git`, `**/__pycache__`); rebuild; rotate any keys already baked into pushed images.
2. **P1 — Serve the frontend** (`StaticFiles(html=True)` mount after the API routes with a `/api` prefix guard) or remove it from the image and fix README; add a compose `healthcheck` against `/api/v1/health` once F-B3-07 is fixed.
3. **P1 — Fail-fast entrypoint:** refuse to start with auth enabled and no explicit secret; warn loudly when seeding synthetic demo labels.
4. **P2 — Add non-root user, CPU-only torch wheels, split dev requirements, pin base images by digest, add a trivy scan step.**
5. **P3 — Unify the OPENAI_MODEL default; deduplicate setup docs.**

---

### What this area does well (worth keeping)

- The 3-stage Dockerfile structure (build frontend → assemble runtime) is the right skeleton; only the serving wiring and hygiene are missing.
- `requirements.txt` is fully pinned with a stated policy ("bump deliberately and re-run tests") — reproducibility most projects this size never achieve.
- `dev.py` with `setup`/`doctor` is a genuinely thoughtful onboarding path that reports the *specific* missing prerequisite.
- The cloudflared launcher automates the whole demo topology (tunnel URL → `VITE_API_URL` → CORS) — brittle manual steps reduced to one script.
- `.env.example` documents *behavior* (key resolution order, MCP opt-outs), not just variable names.
