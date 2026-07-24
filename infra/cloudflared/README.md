# Cloudflare Tunnel setup for SeaSID

Expose your local dev environment to any device on the internet via
Cloudflare's quick tunnels — no Cloudflare account required, no DNS
records, no credentials file.

## What this gives you

- A public `https://<random>.trycloudflare.com` URL for the **frontend**
  (Vite on `:5173`)
- A public `https://<random>.trycloudflare.com` URL for the **backend**
  (FastAPI on `:8000`)
- CORS auto-allowlist: the backend accepts any `*.trycloudflare.com`
  origin out of the box (regex match in `app/api/main.py`)
- `VITE_API_URL` is auto-written to `frontend/.env.local` so Vite's
  client-side requests hit the backend's tunnel URL

## Usage

```powershell
powershell -ExecutionPolicy Bypass -File infra\cloudflared\tunnel.ps1
```

Then open the printed frontend URL on your phone, another machine, or
share it with a teammate. The launcher:

1. Starts `python -m scripts.run_api` on `:8000`
2. Starts `npm run dev` on `:5173`
3. Spawns a cloudflared quick tunnel for the backend and waits for
   the printed `https://*.trycloudflare.com` URL
4. Spawns a cloudflared quick tunnel for the frontend
5. Writes `VITE_API_URL=<backend-tunnel>` to `frontend/.env.local`
6. Bounces Vite so it picks up the new env var
7. Prints both URLs in a copy-pasteable block

Ctrl-C tears everything down.

## How it works

- Two `cloudflared tunnel --url <local-port> --no-autoupdate` processes,
  one per service. Each gives you a `*.trycloudflare.com` URL with
  zero setup — Cloudflare assigns the random subdomain when the
  process starts.
- The backend's `CORSMiddleware` is configured with `allow_origin_regex`
  set to `^https://[a-z0-9-]+\.trycloudflare\.com$`, so any cloudflared
  origin works without editing the allow-list. Setting
  `SEASID_ALLOWED_ORIGINS` in `.env` disables the regex (you'd do this
  in production with stable hostnames).
- The script writes `VITE_API_URL` to `frontend/.env.local` (gitignored)
  and bounces Vite so the new value is picked up at startup. Vite
  doesn't hot-reload env changes.
- SSE streams (agent chat, experiment run progress) and WebSocket
  upgrades (Vite HMR) work natively — each tunnel has a dedicated
  edge connection that's sticky for the duration of a stream.

## Logs

Each process logs to `infra/cloudflared/logs/<label>.{out,err}.log`:

| File | Source |
|---|---|
| `backend.out.log` | FastAPI stdout |
| `backend.err.log` | FastAPI stderr |
| `frontend.out.log` | Vite stdout |
| `tunnel-backend.out.log` | Backend cloudflared (look here for the printed `*.trycloudflare.com` URL) |
| `tunnel-frontend.out.log` | Frontend cloudflared |

## For production

Quick tunnels give you random, ephemeral hostnames that change every
restart. To get stable URLs:

1. `cloudflared tunnel login` — register this machine with a
   Cloudflare account
2. `cloudflared tunnel create seasid` — creates a stable tunnel UUID
3. Add a `config.yml` with `tunnel:` + `credentials-file:` + `ingress:`
   rules (see `cloudflared tunnel --help`)
4. `cloudflared tunnel route dns seasid api.seasid.app` and
   `cloudflared tunnel route dns seasid fe.seasid.app`

A single cloudflared process with ingress rules replaces the two
quick tunnels used here. The launcher script would drop to a single
`cloudflared tunnel --config infra/cloudflared/config.yml run`
invocation.

## Troubleshooting

- **`Failed to detect backend tunnel URL`** — open
  `infra/cloudflared/logs/tunnel-backend.out.log` and check that
  cloudflared connected. Common causes: antivirus blocking the
  outbound connection, or `cloudflared` not being signed in.
- **Frontend shows `Network Error` on every API call** — Vite hasn't
  picked up the new `VITE_API_URL`. The launcher bounces Vite
  automatically; if you started it manually, restart it.
- **CORS error in browser console** — set
  `SEASID_ALLOWED_ORIGINS=https://<fe-tunnel>.trycloudflare.com` and
  restart the backend. The regex fallback should already cover this
  case, but a manual override is the safety belt.
- **`cloudflared` keeps prompting to update** — the launcher uses
  `--no-autoupdate`. If you run cloudflared by hand, pass the same
  flag.