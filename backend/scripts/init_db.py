"""
scripts/init_db.py — Create all database tables with WAL mode.

Usage:
    python -m scripts.init_db
"""

import sys
from pathlib import Path

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lib.db import init_db


def main():
    print("Initializing SeaSID database...")
    init_db()
    print("Done. All tables created.")


if __name__ == "__main__":
    main()
