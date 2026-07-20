"""Secret-at-rest encryption for SeaSID.

A small Fernet-style envelope using only the Python standard library so we
don''t pull in the ``cryptography`` package. Construction:

    salt            = 16 random bytes
    derived_key     = PBKDF2-HMAC-SHA256(master_key, salt, 200_000, 64)
    enc_key         = derived_key[:32]
    mac_key         = derived_key[32:]
    nonce           = 16 random bytes
    ciphertext      = plaintext XOR SHA256(nonce || counter_be_4)^n
    tag             = HMAC-SHA256(mac_key, version || salt || nonce || ciphertext)
    envelope_bytes  = b"\x01" + iter_to_4_bytes + salt + nonce + ciphertext + tag

The envelope is then base64-url encoded. Decryption verifies the MAC under a
constant-time compare, refuses any version mismatch, and uses PBKDF2 with the
declared iteration count.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path




ENVELOPE_VERSION = 1
PBKDF2_ITERATIONS = 200_000
SALT_BYTES = 16
NONCE_BYTES = 16
MAC_BYTES = 32


def _derive(master_key: bytes, salt: bytes, iterations: int) -> tuple[bytes, bytes]:
    if len(master_key) < 16:
        raise ValueError("master_key must be at least 16 bytes")
    derived = hashlib.pbkdf2_hmac("sha256", master_key, salt, iterations, dklen=64)
    return derived[:32], derived[32:]


def _keystream(enc_key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hashlib.sha256(enc_key + nonce + counter.to_bytes(4, "big")).digest())
        counter += 1
    return bytes(out[:length])


def encrypt(plaintext: str | bytes, master_key: str | bytes) -> str:
    if isinstance(master_key, str):
        master_key = master_key.encode("utf-8")
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    if not master_key:
        raise ValueError("master_key must not be empty")
    salt = secrets.token_bytes(SALT_BYTES)
    nonce = secrets.token_bytes(NONCE_BYTES)
    enc_key, mac_key = _derive(master_key, salt, PBKDF2_ITERATIONS)
    keystream = _keystream(enc_key, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, keystream))
    tag = hmac.new(
        mac_key,
        bytes([ENVELOPE_VERSION])
        + PBKDF2_ITERATIONS.to_bytes(4, "big")
        + salt
        + nonce
        + ciphertext,
        hashlib.sha256,
    ).digest()[:MAC_BYTES]
    envelope = (
        bytes([ENVELOPE_VERSION])
        + PBKDF2_ITERATIONS.to_bytes(4, "big")
        + salt
        + nonce
        + ciphertext
        + tag
    )
    return base64.urlsafe_b64encode(envelope).rstrip(b"=").decode("ascii")


def decrypt(envelope: str, master_key: str | bytes) -> bytes:
    if isinstance(master_key, str):
        master_key = master_key.encode("utf-8")
    if not master_key:
        raise ValueError("master_key must not be empty")
    padding = b"=" * (-len(envelope) % 4)
    raw = base64.urlsafe_b64decode(envelope.encode("ascii") + padding)
    if len(raw) < 1 + 4 + SALT_BYTES + NONCE_BYTES + MAC_BYTES:
        raise ValueError("Envelope is too short to be valid")
    version = raw[0]
    if version != ENVELOPE_VERSION:
        raise ValueError(f"Unsupported envelope version: {version}")
    iterations = int.from_bytes(raw[1:5], "big")
    if iterations < 10_000 or iterations > 5_000_000:
        raise ValueError("PBKDF2 iteration count out of range")
    salt = raw[5:5 + SALT_BYTES]
    nonce = raw[5 + SALT_BYTES:5 + SALT_BYTES + NONCE_BYTES]
    mac = raw[-MAC_BYTES:]
    ciphertext = raw[5 + SALT_BYTES + NONCE_BYTES:-MAC_BYTES]
    enc_key, mac_key = _derive(master_key, salt, iterations)
    expected_tag = hmac.new(
        mac_key,
        bytes([version]) + iterations.to_bytes(4, "big") + salt + nonce + ciphertext,
        hashlib.sha256,
    ).digest()[:MAC_BYTES]
    if not hmac.compare_digest(mac, expected_tag):
        raise ValueError("Decryption failed: MAC mismatch")
    return bytes(a ^ b for a, b in zip(ciphertext, _keystream(enc_key, nonce, len(ciphertext))))


def decrypt_str(envelope: str, master_key: str | bytes) -> str:
    return decrypt(envelope, master_key).decode("utf-8")


def _default_key_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "seasid.key"


def load_or_create_master_key(env_var: str = "SEASID_DB_ENCRYPTION_KEY") -> bytes:
    """Return the master encryption key.

    Resolution order:
      1. ``env_var`` -- must be at least 32 chars when present.
      2. ``backend/data/seasid.key`` -- auto-generated on first run.
    """
    explicit = os.getenv(env_var, "").strip()
    if explicit:
        if len(explicit) < 32:
            raise RuntimeError(
                f"{env_var} must be at least 32 characters when set explicitly",
            )
        return explicit.encode("utf-8")
    path = _default_key_path()
    if path.exists():
        return path.read_text(encoding="utf-8").strip().encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(48)
    path.write_text(key, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key.encode("utf-8")
