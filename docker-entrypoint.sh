#!/bin/bash
set -e

cd /app/backend

# Audit F-C2-03: fail fast on an insecure production configuration instead
# of booting with publicly-known dev credentials on 0.0.0.0.
auth_enabled="$(echo "${SEASID_AUTH_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')"
if [ "$auth_enabled" != "false" ] && [ "$auth_enabled" != "0" ] && [ "$auth_enabled" != "no" ] && [ "$auth_enabled" != "off" ]; then
    if [ -z "$SEASID_AUTH_SECRET" ] || [ ${#SEASID_AUTH_SECRET} -lt 32 ]; then
        echo "ERROR: SEASID_AUTH_SECRET must be set to at least 32 characters." >&2
        echo "       SeaSID refuses to start with auth enabled and no signing secret" >&2
        echo "       (the dev-default credentials are not safe for any deployment)." >&2
        echo "       Set SEASID_AUTH_SECRET, or SEASID_AUTH_ENABLED=false for local dev only." >&2
        exit 1
    fi
fi

# Initialize database if it doesn't exist.
if [ ! -f "data/seasid.db" ]; then
    echo "Initializing database..."
    python -m scripts.init_db
    if [ "${SEASID_SEED_DEMO:-0}" = "1" ]; then
        # Audit F-C2-06: seeding inserts rule-derived SYNTHETIC training
        # labels — opt-in, because operators must know demo data exists.
        echo "SEASID_SEED_DEMO=1 — seeding SYNTHETIC demo history (rule-derived labels)."
        python -m scripts.seed_history
    else
        echo "Skipping demo seed (set SEASID_SEED_DEMO=1 to seed synthetic history)."
    fi
    echo "Database initialized."
fi

exec "$@"
