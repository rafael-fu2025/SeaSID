# Security

## Provider credentials

SeaSID stores provider API keys in the project SQLite database
(`backend/data/seasid.db`) instead of provider-specific environment variables.
Administrators manage them in **Settings → API keys**. Each provider has one
configuration and may have multiple enabled keys, which SeaSID rotates.

Key values are encrypted before they are written to the `provider_api_keys`
table. List responses expose only masked previews. Plaintext is available only
through the admin-only reveal action; reveal responses use `Cache-Control:
no-store`, and the frontend automatically hides revealed values after 30
seconds.

The OpenAI-compatible LLM base URL is non-secret configuration stored in the
`provider_configs` table and edited in the same Settings screen. SeaSID does not
read `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `STORMGLASS_API_KEY`,
`AQICN_API_KEY`, or `WORLDTIDES_API_KEY` at runtime.

## Encryption key

Provider-key encryption uses `SEASID_DB_ENCRYPTION_KEY` when explicitly set.
It must contain at least 32 characters. When unset, SeaSID creates
`backend/data/seasid.key`; this file is gitignored and must be protected and
backed up with the database. Losing it makes existing provider keys
undecryptable.

Never commit `backend/.env`, `backend/data/seasid.key`, database files, access
tokens, password hashes, or provider credentials. The tracked
`backend/.env.example` contains placeholders and non-secret configuration only.

## Authentication and roles

Protected routes use signed bearer tokens. Roles are `viewer`, `operator`,
`data_steward`, and `admin`; only administrators can manage users, provider
keys, or the LLM base URL.

A fresh development checkout has known default accounts documented in the
README Authentication section. These credentials and the fallback signing
secret are public development conveniences and must never be used for an
internet-facing deployment. Set all of the following in production:

- `SEASID_AUTH_SECRET` with a random value of at least 32 characters.
- Explicit users through the admin UI or `SEASID_AUTH_USERS_JSON`.
- `SEASID_AUTH_REQUIRE_EXPLICIT_USERS=true` to disable built-in defaults.

## Other environment secrets

Environment variables remain appropriate for deployment-level secrets that are
not provider credentials, including `SEASID_AUTH_SECRET`, optional initial-user
passwords, `SEASID_DB_ENCRYPTION_KEY`, and SMTP credentials. Keep local values
in the ignored `backend/.env` file or a deployment secret manager.

## If a provider key leaks

1. Revoke or rotate it immediately at the upstream provider.
2. In **Settings → API keys**, disable or delete the compromised record.
3. Add the replacement key through the same UI; do not place it in `.env`.
4. Review access logs and key usage/error metadata for unexpected activity.
5. Remove leaked values from logs, shell history, tickets, and screenshots.

If the database encryption key leaks, rotate all provider credentials, replace
`SEASID_DB_ENCRYPTION_KEY`/`seasid.key`, and re-enter the credentials so they are
encrypted under the new key.

## Reporting a vulnerability

Please open a GitHub Security Advisory on
<https://github.com/rafael-fu2025/SeaSID/security/advisories/new> rather than
filing a public issue.
