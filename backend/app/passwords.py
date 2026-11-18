"""Shared scrypt password hashing (ADR-0009 admin, ADR-0011 students).

Stdlib-only scrypt with per-hash random salt. Format:
scrypt$N$r$p$b64(salt)$b64(dk) — parameters are stored in the hash so they
can be raised later without invalidating existing rows.
"""
import base64
import hashlib
import secrets

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 15, 8, 1
_MAXMEM = 128 * 1024 * 1024
V1_PBKDF2_ROUNDS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N,
                        r=_SCRYPT_R, p=_SCRYPT_P, maxmem=_MAXMEM, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(dk)}"


def _verify_v1_pbkdf2(password: str, stored: str) -> bool:
    """JLPT GO 1.0 hash: pbkdf2_sha256$<salt>$<hex>, 120000 rounds, the salt
    string is used as UTF-8 bytes (ADR-0029). Verify-only: never produced."""
    try:
        _, salt, digest = stored.split("$", 2)
        got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                  salt.encode("utf-8"), V1_PBKDF2_ROUNDS).hex()
        return hmac_compare(got.encode("ascii"), digest.encode("ascii"))
    except Exception:
        return False


def is_v1_hash(stored: str | None) -> bool:
    return bool(stored) and stored.startswith("pbkdf2_sha256$") \
        and stored.count("$") == 2


def needs_rehash(stored: str | None) -> bool:
    """True for imported V1 hashes; they are upgraded on the next login."""
    return is_v1_hash(stored)


def verify_password(password: str, stored: str) -> bool:
    if is_v1_hash(stored):
        return _verify_v1_pbkdf2(password, stored)
    try:
        scheme, n, r, p, salt, dk = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(dk)
        got = hashlib.scrypt(password.encode("utf-8"),
                             salt=base64.b64decode(salt), n=int(n), r=int(r),
                             p=int(p), maxmem=_MAXMEM, dklen=len(expected))
        return hmac_compare(got, expected)
    except Exception:
        return False


def hmac_compare(a: bytes, b: bytes) -> bool:
    import hmac
    return hmac.compare_digest(a, b)
