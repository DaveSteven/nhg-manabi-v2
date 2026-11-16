"""Student accounts and sessions (ADR-0011).

Email is the login identity (lowercased, unique). Accounts start
unverified; email verification (24h token) activates them. Password
reset uses 1h one-time tokens and revokes all sessions. Sessions are
opaque 30-day bearer tokens — only SHA-256 stored. Failures are
uniform: wrong password / unknown email / unverified / disabled account
all produce the same authentication error, with scrypt timing equalised
for unknown accounts. Lockout columns mirror the admin implementation
(ADR-0009).
"""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.passwords import hash_password, verify_password

SESSION_TTL = timedelta(days=30)
VERIFY_TOKEN_TTL = timedelta(hours=24)
RESET_TOKEN_TTL = timedelta(hours=1)
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_FAILURES = 5
LOCK_FOR = timedelta(minutes=15)
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128
LEVELS = ("N5", "N4", "N3", "N2", "N1")
# Simple shape check; deliverability is verified by the email flow itself.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class StudentAuthError(Exception):
    """Authentication failed; deliberately carries no detail."""


class StudentInputError(ValueError):
    """Invalid registration/profile input (field-level, safe to show)."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


def _check_password(password: str) -> None:
    if not (MIN_PASSWORD_LEN <= len(password or "") <= MAX_PASSWORD_LEN):
        raise StudentInputError(
            "password",
            f"password must be {MIN_PASSWORD_LEN}-{MAX_PASSWORD_LEN} characters")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_email_token(engine: Engine, conn, user_id, purpose: str,
                     ttl: timedelta, now: datetime) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(text(
        "INSERT INTO auth_email_tokens (id, user_id, token_hash, purpose,"
        " expires_at) VALUES (:id, :u, :h, :p, :e)"),
        {"id": uuid.uuid4(), "u": user_id, "h": _token_hash(token),
         "p": purpose, "e": now + ttl})
    return token


# -------------------------------------------------------------- register ----

def register(engine: Engine, email: str, password: str,
             display_name: str | None = None) -> str:
    """Create an unverified account. Returns the raw verification token.

    Raises StudentInputError (field 'email'/'password') on bad input or a
    duplicate email. Email sending is the caller's concern and must not
    roll registration back.
    """
    email_norm = (email or "").strip().lower()
    if len(email_norm) > 255 or not _EMAIL_RE.match(email_norm):
        raise StudentInputError("email", "邮箱格式不正确")
    _check_password(password)
    name = (display_name or "").strip() or email_norm.split("@", 1)[0]
    if len(name) > 128:
        raise StudentInputError("display_name", "昵称过长")
    now = _now()
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM users WHERE email = :e"),
                        {"e": email_norm}).first():
            raise StudentInputError("email", "该邮箱已注册")
        user_id = uuid.uuid4()
        conn.execute(text(
            "INSERT INTO users (id, email, display_name, password_hash,"
            " created_at) VALUES (:id, :e, :d, :h, :c)"),
            {"id": user_id, "e": email_norm, "d": name,
             "h": hash_password(password), "c": now})
        return _new_email_token(engine, conn, user_id, "verify",
                                VERIFY_TOKEN_TTL, now)


# ------------------------------------------------------- email tokens ----

def verify_email(engine: Engine, token: str) -> dict:
    """Burn a verify token and activate the account.

    Replaying an already-used token for an already-activated account is
    idempotent ("already"); unknown/expired tokens are invalid.
    """
    now = _now()
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT t.id, t.user_id, t.used_at, t.expires_at, u.activated_at"
            " FROM auth_email_tokens t JOIN users u ON u.id = t.user_id"
            " WHERE t.token_hash = :h AND t.purpose = 'verify' FOR UPDATE"),
            {"h": _token_hash(token or "")}).mappings().first()
        if row is None:
            raise StudentAuthError()
        if row["used_at"] is not None:
            if row["activated_at"] is not None:
                return {"status": "already"}
            raise StudentAuthError()
        if row["expires_at"] <= now:
            raise StudentAuthError()
        conn.execute(text(
            "UPDATE auth_email_tokens SET used_at = :now WHERE id = :id"),
            {"now": now, "id": row["id"]})
        if row["activated_at"] is None:
            conn.execute(text(
                "UPDATE users SET activated_at = :now WHERE id = :u"),
                {"now": now, "u": row["user_id"]})
        return {"status": "ok"}


def resend_verification(engine: Engine, email: str) -> str | None:
    """Re-issue a verification token for an unverified account.

    Always-safe semantics: unknown / already-activated accounts return
    None (caller responds identically). A 60s per-account cooldown
    suppresses mail spam without revealing state.
    """
    email_norm = (email or "").strip().lower()
    now = _now()
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, activated_at FROM users WHERE email = :e"),
            {"e": email_norm}).mappings().first()
        if row is None or row["activated_at"] is not None:
            return None
        recent = conn.execute(text(
            "SELECT 1 FROM auth_email_tokens WHERE user_id = :u"
            " AND purpose = 'verify' AND used_at IS NULL"
            " AND created_at > :c LIMIT 1"),
            {"u": row["id"], "c": now - RESEND_COOLDOWN}).first()
        if recent:
            return None
        return _new_email_token(engine, conn, row["id"], "verify",
                                VERIFY_TOKEN_TTL, now)


def forgot_password(engine: Engine, email: str) -> str | None:
    """Issue a reset token for an activated account; None otherwise.

    Unknown / unverified / disabled accounts all return None — the
    endpoint must respond identically so account existence does not leak.
    """
    email_norm = (email or "").strip().lower()
    now = _now()
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, activated_at, disabled_at FROM users"
            " WHERE email = :e"), {"e": email_norm}).mappings().first()
        if row is None or row["activated_at"] is None \
                or row["disabled_at"] is not None:
            return None
        return _new_email_token(engine, conn, row["id"], "reset",
                                RESET_TOKEN_TTL, now)


def reset_password(engine: Engine, token: str, password: str) -> None:
    """Burn a reset token, set the new password, revoke every session."""
    _check_password(password)
    now = _now()
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT t.id, t.user_id FROM auth_email_tokens t"
            " JOIN users u ON u.id = t.user_id"
            " WHERE t.token_hash = :h AND t.purpose = 'reset'"
            " AND t.used_at IS NULL AND t.expires_at > :now"
            " AND u.activated_at IS NOT NULL AND u.disabled_at IS NULL"
            " FOR UPDATE OF t"), {"h": _token_hash(token or ""),
                                  "now": now}).mappings().first()
        if row is None:
            raise StudentAuthError()
        conn.execute(text(
            "UPDATE auth_email_tokens SET used_at = :now WHERE id = :id"),
            {"now": now, "id": row["id"]})
        conn.execute(text(
            "UPDATE users SET password_hash = :h, failed_login_count = 0,"
            " locked_until = NULL WHERE id = :u"),
            {"h": hash_password(password), "u": row["user_id"]})
        conn.execute(text(
            "UPDATE user_sessions SET revoked_at = :now"
            " WHERE user_id = :u AND revoked_at IS NULL"),
            {"now": now, "u": row["user_id"]})


# ----------------------------------------------------------------- login ----

# A real hash used to burn equal scrypt time when the email does not exist.
_DUMMY_HASH = hash_password("dummy-password-for-timing-equivalence")


def login(engine: Engine, email: str, password: str) -> dict:
    """Authenticate an activated account and open a 30-day session.

    Failure bookkeeping (attempt counter, lock) commits BEFORE the
    uniform StudentAuthError is raised — raising inside the transaction
    would roll the counter back and defeat lockout.
    """
    email_norm = (email or "").strip().lower()
    now = _now()
    result: dict | None = None
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, email, display_name, current_level, password_hash,"
            " activated_at, disabled_at, failed_login_count, locked_until"
            " FROM users WHERE email = :e FOR UPDATE"),
            {"e": email_norm}).mappings().first()
        if row is None:
            verify_password(password or "", _DUMMY_HASH)  # equalise timing
        else:
            locked = row["locked_until"] is not None and row["locked_until"] > now
            ok = verify_password(password or "", row["password_hash"])
            eligible = (row["activated_at"] is not None
                        and row["disabled_at"] is None)
            if locked or not eligible:
                pass  # refuse; do not extend the lock or touch counters
            elif not ok:
                failures = row["failed_login_count"] + 1
                lock = now + LOCK_FOR if failures >= MAX_FAILURES else None
                conn.execute(text(
                    "UPDATE users SET failed_login_count = :f,"
                    " locked_until = :l WHERE id = :id"),
                    {"f": 0 if lock else failures, "l": lock, "id": row["id"]})
            else:
                token = secrets.token_urlsafe(32)
                expires = now + SESSION_TTL
                conn.execute(text(
                    "UPDATE users SET failed_login_count = 0,"
                    " locked_until = NULL, last_login_at = :now WHERE id = :id"),
                    {"now": now, "id": row["id"]})
                conn.execute(text(
                    "INSERT INTO user_sessions (id, user_id, token_hash,"
                    " created_at, expires_at) VALUES (:id, :u, :h, :c, :e)"),
                    {"id": uuid.uuid4(), "u": row["id"],
                     "h": _token_hash(token), "c": now, "e": expires})
                result = {"token": token, "expires_at": expires.isoformat(),
                          "user": {"id": str(row["id"]),
                                   "email": row["email"],
                                   "display_name": row["display_name"],
                                   "current_level": row["current_level"]}}
    if result is None:
        raise StudentAuthError()
    return result


# -------------------------------------------------------------- sessions ----

def authenticate_token(engine: Engine, token: str) -> dict | None:
    """Resolve a bearer token to an active student, or None."""
    if not token:
        return None
    now = _now()
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT s.id AS session_id, u.id, u.email, u.display_name,"
            " u.current_level"
            " FROM user_sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash = :h AND s.revoked_at IS NULL"
            " AND s.expires_at > :now"
            " AND u.activated_at IS NOT NULL AND u.disabled_at IS NULL"),
            {"h": _token_hash(token), "now": now}).mappings().first()
        if row is None:
            return None
        conn.execute(text(
            "UPDATE user_sessions SET last_used_at = :now WHERE id = :id"),
            {"now": now, "id": row["session_id"]})
    return dict(row)


def logout(engine: Engine, token: str) -> None:
    if not token:
        return
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE user_sessions SET revoked_at = now()"
            " WHERE token_hash = :h AND revoked_at IS NULL"),
            {"h": _token_hash(token)})


# ------------------------------------------------------------------ me ----

def get_profile(engine: Engine, user_id) -> dict:
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT id, email, display_name, current_level, created_at,"
            " activated_at FROM users WHERE id = :u AND disabled_at IS NULL"),
            {"u": user_id}).mappings().first()
        if row is None:
            raise StudentAuthError()
    return dict(row)


def update_profile(engine: Engine, user_id, display_name: str | None,
                   current_level: str | None) -> dict:
    if current_level is not None and current_level not in LEVELS:
        raise StudentInputError("current_level", "等级必须是 N5–N1")
    if display_name is not None:
        display_name = display_name.strip()
        if not 1 <= len(display_name) <= 128:
            raise StudentInputError("display_name", "昵称长度需在 1–128 字符")
    with engine.begin() as conn:
        row = conn.execute(text(
            "UPDATE users SET"
            " display_name = COALESCE(:d, display_name),"
            " current_level = COALESCE(:l, current_level)"
            " WHERE id = :u AND disabled_at IS NULL"
            " RETURNING id, email, display_name, current_level"),
            {"d": display_name, "l": current_level, "u": user_id}).mappings().first()
        if row is None:
            raise StudentAuthError()
    return dict(row)
