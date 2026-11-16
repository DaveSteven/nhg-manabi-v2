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


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N,
                        r=_SCRYPT_R, p=_SCRYPT_P, maxmem=_MAXMEM, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
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
