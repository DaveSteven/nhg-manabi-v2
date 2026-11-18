"""Import JLPT GO 1.0 students into v2 `users` (ADR-0029).

Reads the V1 database read-only; writes only v2 `users`. Idempotent on
`users.legacy_v1_user_id`. Nothing is silently renamed: every skipped or
degraded row appears in the report. Default is dry-run (the whole import
runs in one transaction that is rolled back); `--apply` commits.

V1 password hashes (`pbkdf2_sha256$salt$hex`) are kept verbatim and upgraded
to scrypt on the user's next successful login. Study records are NOT
imported (V1 question ids do not exist in v2 Canonical).

  python -m app.v1_user_import --v1-url postgresql+psycopg://... [--apply]
"""
import argparse
import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.passwords import is_v1_hash
from app.student_auth import AVATAR_IDS, LEVELS

USERNAME_RE = re.compile(r"^[a-z0-9_]{1,64}$")
V1_SELECT = (
    "SELECT id, username, display_name, password_hash, current_level,"
    " created_at, last_active_at, email, activated_at, disabled_at, avatar"
    " FROM users ORDER BY created_at, id")


def _utc(v):
    if v is None:
        return None
    return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v


def import_users(engine: Engine, rows: list[dict], apply: bool) -> dict:
    report = {"total": len(rows), "imported": 0, "already_imported": 0,
              "skipped": [], "degraded": [], "no_email": 0,
              "no_usable_password": 0, "applied": apply}
    with engine.connect() as conn:
        tx = conn.begin()
        have_legacy = {r[0] for r in conn.execute(text(
            "SELECT legacy_v1_user_id FROM users"
            " WHERE legacy_v1_user_id IS NOT NULL"))}
        emails = {r[0] for r in conn.execute(text(
            "SELECT email FROM users WHERE email IS NOT NULL"))}
        names = {r[0] for r in conn.execute(text(
            "SELECT username FROM users WHERE username IS NOT NULL"))}
        for r in rows:
            v1_id = str(r["id"])
            if v1_id in have_legacy:
                report["already_imported"] += 1
                continue
            raw_name = (r.get("username") or "").strip()
            username = raw_name.lower()
            if not USERNAME_RE.match(username):
                report["degraded"].append(
                    {"v1_id": v1_id, "username": raw_name,
                     "issue": "invalid_username_dropped"})
                username = None
            elif username in names:
                report["degraded"].append(
                    {"v1_id": v1_id, "username": raw_name,
                     "issue": "username_conflict_dropped"})
                username = None
            email = (r.get("email") or "").strip().lower() or None
            if email and ("@" not in email or len(email) > 255):
                report["degraded"].append(
                    {"v1_id": v1_id, "username": raw_name,
                     "issue": "invalid_email_dropped"})
                email = None
            elif email and email in emails:
                report["degraded"].append(
                    {"v1_id": v1_id, "username": raw_name,
                     "issue": "email_conflict_dropped"})
                email = None
            if username is None and email is None:
                report["skipped"].append(
                    {"v1_id": v1_id, "username": raw_name,
                     "reason": "no_usable_identity"})
                continue
            stored = r.get("password_hash") or ""
            if not is_v1_hash(stored):
                stored = ""
                report["no_usable_password"] += 1
            level = r.get("current_level")
            avatar = r.get("avatar")
            display = ((r.get("display_name") or "").strip()
                       or username or (email or "").split("@")[0])[:128]
            conn.execute(text(
                "INSERT INTO users (id, email, username, display_name,"
                " password_hash, current_level, avatar, activated_at,"
                " disabled_at, created_at, last_login_at, legacy_v1_user_id)"
                " VALUES (:id, :e, :un, :dn, :h, :lv, :av, :act, :dis, :c,"
                " :last, :v1)"),
                {"id": uuid.uuid4(), "e": email, "un": username, "dn": display,
                 "h": stored, "lv": level if level in LEVELS else "N5",
                 "av": avatar if avatar in AVATAR_IDS else None,
                 "act": _utc(r.get("activated_at")),
                 "dis": _utc(r.get("disabled_at")),
                 "c": _utc(r.get("created_at")) or datetime.now(timezone.utc),
                 "last": _utc(r.get("last_active_at")), "v1": v1_id})
            if username:
                names.add(username)
            if email:
                emails.add(email)
            else:
                report["no_email"] += 1
            report["imported"] += 1
        if apply:
            tx.commit()
        else:
            tx.rollback()
    return report


def read_v1_users(v1_url: str) -> list[dict]:
    engine = create_engine(v1_url)
    try:
        with engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            return [dict(r) for r in conn.execute(text(V1_SELECT)).mappings()]
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--v1-url", required=True, help="V1 database URL (read-only)")
    ap.add_argument("--apply", action="store_true",
                    help="commit; default is a dry-run that rolls back")
    args = ap.parse_args(argv)
    from app.db.engine import get_engine
    report = import_users(get_engine(), read_v1_users(args.v1_url), args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
