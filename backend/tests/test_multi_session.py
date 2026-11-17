"""ADR-0015: many in-progress practice sessions per user.

Sessions hold study data and must stay fully isolated from each other:
answers, drafts, feedback mode, state, history — and from other users,
quick practice and mock slots.
"""
import os

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
Q1 = f"{CLOZE_UNIT}-q01"  # correct: -o2
Q2 = f"{CLOZE_UNIT}-q02"  # correct: -o1
QS = f"{SINGLE_UNIT}-q01"  # correct: -o3


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test."""


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", f"{USER_A},{USER_B}")
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def auth(u):
    return {"Authorization": f"Bearer {u}"}


def topic(client, user, qtype, feedback="immediate"):
    r = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": qtype, "count": 1,
        "feedback_mode": feedback}, headers=auth(user))
    assert r.status_code == 201, r.text
    return r.json()


def submit(client, user, sid, suid, answers):
    return client.post(
        f"/api/practice/sessions/{sid}/units/{suid}/submit",
        json={"answers": [{"question_id": q, "chosen_option_id": c}
                          for q, c in answers]}, headers=auth(user))


def draft(client, user, sid, suid, qid, opt, version=0):
    return client.put(
        f"/api/practice/sessions/{sid}/units/{suid}/drafts",
        json={"question_id": qid, "chosen_option_id": opt,
              "expected_row_version": version}, headers=auth(user))


@requires_db
def test_vocab_open_then_grammar_starts_and_both_resume_by_id(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    vocab = topic(client, USER_A, "vocabulary_kanji_reading")
    grammar = topic(client, USER_A, "grammar_cloze", feedback="end")
    for s, unit, fb in ((vocab, SINGLE_UNIT, "immediate"),
                        (grammar, CLOZE_UNIT, "end")):
        got = client.get(f"/api/practice/sessions/{s['id']}",
                         headers=auth(USER_A)).json()
        assert got["state"] == "in_progress"
        assert got["feedback_mode"] == fb  # own feedback mode per session
        assert [u["unit_id"] for u in got["units"]] == [unit]  # own order/units


@requires_db
def test_drafts_and_state_are_isolated_per_session_and_restore_by_id(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s1 = topic(client, USER_A, "grammar_cloze", feedback="end")
    s2 = topic(client, USER_A, "grammar_cloze", feedback="end")  # same unit again
    su1, su2 = s1["units"][0]["id"], s2["units"][0]["id"]
    assert su1 != su2
    assert draft(client, USER_A, s1["id"], su1, Q1, Q1 + "-o1").status_code == 200
    assert draft(client, USER_A, s2["id"], su2, Q1, Q1 + "-o2").status_code == 200

    # "refresh": drafts come back per session id, never mixed
    d1 = client.get(f"/api/practice/sessions/{s1['id']}/drafts",
                    headers=auth(USER_A)).json()["drafts"]
    d2 = client.get(f"/api/practice/sessions/{s2['id']}/drafts",
                    headers=auth(USER_A)).json()["drafts"]
    assert [(d["question_id"], d["chosen_option_id"]) for d in d1] == [(Q1, Q1 + "-o1")]
    assert [(d["question_id"], d["chosen_option_id"]) for d in d2] == [(Q1, Q1 + "-o2")]

    # a draft is not a submission: nothing formal exists yet
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers")).scalar() == 0

    # submitting s1 never submits s2 or touches its draft
    assert submit(client, USER_A, s1["id"], su1,
                  [(Q1, Q1 + "-o1"), (Q2, Q2 + "-o1")]).status_code == 200
    s2_after = client.get(f"/api/practice/sessions/{s2['id']}",
                          headers=auth(USER_A)).json()
    assert s2_after["units"][0]["state"] == "pending"
    assert s2_after["state"] == "in_progress"
    d2b = client.get(f"/api/practice/sessions/{s2['id']}/drafts",
                     headers=auth(USER_A)).json()["drafts"]
    assert [(d["question_id"], d["chosen_option_id"]) for d in d2b] == [(Q1, Q1 + "-o2")]


@requires_db
def test_end_feedback_stays_locked_until_that_session_finishes(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    a = topic(client, USER_A, "grammar_cloze", feedback="end")
    b = topic(client, USER_A, "vocabulary_kanji_reading", feedback="immediate")
    sa_, sb_ = a["units"][0]["id"], b["units"][0]["id"]
    submit(client, USER_A, a["id"], sa_, [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    submit(client, USER_A, b["id"], sb_, [(QS, QS + "-o3")])
    # b is immediate → its feedback is open; a is "end" and unfinished → locked
    assert client.get(f"/api/practice/sessions/{b['id']}/units/{sb_}/feedback",
                      headers=auth(USER_A)).status_code == 200
    assert client.get(f"/api/practice/sessions/{a['id']}/units/{sa_}/feedback",
                      headers=auth(USER_A)).status_code == 409
    # finishing b (switching away/back never auto-submits a) leaves a locked
    client.post(f"/api/practice/sessions/{b['id']}/finish", headers=auth(USER_A))
    assert client.get(f"/api/practice/sessions/{a['id']}/units/{sa_}/feedback",
                      headers=auth(USER_A)).status_code == 409
    fin = client.post(f"/api/practice/sessions/{a['id']}/finish", headers=auth(USER_A))
    assert fin.json()["state"] == "completed"
    assert client.get(f"/api/practice/sessions/{a['id']}/units/{sa_}/feedback",
                      headers=auth(USER_A)).status_code == 200


@requires_db
def test_submitted_answers_immutable_and_duplicate_submit_counts_once(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = topic(client, USER_A, "grammar_cloze")
    other = topic(client, USER_A, "grammar_cloze")
    suid = s["units"][0]["id"]
    first = submit(client, USER_A, s["id"], suid,
                   [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    assert first.status_code == 200
    # duplicate + conflicting resubmit: stored outcome returned, nothing rewritten
    again = submit(client, USER_A, s["id"], suid,
                   [(Q1, Q1 + "-o1"), (Q2, Q2 + "-o2")])
    assert again.status_code == 200
    with pg_engine.connect() as conn:
        rows = conn.execute(sa.text(
            "SELECT question_id, chosen_option_id, is_correct"
            " FROM study_submitted_answers WHERE session_unit_id = :s"
            " ORDER BY question_id"), {"s": suid}).all()
        total = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers")).scalar()
    assert rows == [(Q1, Q1 + "-o2", True), (Q2, Q2 + "-o1", True)]
    assert total == 2  # the other open session holds nothing
    # catalog counts the unit as practised exactly once
    t = client.get("/api/topic-practice/types?level=N5", headers=auth(USER_A)).json()
    assert {x["question_type_id"]: x["new_units"] for x in t["types"]}["grammar_cloze"] == 0
    st = client.get(f"/api/exams/{s['units'][0]['exam_id']}/practice-status",
                    headers=auth(USER_A)).json()
    assert {u["unit_id"]: u["submitted_count"] for u in st["units"]}[CLOZE_UNIT] == 1
    assert client.get(f"/api/practice/sessions/{other['id']}",
                      headers=auth(USER_A)).json()["units"][0]["state"] == "pending"


@requires_db
def test_other_users_cannot_touch_any_of_the_sessions(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s1 = topic(client, USER_A, "grammar_cloze")
    s2 = topic(client, USER_A, "vocabulary_kanji_reading")
    for s in (s1, s2):
        suid = s["units"][0]["id"]
        sid = s["id"]
        assert client.get(f"/api/practice/sessions/{sid}",
                          headers=auth(USER_B)).status_code == 404
        assert client.get(f"/api/practice/sessions/{sid}/drafts",
                          headers=auth(USER_B)).status_code == 404
        assert draft(client, USER_B, sid, suid, Q1, Q1 + "-o1").status_code == 404
        assert submit(client, USER_B, sid, suid, []).status_code == 404
        assert client.post(f"/api/practice/sessions/{sid}/finish",
                           headers=auth(USER_B)).status_code == 404
    assert client.get("/api/practice/sessions/current",
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_quick_practice_and_mock_slots_unaffected(pg_engine, published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    p1 = topic(client, USER_A, "grammar_cloze")
    p2 = topic(client, USER_A, "vocabulary_kanji_reading")
    q1 = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": SINGLE_UNIT},
        headers=auth(USER_A)).json()
    q2 = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": CLOZE_UNIT},
        headers=auth(USER_A)).json()  # quick still silently replaces quick
    with pg_engine.connect() as conn:
        st = dict(conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions WHERE user_id=:u"),
            {"u": USER_A}).all())
        idx = {r[0]: r[1] for r in conn.execute(sa.text(
            "SELECT indexname, indexdef FROM pg_indexes"
            " WHERE tablename = 'study_sessions'"))}
    assert st[p1["id"]] == st[p2["id"]] == st[q2["id"]] == "in_progress"
    assert st[q1["id"]] == "ended_early"
    # DB-level: practice single-active gone; quick/mock single-active kept
    assert "ux_one_active_practice" not in idx
    assert "UNIQUE" in idx["ux_one_active_quick"]
    assert "UNIQUE" in idx["ux_one_active_mock"]
