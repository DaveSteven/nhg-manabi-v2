"""Admin user management: list/filters/status, detail, enable/disable + audit."""
import uuid

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT
from test_admin_dashboard import add_user, admin_headers, dash
from test_quick_practice import create_quick
from test_topic_practice import (Q1, Q2, QS, USER_A, USER_B, auth, create,
                                 make_client, requires_db, submit)

USER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc"


@pytest.fixture(autouse=True)
def _isolation(clean_study, pg_engine):
    def wipe():
        with pg_engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM admin_audit_logs"))
            conn.execute(sa.text("DELETE FROM user_visit_days"))
            conn.execute(sa.text("DELETE FROM admin_sessions"))
            conn.execute(sa.text("DELETE FROM admin_users"))
            conn.execute(sa.text("DELETE FROM user_sessions WHERE user_id IN (:a, :b, :c)"),
                         {"a": USER_A, "b": USER_B, "c": USER_C})
            conn.execute(sa.text(
                "DELETE FROM users WHERE id IN (:a, :b, :c) OR email LIKE '%@um.test'"),
                {"a": USER_A, "b": USER_B, "c": USER_C})
    wipe()
    yield
    wipe()


def lst(engine, **kw):
    from app.api.admin_users import list_users
    args = dict(q="", level=None, activity=None, account=None,
                sort="created_at", order="desc", page=1, page_size=20)
    args.update(kw)
    return list_users(engine, **args)


def by_email(res):
    return {i["email"]: i for i in res["items"]}


def backdate_answers(engine, user_id, days):
    with engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE study_submitted_answers SET submitted_at ="
            " submitted_at - make_interval(days => :d) WHERE session_unit_id IN ("
            " SELECT su.id FROM study_session_units su JOIN study_sessions s"
            "  ON s.id = su.session_id WHERE s.user_id = :u)"),
            {"d": days, "u": user_id})


def learn(client, user, release):
    q = create_quick(client, user, release, SINGLE_UNIT).json()
    assert submit(client, user, q["id"], q["units"][0]["id"],
                  [(QS, QS + "-o3")]).status_code == 200


@requires_db
def test_requires_admin_and_validates_params(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/admin/users").status_code == 401
    assert client.get("/api/admin/users", headers=auth(USER_A)).status_code == 401
    assert client.get(f"/api/admin/users/{USER_A}").status_code == 401
    assert client.post(f"/api/admin/users/{USER_A}/disable").status_code == 401
    h = admin_headers(client, pg_engine)
    assert client.get("/api/admin/users?sort=password_hash", headers=h).status_code == 422
    assert client.get("/api/admin/users?page_size=101", headers=h).status_code == 422
    r = client.get("/api/admin/users", headers=h)
    assert r.status_code == 200 and "password_hash" not in r.text


@requires_db
def test_list_activity_statuses_and_window_boundaries(pg_engine, published_release,
                                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@um.test")
    add_user(pg_engine, USER_B, "b@um.test")
    add_user(pg_engine, USER_C, "c@um.test")
    learn(client, USER_A, published_release)
    # B only skipped: submitted but no choice -> never counts as learning.
    s = create(client, USER_B, qtype="vocabulary_kanji_reading").json()
    assert submit(client, USER_B, s["id"], s["units"][0]["id"], []).status_code == 200

    res = by_email(lst(pg_engine))
    assert res["a@um.test"]["activity"] == "active"
    assert (res["a@um.test"]["days_7d"], res["a@um.test"]["answers_7d"]) == (1, 1)
    assert res["b@um.test"]["activity"] == "not_started"
    assert res["b@um.test"]["last_learn_at"] is None
    assert res["c@um.test"]["activity"] == "not_started"
    assert res["a@um.test"]["last_visit_date"] is None   # never faked from login

    for days, expect, in_7d in ((6, "active", 1), (7, "inactive", 0),
                                (30, "inactive", 0), (31, "dormant", 0)):
        with pg_engine.begin() as conn:
            conn.execute(sa.text(
                "UPDATE study_submitted_answers SET submitted_at = now()"
                " - make_interval(days => :d) + interval '1 minute'"
                " WHERE session_unit_id IN (SELECT su.id FROM study_session_units su"
                " JOIN study_sessions s ON s.id = su.session_id WHERE s.user_id = :u)"),
                {"d": days, "u": USER_A})
        row = by_email(lst(pg_engine))["a@um.test"]
        assert (row["activity"], row["answers_7d"]) == (expect, in_7d), days


@requires_db
def test_filters_search_sort_and_pagination(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "alice@um.test")
    add_user(pg_engine, USER_B, "bob@um.test")
    add_user(pg_engine, USER_C, "carol@um.test", disabled=True)
    with pg_engine.begin() as conn:
        conn.execute(sa.text("UPDATE users SET display_name='100%_Fan', current_level='N1'"
                             " WHERE id = :u"), {"u": USER_B})
    learn(client, USER_A, published_release)
    t = create(client, USER_B).json()
    submit(client, USER_B, t["id"], t["units"][0]["id"], [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])

    assert {i["email"] for i in lst(pg_engine, q="ALICE")["items"]} == {"alice@um.test"}
    assert {i["email"] for i in lst(pg_engine, q="bob@um")["items"]} == {"bob@um.test"}
    # LIKE metacharacters are literal, not wildcards.
    assert [i["email"] for i in lst(pg_engine, q="%")["items"]] == ["bob@um.test"]
    assert [i["email"] for i in lst(pg_engine, q="_Fan")["items"]] == ["bob@um.test"]
    assert [i["email"] for i in lst(pg_engine, level="N1")["items"]] == ["bob@um.test"]
    assert {i["email"] for i in lst(pg_engine, activity="active")["items"]} == \
        {"alice@um.test", "bob@um.test"}
    assert [i["email"] for i in lst(pg_engine, account="disabled")["items"]] == ["carol@um.test"]
    assert lst(pg_engine, account="normal")["total"] == 2

    top = lst(pg_engine, sort="answers_7d", order="desc")["items"]
    assert [i["email"] for i in top][:2] == ["bob@um.test", "alice@um.test"]  # 2 vs 1
    p1 = lst(pg_engine, page_size=2, sort="created_at", order="asc")
    p2 = lst(pg_engine, page_size=2, page=2, sort="created_at", order="asc")
    assert p1["total"] == p2["total"] == 3
    assert len(p1["items"]) == 2 and len(p2["items"]) == 1
    assert lst(pg_engine, page=9)["items"] == [] and lst(pg_engine, page=9)["total"] == 3
    # never-learned users sort last when ordering by last learning time
    ll = lst(pg_engine, sort="last_learn_at", order="desc")["items"]
    assert ll[-1]["email"] == "carol@um.test"


@requires_db
def test_summary_matches_dashboard_definition(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@um.test")
    add_user(pg_engine, USER_B, "b@um.test")
    add_user(pg_engine, USER_C, "c@um.test", disabled=True)   # not a valid user
    learn(client, USER_A, published_release)
    summary = lst(pg_engine)["summary"]
    d = dash(pg_engine, 7)
    assert summary == {"total_users": 2, "active_7d": 1, "not_started": 1}
    assert summary["total_users"] == d["metrics"]["registered_users"]
    assert summary["active_7d"] == d["metrics"]["active_learners"]
    monkeypatch.setenv("DASHBOARD_EXCLUDE_EMAILS", "@um.test")
    assert lst(pg_engine)["summary"]["total_users"] == 0
    assert lst(pg_engine)["total"] == 3          # rows stay manageable


@requires_db
def test_last_visit_is_the_visit_date_only(pg_engine, monkeypatch):
    add_user(pg_engine, USER_A, "a@um.test")
    with pg_engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO user_visit_days (user_id, visit_date)"
                             " VALUES (:u, '2026-11-10'), (:u, '2026-11-12')"), {"u": USER_A})
    assert by_email(lst(pg_engine))["a@um.test"]["last_visit_date"] == "2026-11-12"


@requires_db
def test_detail_stats_trend_features_subjects_recent(pg_engine, published_release,
                                                     monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@um.test")
    learn(client, USER_A, published_release)
    t = create(client, USER_A).json()
    submit(client, USER_A, t["id"], t["units"][0]["id"], [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o3")])
    client.post(f"/api/practice/sessions/{t['id']}/finish", headers=auth(USER_A))
    h = admin_headers(client, pg_engine)

    r = client.get(f"/api/admin/users/{USER_A}", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["email"] == "a@um.test" and d["user"]["activity"] == "active"
    assert "password_hash" not in r.text and "token" not in r.text
    assert d["stats"] == {"total_answers": 3, "completed_sessions": 2,
                          "active_days_30": 1, "answers_30": 3}
    assert len(d["daily_30"]) == 30 and d["daily_30"][-1]["answers"] == 3
    feats = {f["key"]: f for f in d["features"]}
    assert (feats["quick"]["starts"], feats["quick"]["completions"]) == (1, 1)
    assert (feats["topic"]["starts"], feats["topic"]["completions"]) == (1, 1)
    assert feats["mock"]["starts"] == 0 and "other" not in feats
    assert [s["subject"] for s in d["subjects"]] == \
        ["vocabulary", "grammar", "reading", "listening"]
    assert sum(s["answers"] for s in d["subjects"]) == 3
    assert len(d["recent"]) == 2 and d["recent"][0]["total"] >= 1
    assert d["audit"] == []
    assert client.get(f"/api/admin/users/{uuid.uuid4()}", headers=h).status_code == 404


@requires_db
def test_disable_enable_revokes_sessions_logs_audit_keeps_history(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@um.test")
    learn(client, USER_A, published_release)
    with pg_engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO user_sessions (id, user_id, token_hash, expires_at)"
            " VALUES (:i, :u, repeat('a', 64), now() + interval '1 day')"),
            {"i": uuid.uuid4(), "u": USER_A})
    h = admin_headers(client, pg_engine)

    r = client.post(f"/api/admin/users/{USER_A}/disable", headers=h,
                    json={"reason": "  测试账号  "})
    assert r.status_code == 200 and r.json()["account_state"] == "disabled"
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM user_sessions WHERE user_id = :u AND revoked_at IS NULL"),
            {"u": USER_A}).scalar_one() == 0
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers"), {}).scalar_one() == 1
    assert client.post(f"/api/admin/users/{USER_A}/disable", headers=h).status_code == 409
    d = client.get(f"/api/admin/users/{USER_A}", headers=h).json()
    assert d["user"]["account_state"] == "disabled" and d["user"]["disabled_at"]
    assert d["stats"]["total_answers"] == 1                    # history retained
    assert d["audit"][0]["action"] == "user_disable"
    assert d["audit"][0]["reason"] == "测试账号" and d["audit"][0]["admin_username"] == "boss"

    assert client.post(f"/api/admin/users/{USER_A}/enable", headers=h).status_code == 200
    assert client.post(f"/api/admin/users/{USER_A}/enable", headers=h).status_code == 409
    d = client.get(f"/api/admin/users/{USER_A}", headers=h).json()
    assert d["user"]["account_state"] == "normal"
    assert [a["action"] for a in d["audit"]] == ["user_enable", "user_disable"]
    assert client.post(f"/api/admin/users/{uuid.uuid4()}/disable", headers=h).status_code == 404
    assert client.post(f"/api/admin/users/{USER_A}/disable", headers=h,
                       json={"reason": "x" * 501}).status_code == 422
