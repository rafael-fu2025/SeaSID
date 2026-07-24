"""Generate a PBKDF2 password hash for ``SEASID_AUTH_USERS_JSON``.

Usage:
    python -m scripts.hash_password
"""

from __future__ import annotations

import getpass
import sys

from app.auth import hash_password


def main() -> None:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if not password or password != confirmation:
        print("Passwords do not match or are empty.", file=sys.stderr)
        raise SystemExit(1)
    print(hash_password(password))


if __name__ == "__main__":
    main()
