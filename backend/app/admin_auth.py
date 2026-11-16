"""Administrator identity (ADR-0009, roles simplified by ADR-0010).

Separate from student identity (app/auth.py). There is deliberately NO
dev/test bypass here: an administrator must exist in admin_users and hold
a live admin_sessions row. Passwords: stdlib scrypt with per-hash salt.
Session tokens: 256-bit random, only SHA-256 stored.
"""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.passwords import hash_password, verify_password

ROLES = ("super_admin",)  # ADR-0010: multi-role hierarchy deferred
SESSION_TTL = timedelta(hours=12)
MAX_FAILURES = 5
LOCK_FOR = timedelta(minutes=15)
MIN_PASSWORD_LEN = 12
_USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,40}$")


class AdminError(ValueError):
    """Invalid admin management input (create/reset/etc.)."""


class AdminAuthError(Exception):
    """Authentication failed; deliberately carries no detail."""


# ------------------------------------------------------------- passwords ----
# scrypt hash/verify live in app/passwords.py (shared with students,
# ADR-0011); the admin policy keeps its stricter 12-char minimum.


def _check_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise AdminError(f"password must be at least {MIN_PASSWORD_LEN} characters")


# --------------------------------------------------------------- accounts ----

def create_admin(engine: Engine, username: str, password: str, role: str,
                 display_name: str | None = None) -> dict:
    if not _USERNAME_RE.match(username or ""):
        raise AdminError("username must be 3-40 chars of a-z 0-9 . _ -")
    if role not in ROLES:
        raise AdminError(f"role must be one of {ROLES}")
    _check_password_strength(password)
    admin_id = uuid.uuid4()
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM admin_users WHERE username = :u"),
                        {"u": username}).first():
            raise AdminError("username already exists")
        conn.execute(text(
            "INSERT INTO admin_users (id, username, display_name,"
            " password_hash, role) VALUES (:id, :u, :d, :h, :r)"),
            {"id": admin_id, "u": username, "d": display_name or username,
             "h": hash_password(password), "r": role})
    return {"id": str(admin_id), "username": username,
            "display_name": display_name or username, "role": role}


def _revoke_all(conn, admin_id, now) -> None:
    conn.execute(text(
        "UPDATE admin_sessions SET revoked_at = :now"
        " WHERE admin_id = :a AND revoked_at IS NULL"),
        {"a": admin_id, "now": now})


def set_active(engine: Engine, username: str, active: bool) -> None:
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        row = conn.execute(text(
            "UPDATE admin_users SET is_active = :a WHERE username = :u"
            " RETURNING id"), {"a": active, "u": username}).first()
        if row is None:
            raise AdminError("no such admin")
        if not active:
            _revoke_all(conn, row.id, now)


def reset_password(engine: Engine, username: str, password: str) -> None:
    _check_password_strength(password)
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        row = conn.execute(text(
            "UPDATE admin_users SET password_hash = :h, failed_login_count = 0,"
            " locked_until = NULL, password_changed_at = :now"
            " WHERE username = :u RETURNING id"),
            {"h": hash_password(password), "u": username, "now": now}).first()
        if row is None:
            raise AdminError("no such admin")
        _revoke_all(conn, row.id, now)


# --------------------------------------------------------------- sessions ----

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# A real hash used to burn equal CPU time when the username does not exist.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def login(engine: Engine, username: str, password: str,
          now: datetime | None = None) -> dict:
    """Authenticate and open a session. Failure bookkeeping (attempt counter,
    lock) is COMMITTED before AdminAuthError is raised: raising inside the
    transaction would roll the counter back and defeat lockout."""
    now = now or datetime.now(timezone.utc)
    result: dict | None = None
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, username, display_name, role, is_active, password_hash,"
            " failed_login_count, locked_until FROM admin_users"
            " WHERE username = :u FOR UPDATE"), {"u": username}).mappings().first()
        if row is None:
            verify_password(password, _DUMMY_HASH)  # equalise timing
        else:
            locked = row["locked_until"] is not None and row["locked_until"] > now
            ok = verify_password(password, row["password_hash"])
            if locked or not row["is_active"]:
                pass  # refuse; do not extend the lock or touch counters
            elif not ok:
                failures = row["failed_login_count"] + 1
                lock = now + LOCK_FOR if failures >= MAX_FAILURES else None
                conn.execute(text(
                    "UPDATE admin_users SET failed_login_count = :f,"
                    " locked_until = :l WHERE id = :id"),
                    {"f": 0 if lock else failures, "l": lock, "id": row["id"]})
            else:
                token = secrets.token_urlsafe(32)
                expires = now + SESSION_TTL
                conn.execute(text(
                    "UPDATE admin_users SET failed_login_count = 0,"
                    " locked_until = NULL, last_login_at = :now WHERE id = :id"),
                    {"now": now, "id": row["id"]})
                conn.execute(text(
                    "INSERT INTO admin_sessions (id, admin_id, token_hash,"
                    " created_at, expires_at) VALUES (:id, :a, :h, :c, :e)"),
                    {"id": uuid.uuid4(), "a": row["id"],
                     "h": _token_hash(token), "c": now, "e": expires})
                result = {"token": token, "expires_at": expires.isoformat(),
                          "admin": {"id": str(row["id"]),
                                    "username": row["username"],
                                    "display_name": row["display_name"],
                                    "role": row["role"]}}
    if result is None:
        raise AdminAuthError()
    return result


def authenticate_token(engine: Engine, token: str,
                       now: datetime | None = None) -> dict | None:
    if not token:
        return None
    now = now or datetime.now(timezone.utc)
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT s.id AS session_id, a.id, a.username, a.display_name, a.role"
            " FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id"
            " WHERE s.token_hash = :h AND s.revoked_at IS NULL"
            " AND s.expires_at > :now AND a.is_active"),
            {"h": _token_hash(token), "now": now}).mappings().first()
        if row is None:
            return None
        conn.execute(text("UPDATE admin_sessions SET last_used_at = :now"
                          " WHERE id = :id"), {"now": now, "id": row["session_id"]})
    return dict(row)


def logout(engine: Engine, token: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE admin_sessions SET revoked_at = now()"
            " WHERE token_hash = :h AND revoked_at IS NULL"),
            {"h": _token_hash(token)})


# ----------------------------------------------------------- FastAPI deps ----

def _bearer(authorization: str | None) -> str | None:
    scheme, token = get_authorization_scheme_param(authorization)
    return token if scheme.lower() == "bearer" and token else None


def require_admin():
    """Dependency factory: 401 without a valid admin session. Every admin is
    a super_admin (ADR-0010). No bypass of any kind."""

    def dep(authorization: str | None = Header(default=None)) -> dict:
        from app.db.engine import get_engine
        token = _bearer(authorization)
        admin = authenticate_token(get_engine(), token) if token else None
        if admin is None:
            raise HTTPException(status_code=401, detail="admin authentication required")
        return admin

    return dep


def admin_reviewer_id(admin: dict) -> str:
    """Audit identity for review/publish records: server-derived, never client input."""
    return f"admin:{admin['id']}"
