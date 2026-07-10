#!/bin/bash
set -e

cd /app/backend

# Initialize database if it doesn't exist
if [ ! -f "data/seasid.db" ]; then
    echo "Initializing database..."
    python -m scripts.init_db
    python -m scripts.seed_history
    echo "Database initialized and seeded."
fi

# Execute the main command
cd /app/backend
exec "$@"
