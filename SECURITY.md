# Security

## API keys

SeaSID reads all secrets from environment variables (typically loaded from
`backend/.env` locally). **Never commit `.env`** — the `.gitignore` at the
repo root excludes it, and `.env.example` is the only env file that's
intentionally tracked.

Keys used:

| Variable | Purpose | Where to obtain |
|---|---|---|
| `OPENAI_API_KEY` | LLM agent briefings | <https://platform.openai.com/api-keys> |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint (e.g. MiniMax) | Provider-specific |
| `WORLDTIDES_API_KEY` | Tide heights | <https://www.worldtides.info/> |
| `STORMGLASS_API_KEY` | Marine augmentation | <https://stormglass.io/> |
| `AQICN_API_KEY` | Air-quality data | <https://aqicn.org/data-platform/token/> |
| `SMTP_*`, `ALERT_EMAIL_TO` | Optional email-alert transport | Self-hosted SMTP |

## If a key leaks

1. **Rotate immediately** at the upstream provider's dashboard.
2. Update `backend/.env` with the new value.
3. Restart the API server (`python -m uvicorn app.api.main:app ...`).
4. Consider adding the old value to a denylist in any logging or proxy.

## Reporting a vulnerability

Please open a GitHub Security Advisory on
<https://github.com/rafael-fu2025/SeaSID/security/advisories/new>
rather than filing a public issue.