"""Admin dashboard statistics: real PG, real study flows, no fabricated data."""
import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT
from test_quick_practice import create_quick
from test_topic_practice import (Q1, Q2, QS, USER_A, USER_B, auth, create,
                                 make_client, requires_db, submit)

PW = "correct horse battery"


@pytest.fixture(autouse=True)
def _isolation(clean_study, pg_engine):
    def wipe():
        with pg_engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM admin_sessions"))
            conn.execute(sa.text("DELETE FROM admin_users"))
            conn.execute(sa.text(
                "DELETE FROM users WHERE id IN (:a, :b) OR email LIKE '%@dash.test'"),
                {"a": USER_A, "b": USER_B})
    wipe()
    yield
    wipe()


def add_user(engine, uid, email, activated=True, disabled=False):
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO users (id, email, display_name, password_hash,"
            " activated_at, disabled_at) VALUES (:i, :e, 'x', 'x',"
            " CASE WHEN :act THEN now() END, CASE WHEN :dis THEN now() END)"),
            {"i": uid, "e": email, "act": activated, "dis": disabled})


def admin_headers(client, engine):
    from app.admin_auth import create_admin
    create_admin(engine, "boss", PW, "super_admin", display_name="Boss")
    tok = client.post("/api/admin/auth/login",
                      json={"username": "boss", "password": PW}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def dash(engine, days=7):
    from app.api.admin_dashboard import build_dashboard
    return build_dashboard(engine, days)


def feat(d, key):
    return next(f for f in d["features"] if f["key"] == key)


@requires_db
def test_requires_admin_and_validates_range(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/admin/dashboard").status_code == 401
    assert client.get("/api/admin/dashboard", headers=auth(USER_A)).status_code == 401
    h = admin_headers(client, pg_engine)
    assert client.get("/api/admin/dashboard?days=5", headers=h).status_code == 422
    r = client.get("/api/admin/dashboard?days=30", headers=h)
    assert r.status_code == 200 and len(r.json()["daily"]) == 30


@requires_db
def test_empty_platform_is_zero_and_visit_unavailable(pg_engine, published_release):
    d = dash(pg_engine)
    assert d["metrics"] == {"registered_users": 0, "active_learners": 0,
                            "new_users": 0, "answered_questions": 0}
    assert d["visit_tracking"]["available"] is False
    assert all(p["visit"] is None for p in d["daily"])
    assert d["funnel"]["visit_users"] is None
    assert d["funnel"]["start_to_complete_rate"] is None
    assert [f["completion_rate"] for f in d["features"]] == [None] * 4


@requires_db
def test_learning_flows_counted_by_formal_answers_only(pg_engine, published_release,
                                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@dash.test")
    add_user(pg_engine, USER_B, "b@dash.test")
    # A: quick practice, one real answer + completed
    q = create_quick(client, USER_A, published_release, SINGLE_UNIT).json()
    assert submit(client, USER_A, q["id"], q["units"][0]["id"],
                  [(QS, QS + "-o3")]).status_code == 200
    # A: topic practice with both questions answered
    t = create(client, USER_A).json()
    assert submit(client, USER_A, t["id"], t["units"][0]["id"],
                  [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o3")]).status_code == 200
    # B: started a topic session, only a draft-free skip submit (no choice)
    s = create(client, USER_B, qtype="vocabulary_kanji_reading").json()
    assert submit(client, USER_B, s["id"], s["units"][0]["id"], []).status_code == 200
    for u, sess in ((USER_A, t), (USER_B, s)):
        client.post(f"/api/practice/sessions/{sess['id']}/finish", headers=auth(u))

    d = dash(pg_engine)
    assert d["metrics"]["registered_users"] == 2
    assert d["metrics"]["new_users"] == 2
    assert d["metrics"]["active_learners"] == 1          # B only skipped
    assert d["metrics"]["answered_questions"] == 3        # 1 quick + 2 topic
    assert sum(p["learning"] for p in d["daily"]) >= 1
    assert d["daily"][-1]["learning"] == 1
    assert feat(d, "quick")["starts"] == 1 and feat(d, "quick")["completions"] == 1
    top = feat(d, "topic")
    assert (top["users"], top["starts"], top["completions"]) == (2, 2, 2)
    assert top["completion_rate"] == 1.0
    assert d["funnel"]["started_users"] == 2 and d["funnel"]["completed_users"] == 2
    assert "other" not in [f["key"] for f in d["features"]]


@requires_db
def test_review_session_is_not_double_counted_and_unfinished_alert(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@dash.test")
    t = create(client, USER_A).json()
    s = submit(client, USER_A, t["id"], t["units"][0]["id"],
               [(Q1, Q1 + "-o1"), (Q2, Q2 + "-o3")])
    assert s.status_code == 200
    # wrong_only review of the still-wrong unit, left unfinished
    r = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "grammar_cloze", "count": 1,
        "feedback_mode": "immediate", "selection": "wrong_only"},
        headers=auth(USER_A))
    assert r.status_code == 201, r.text
    d = dash(pg_engine)
    assert feat(d, "review")["starts"] == 1 and feat(d, "review")["completions"] == 0
    assert feat(d, "review")["completion_rate"] == 0.0
    assert feat(d, "topic")["starts"] == 1     # the review session is not also 专项
    alert = {a["key"]: a["count"] for a in d["alerts"]}
    assert alert["unfinished_sessions"] == 1
    assert alert["registered_not_started"] == 0


@requires_db
def test_inactive_disabled_and_excluded_users_are_left_out(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    add_user(pg_engine, USER_A, "a@dash.test")
    add_user(pg_engine, USER_B, "tester@dash.test", activated=True)
    add_user(pg_engine, "cccccccc-cccc-cccc-cccc-cccccccccccc", "c@dash.test",
             activated=False)
    add_user(pg_engine, "dddddddd-dddd-dddd-dddd-dddddddddddd", "d@dash.test",
             disabled=True)
    try:
        d = dash(pg_engine)
        assert d["metrics"]["registered_users"] == 2   # A, B only
        assert {a["key"]: a["count"] for a in d["alerts"]}[
            "registered_not_started"] == 2
        monkeypatch.setenv("DASHBOARD_EXCLUDE_EMAILS", "tester@dash.test")
        assert dash(pg_engine)["metrics"]["registered_users"] == 1
        monkeypatch.setenv("DASHBOARD_EXCLUDE_EMAILS", "@dash.test")
        assert dash(pg_engine)["metrics"]["registered_users"] == 0
    finally:
        with pg_engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM users WHERE email LIKE '%@dash.test'"))
