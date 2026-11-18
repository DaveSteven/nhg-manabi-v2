"""Admin user management: list / detail / enable-disable (read-mostly).

Shares the Dashboard definitions (app/api/admin_dashboard.py):
- Dates are Asia/Tokyo calendar days; "last N days" includes today.
- Learning = a formally submitted answer carrying an actual choice
  (drafts, skipped answers and page views never count).
- Visit = a row in user_visit_days; the date only. Users without any row show
  no last visit (never substituted by last_login_at).

Activity status (operational, independent of the account's enabled/disabled
state), by Tokyo days since the user's last learning day n:
  not_started  never learned          active    n <= 6 (learned in last 7 days)
  inactive     7 <= n <= 30           dormant   n >= 31
List rows include every account (disabled/unverified too, so they can be
managed); the three summary figures use the Dashboard's "valid user" rule
(activated, enabled, not in DASHBOARD_EXCLUDE_EMAILS).
Admin identity for the audit log is server-derived; students' answers are
never modified here.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.admin_auth import require_admin
from app.api.admin_dashboard import (FEATURES, JST, _FEATURE_CASE, _VALID_USERS,
                                     _excluded)
from app.api.learning import _HISTORY_SQL, history_items
from app.db.engine import get_engine

router = APIRouter()

Activity = Literal["active", "inactive", "dormant", "not_started"]
AccountState = Literal["normal", "disabled", "unverified"]
Level = Literal["N1", "N2", "N3", "N4", "N5"]
SORTS = {"created_at": "created_at", "last_learn_at": "last_learn_at",
         "answers_7d": "answers_7d"}

_AGG = """
agg AS (
  SELECT s.user_id,
         max(a.submitted_at) AS last_learn_at,
         count(*) FILTER (WHERE (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date >= :d7)
           AS answers_7d,
         count(DISTINCT (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date)
           FILTER (WHERE (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date >= :d7)
           AS days_7d
    FROM study_submitted_answers a
    JOIN study_session_units su ON su.id = a.session_unit_id
    JOIN study_sessions s ON s.id = su.session_id
   WHERE a.chosen_option_id IS NOT NULL
   GROUP BY s.user_id)
"""

_ACTIVITY = """
CASE WHEN agg.last_learn_at IS NULL THEN 'not_started'
     WHEN (agg.last_learn_at AT TIME ZONE 'Asia/Tokyo')::date >= :d7 THEN 'active'
     WHEN (agg.last_learn_at AT TIME ZONE 'Asia/Tokyo')::date >= :d30 THEN 'inactive'
     ELSE 'dormant' END
"""

_ACCOUNT = """
CASE WHEN u.disabled_at IS NOT NULL THEN 'disabled'
     WHEN u.activated_at IS NULL THEN 'unverified'
     ELSE 'normal' END
"""


def _today(now: datetime | None = None):
    return (now or datetime.now(timezone.utc)).astimezone(JST).date()


def _iso(v):
    return v.isoformat() if v is not None else None


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _user_dto(r) -> dict:
    return {
        "id": str(r["id"]), "email": r["email"], "username": r["username"],
        "display_name": r["display_name"],
        "current_level": r["current_level"], "created_at": _iso(r["created_at"]),
        "account_state": r["account_state"], "activity": r["activity"],
        "last_visit_date": _iso(r["last_visit"]),
        "last_learn_at": _iso(r["last_learn_at"]),
        "days_7d": int(r["days_7d"]), "answers_7d": int(r["answers_7d"]),
    }


def list_users(engine, *, q: str, level: str | None, activity: str | None,
               account: str | None, sort: str, order: str, page: int,
               page_size: int, now: datetime | None = None) -> dict:
    today = _today(now)
    exact, suffix = _excluded()
    p = {"d7": today - timedelta(days=6), "d30": today - timedelta(days=30),
         "q": f"%{_escape_like(q.strip().lower())}%" if q.strip() else None,
         "level": level, "activity": activity, "account": account,
         "limit": page_size, "offset": (page - 1) * page_size,
         "ex_exact": exact, "ex_suffix": suffix}
    direction = "ASC" if order == "asc" else "DESC"
    col = SORTS[sort]
    base = f"""
    WITH {_AGG},
    visit AS (SELECT user_id, max(visit_date) AS last_visit
                FROM user_visit_days GROUP BY user_id),
    base AS (
      SELECT u.id, u.email, u.username, u.display_name, u.current_level, u.created_at,
             {_ACCOUNT} AS account_state, {_ACTIVITY} AS activity,
             visit.last_visit, agg.last_learn_at,
             coalesce(agg.days_7d, 0) AS days_7d,
             coalesce(agg.answers_7d, 0) AS answers_7d
        FROM users u
        LEFT JOIN agg ON agg.user_id = u.id
        LEFT JOIN visit ON visit.user_id = u.id)
    """
    where = """
     WHERE (CAST(:q AS text) IS NULL
            OR lower(email) LIKE CAST(:q AS text) ESCAPE '\\'
            OR username LIKE CAST(:q AS text) ESCAPE '\\'
            OR lower(display_name) LIKE CAST(:q AS text) ESCAPE '\\')
       AND (CAST(:level AS text) IS NULL OR current_level = :level)
       AND (CAST(:activity AS text) IS NULL OR activity = :activity)
       AND (CAST(:account AS text) IS NULL OR account_state = :account)
    """
    with engine.connect() as c:
        rows = c.execute(text(
            base + "SELECT *, count(*) OVER () AS full_count FROM base" + where
            + f" ORDER BY {col} {direction} NULLS LAST, id"
            " LIMIT :limit OFFSET :offset"), p).mappings().all()
        total = (int(rows[0]["full_count"]) if rows else int(c.execute(text(
            base + "SELECT count(*) FROM base" + where), p).scalar_one()))
        s = c.execute(text(
            f"WITH {_VALID_USERS}, {_AGG} SELECT count(*) AS total,"
            " count(*) FILTER (WHERE coalesce(agg.days_7d, 0) > 0) AS active_7d,"
            " count(*) FILTER (WHERE agg.last_learn_at IS NULL) AS not_started"
            " FROM valid_users v LEFT JOIN agg ON agg.user_id = v.id"), p).mappings().one()
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_user_dto(r) for r in rows],
        "summary": {"total_users": int(s["total"]),
                    "active_7d": int(s["active_7d"]),
                    "not_started": int(s["not_started"])},
        "timezone": "Asia/Tokyo",
    }


@router.get("/api/admin/users")
def admin_users(
    q: str = Query("", max_length=100),
    level: Level | None = None,
    activity: Activity | None = None,
    account: AccountState | None = None,
    sort: Literal["created_at", "last_learn_at", "answers_7d"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin()),
) -> dict:
    return list_users(get_engine(), q=q, level=level, activity=activity,
                      account=account, sort=sort, order=order, page=page,
                      page_size=page_size)


def _audit_dto(r) -> dict:
    return {"action": r["action"], "admin_username": r["admin_username"],
            "reason": r["reason"], "created_at": _iso(r["created_at"])}


def user_detail(engine, user_id: uuid.UUID, now: datetime | None = None) -> dict | None:
    today = _today(now)
    p = {"u": user_id, "d7": today - timedelta(days=6),
         "d30": today - timedelta(days=30), "d29": today - timedelta(days=29),
         "start29": datetime(*(today - timedelta(days=29)).timetuple()[:3], tzinfo=JST),
         "u_limit": 10}
    answers = ("study_submitted_answers a"
               " JOIN study_session_units su ON su.id = a.session_unit_id"
               " JOIN study_sessions s ON s.id = su.session_id")
    with engine.connect() as c:
        row = c.execute(text(
            f"WITH {_AGG}, visit AS (SELECT user_id, max(visit_date) AS last_visit"
            " FROM user_visit_days GROUP BY user_id)"
            f" SELECT u.id, u.email, u.username, u.display_name, u.current_level, u.created_at,"
            f" u.activated_at, u.disabled_at, {_ACCOUNT} AS account_state,"
            f" {_ACTIVITY} AS activity, visit.last_visit, agg.last_learn_at,"
            " coalesce(agg.days_7d, 0) AS days_7d,"
            " coalesce(agg.answers_7d, 0) AS answers_7d"
            " FROM users u LEFT JOIN agg ON agg.user_id = u.id"
            " LEFT JOIN visit ON visit.user_id = u.id WHERE u.id = :u"),
            p).mappings().first()
        if row is None:
            return None
        daily_rows = {r[0]: r[1] for r in c.execute(text(
            "SELECT (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date AS d, count(*)"
            f" FROM {answers} WHERE s.user_id = :u AND a.chosen_option_id IS NOT NULL"
            " AND (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date >= :d29"
            " GROUP BY d"), p)}
        total_answers = c.execute(text(
            f"SELECT count(*) FROM {answers} WHERE s.user_id = :u"
            " AND a.chosen_option_id IS NOT NULL"), p).scalar_one()
        completed = c.execute(text(
            "SELECT count(*) FROM study_sessions WHERE user_id = :u"
            " AND state = 'completed'"), p).scalar_one()
        feat = {r[0]: r for r in c.execute(text(
            f"SELECT {_FEATURE_CASE} AS feature, count(*),"
            " count(*) FILTER (WHERE s.state = 'completed')"
            " FROM study_sessions s WHERE s.user_id = :u GROUP BY 1"), p)}
        subj = {r[0]: r[1] for r in c.execute(text(
            "SELECT qt.subject, count(*)"
            f" FROM {answers}"
            " JOIN release_questions q ON q.release_id = a.release_id"
            "  AND q.question_id = a.question_id"
            " JOIN question_types qt ON qt.id = q.question_type_id"
            " WHERE s.user_id = :u AND a.chosen_option_id IS NOT NULL"
            " GROUP BY qt.subject"), p)}
        recent = history_items(c.execute(text(_HISTORY_SQL), {
            "u": user_id, "kind": "all", "limit": 10, "offset": 0}).mappings().all())
        audit = [_audit_dto(r) for r in c.execute(text(
            "SELECT action, admin_username, reason, created_at"
            " FROM admin_audit_logs WHERE target_type = 'user' AND target_id = :u"
            " ORDER BY created_at DESC, id LIMIT 10"), p).mappings()]

    daily = []
    for i in range(30):
        d = today - timedelta(days=29 - i)
        daily.append({"date": d.isoformat(), "answers": int(daily_rows.get(d, 0))})
    features = []
    for key, label in FEATURES:
        r = feat.get(key)
        if key == "other" and r is None:
            continue
        features.append({"key": key, "label": label,
                         "starts": int(r[1]) if r else 0,
                         "completions": int(r[2]) if r else 0})
    subjects = [{"subject": k, "label": lab, "answers": int(subj.get(k, 0))}
                for k, lab in (("vocabulary", "文字词汇"), ("grammar", "文法"),
                               ("reading", "读解"), ("listening", "听力"))]
    return {
        "user": {**_user_dto(row), "activated_at": _iso(row["activated_at"]),
                 "disabled_at": _iso(row["disabled_at"])},
        "stats": {"total_answers": int(total_answers),
                  "completed_sessions": int(completed),
                  "active_days_30": sum(1 for d in daily if d["answers"] > 0),
                  "answers_30": sum(d["answers"] for d in daily)},
        "daily_30": daily, "features": features, "subjects": subjects,
        "recent": recent, "audit": audit, "timezone": "Asia/Tokyo",
    }


@router.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: uuid.UUID, admin: dict = Depends(require_admin())) -> dict:
    d = user_detail(get_engine(), user_id)
    if d is None:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return d


class AccountActionBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


def set_account_disabled(engine, user_id: uuid.UUID, disable: bool, admin: dict,
                         reason: str | None) -> None:
    """Disable/enable in one transaction with its audit row.

    Disabling also revokes every live student session so the account is cut
    off immediately; history is untouched. Raises LookupError (404) /
    ValueError with the stable conflict code (409).
    """
    with engine.begin() as c:
        if disable:
            upd = ("UPDATE users SET disabled_at = now() WHERE id = :u"
                   " AND disabled_at IS NULL RETURNING id")
        else:
            upd = ("UPDATE users SET disabled_at = NULL, failed_login_count = 0,"
                   " locked_until = NULL WHERE id = :u"
                   " AND disabled_at IS NOT NULL RETURNING id")
        if c.execute(text(upd), {"u": user_id}).first() is None:
            if c.execute(text("SELECT 1 FROM users WHERE id = :u"),
                         {"u": user_id}).first() is None:
                raise LookupError("not_found")
            raise ValueError("already_disabled" if disable else "not_disabled")
        if disable:
            c.execute(text("UPDATE user_sessions SET revoked_at = now()"
                           " WHERE user_id = :u AND revoked_at IS NULL"),
                      {"u": user_id})
        c.execute(text(
            "INSERT INTO admin_audit_logs (id, admin_id, admin_username, action,"
            " target_type, target_id, reason)"
            " VALUES (:id, :a, :n, :act, 'user', :u, :r)"),
            {"id": uuid.uuid4(), "a": uuid.UUID(str(admin["id"])),
             "n": admin["username"], "u": user_id,
             "act": "user_disable" if disable else "user_enable",
             "r": (reason or "").strip() or None})


def _account_action(user_id: uuid.UUID, disable: bool, body: AccountActionBody | None,
                    admin: dict) -> dict:
    try:
        set_account_disabled(get_engine(), user_id, disable, admin,
                             body.reason if body else None)
    except LookupError:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    except ValueError as e:
        raise HTTPException(status_code=409, detail={"code": str(e)})
    return {"ok": True, "account_state": "disabled" if disable else "normal"}


@router.post("/api/admin/users/{user_id}/disable")
def admin_disable_user(user_id: uuid.UUID, body: AccountActionBody | None = None,
                       admin: dict = Depends(require_admin())) -> dict:
    return _account_action(user_id, True, body, admin)


@router.post("/api/admin/users/{user_id}/enable")
def admin_enable_user(user_id: uuid.UUID, body: AccountActionBody | None = None,
                      admin: dict = Depends(require_admin())) -> dict:
    return _account_action(user_id, False, body, admin)


def reset_user_password(engine, user_id: uuid.UUID, admin: dict,
                        reason: str | None) -> str:
    """Admin resets a student's password (ADR-0029): for accounts that cannot
    self-recover by email. Returns a one-time temporary password (shown once,
    never stored or audited); clears the lock and revokes every session.
    """
    from app.passwords import hash_password
    temp = secrets.token_urlsafe(9)  # 12 chars, meets the 8-char minimum
    with engine.begin() as c:
        if c.execute(text(
                "UPDATE users SET password_hash = :h, failed_login_count = 0,"
                " locked_until = NULL WHERE id = :u RETURNING id"),
                {"h": hash_password(temp), "u": user_id}).first() is None:
            raise LookupError("not_found")
        c.execute(text("UPDATE user_sessions SET revoked_at = now()"
                       " WHERE user_id = :u AND revoked_at IS NULL"),
                  {"u": user_id})
        c.execute(text(
            "INSERT INTO admin_audit_logs (id, admin_id, admin_username, action,"
            " target_type, target_id, reason)"
            " VALUES (:id, :a, :n, 'user_password_reset', 'user', :u, :r)"),
            {"id": uuid.uuid4(), "a": uuid.UUID(str(admin["id"])),
             "n": admin["username"], "u": user_id,
             "r": (reason or "").strip() or None})
    return temp


@router.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_user_password(user_id: uuid.UUID,
                              body: AccountActionBody | None = None,
                              admin: dict = Depends(require_admin())) -> dict:
    try:
        temp = reset_user_password(get_engine(), user_id, admin,
                                   body.reason if body else None)
    except LookupError:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return {"ok": True, "temporary_password": temp}
