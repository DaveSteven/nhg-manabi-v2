"""Admin dashboard: platform-wide operating statistics (read-only).

Definitions (shared with the docs in docs/development/admin-dashboard.md):
- All dates are Asia/Tokyo calendar days; the window is the last N days
  including today.
- "Valid user" = activated, not disabled, not matched by DASHBOARD_EXCLUDE_EMAILS
  (comma list; exact addresses or ``@domain`` suffixes). Admins live in a
  separate table and never appear.
- "Learning active" = distinct valid users with >=1 formally submitted answer
  carrying an actual choice (drafts, skipped answers and page views don't
  count). "Answered questions" counts those same rows.
- Visit activity = distinct valid users with a row in user_visit_days (one
  ping per signed-in user per day, migration 0017). Collection starts when the
  table gets its first row; days before that are null, never estimated, and
  with no rows at all visit data is reported unavailable.
Only counts and dates are returned; no personal data or answer content.
"""
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from app.admin_auth import require_admin
from app.db.engine import get_engine

router = APIRouter()
JST = ZoneInfo("Asia/Tokyo")

FEATURES = [
    ("quick", "快速练习"),
    ("topic", "专项练习"),
    ("mock", "模拟考试"),
    ("review", "错题复习"),
    ("other", "其他练习"),
]

# Mutually exclusive source of a session, from explicit session data only.
_FEATURE_CASE = """
CASE WHEN s.mode = 'quick_practice' THEN 'quick'
     WHEN s.mode = 'mock' THEN 'mock'
     WHEN s.config -> 'topic' ->> 'selection' = 'wrong_only' THEN 'review'
     WHEN s.config -> 'topic' IS NOT NULL THEN 'topic'
     ELSE 'other' END
"""

_VALID_USERS = """
valid_users AS (
  SELECT id, created_at FROM users
   WHERE activated_at IS NOT NULL AND disabled_at IS NULL
     AND coalesce(lower(email), '') <> ALL(:ex_exact)
     AND NOT EXISTS (SELECT 1 FROM unnest(CAST(:ex_suffix AS text[])) x
                      WHERE right(coalesce(lower(email), ''), length(x)) = x)
)
"""


def _excluded() -> tuple[list[str], list[str]]:
    raw = [p.strip().lower() for p in
           os.environ.get("DASHBOARD_EXCLUDE_EMAILS", "").split(",") if p.strip()]
    return ([p for p in raw if not p.startswith("@")],
            [p for p in raw if p.startswith("@")])


def _rate(num: int, den: int):
    return round(num / den, 4) if den else None


def build_dashboard(engine, days: int, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(JST).date()
    first = today - timedelta(days=days - 1)
    start = datetime(first.year, first.month, first.day, tzinfo=JST)
    end = datetime(today.year, today.month, today.day, tzinfo=JST) + timedelta(days=1)
    exact, suffix = _excluded()
    p = {"start": start, "end": end, "first": first, "today": today,
         "ex_exact": exact, "ex_suffix": suffix}
    with engine.connect() as c:
        registered = c.execute(text(
            f"WITH {_VALID_USERS} SELECT count(*) FROM valid_users"), p).scalar_one()
        new_users = c.execute(text(
            f"WITH {_VALID_USERS} SELECT count(*) FROM valid_users"
            " WHERE created_at >= :start AND created_at < :end"), p).scalar_one()
        answers_cte = f"""
        WITH {_VALID_USERS},
        ans AS (
          SELECT s.user_id, (a.submitted_at AT TIME ZONE 'Asia/Tokyo')::date AS d
            FROM study_submitted_answers a
            JOIN study_session_units su ON su.id = a.session_unit_id
            JOIN study_sessions s ON s.id = su.session_id
            JOIN valid_users v ON v.id = s.user_id
           WHERE a.chosen_option_id IS NOT NULL
             AND a.submitted_at >= :start AND a.submitted_at < :end
        )"""
        active, answered = c.execute(text(
            answers_cte + " SELECT count(DISTINCT user_id), count(*) FROM ans"), p).one()
        since = c.execute(text("SELECT min(visit_date) FROM user_visit_days")).scalar_one()
        visit_rows = {r[0]: r[1] for r in c.execute(text(
            f"WITH {_VALID_USERS} SELECT d.visit_date, count(*)"
            " FROM user_visit_days d JOIN valid_users v ON v.id = d.user_id"
            " WHERE d.visit_date >= :first AND d.visit_date <= :today"
            " GROUP BY d.visit_date"), p)}
        visit_users = c.execute(text(
            f"WITH {_VALID_USERS} SELECT count(DISTINCT d.user_id)"
            " FROM user_visit_days d JOIN valid_users v ON v.id = d.user_id"
            " WHERE d.visit_date >= :first AND d.visit_date <= :today"), p).scalar_one()
        daily_rows = {r[0]: r[1] for r in c.execute(text(
            answers_cte + " SELECT d, count(DISTINCT user_id) FROM ans GROUP BY d"), p)}
        sess_cte = f"""
        WITH {_VALID_USERS},
        sess AS (
          SELECT s.user_id, s.state, {_FEATURE_CASE} AS feature
            FROM study_sessions s JOIN valid_users v ON v.id = s.user_id
           WHERE s.created_at >= :start AND s.created_at < :end
        )"""
        feat_rows = {r[0]: r for r in c.execute(text(
            sess_cte + " SELECT feature, count(DISTINCT user_id), count(*),"
            " count(*) FILTER (WHERE state = 'completed') FROM sess"
            " GROUP BY feature"), p)}
        started_u, completed_u = c.execute(text(
            sess_cte + " SELECT count(DISTINCT user_id),"
            " count(DISTINCT user_id) FILTER (WHERE state = 'completed')"
            " FROM sess"), p).one()
        not_started = c.execute(text(
            f"WITH {_VALID_USERS} SELECT count(*) FROM valid_users v"
            " WHERE v.created_at >= :start AND v.created_at < :end"
            " AND NOT EXISTS (SELECT 1 FROM study_sessions s WHERE s.user_id = v.id)"),
            p).scalar_one()
        unfinished = c.execute(text(
            f"WITH {_VALID_USERS} SELECT count(DISTINCT s.user_id)"
            " FROM study_sessions s JOIN valid_users v ON v.id = s.user_id"
            " WHERE s.state = 'in_progress'"), p).scalar_one()

    daily = []
    for i in range(days):
        d = first + timedelta(days=i)
        tracked = since is not None and d >= since
        daily.append({"date": d.isoformat(), "learning": daily_rows.get(d, 0),
                      "visit": visit_rows.get(d, 0) if tracked else None})
    features = []
    for key, label in FEATURES:
        r = feat_rows.get(key)
        users, starts, done = (r[1], r[2], r[3]) if r else (0, 0, 0)
        if key == "other" and starts == 0:
            continue
        features.append({"key": key, "label": label, "users": users,
                         "starts": starts, "completions": done,
                         "completion_rate": _rate(done, starts)})
    return {
        "range": {"days": days, "start": first.isoformat(), "end": today.isoformat(),
                  "timezone": "Asia/Tokyo"},
        "metrics": {"registered_users": registered, "active_learners": active,
                    "new_users": new_users, "answered_questions": answered},
        "daily": daily,
        "visit_tracking": (
            {"available": True, "since": since.isoformat(),
             "note": f"访问数据自 {since.isoformat()} 起采集（登录用户每日一次），此前日期不统计。"}
            if since else
            {"available": False, "since": None,
             "note": "尚未采集访问事件，访问活跃与访问漏斗暂不可用。"}),
        "features": features,
        "funnel": {"visit_users": visit_users if since else None,
                   "started_users": started_u, "completed_users": completed_u,
                   "visit_to_start_rate": _rate(started_u, visit_users) if since else None,
                   "start_to_complete_rate": _rate(completed_u, started_u),
                   "note": "分母为同一时间范围内开始过练习的去重用户；完成=有已完成的练习。"},
        "alerts": [
            {"key": "registered_not_started", "label": "新注册后尚未开始学习",
             "count": not_started, "scope": "range"},
            {"key": "unfinished_sessions", "label": "有进行中但未完成的练习",
             "count": unfinished, "scope": "current"},
        ],
    }


@router.get("/api/admin/dashboard")
def admin_dashboard(days: int = Query(7), admin: dict = Depends(require_admin())) -> dict:
    if days not in (7, 30):
        raise HTTPException(status_code=422, detail="days must be 7 or 30")
    return build_dashboard(get_engine(), days)
