"""ADR-0016: one recoverable 专项/普通 practice session per user.

Starting a new practice abandons the previous in-progress one inside the
same transaction. Formal answers/history of the old session are kept; its
unsubmitted drafts never count; a failed start loses nothing. Quick
Practice and mock exams keep their own slots.
"""
import os
from concurrent.futures import ThreadPoolExecutor

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


def topic(client, user, qtype, feedback="immediate", count=1):
    r = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": qtype, "count": count,
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


def states(pg_engine, user=USER_A):
    with pg_engine.connect() as conn:
        return dict(conn.execute(sa.text(
            "SELECT id::text, state FROM study_sessions WHERE user_id=:u"),
            {"u": user}).all())


@requires_db
def test_new_topic_practice_abandons_old_without_conflict_and_keeps_history(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    vocab = topic(client, USER_A, "vocabulary_kanji_reading")
    suv = vocab["units"][0]["id"]
    submit(client, USER_A, vocab["id"], suv, [(QS, QS + "-o3")])  # formal answer
    grammar = topic(client, USER_A, "grammar_cloze")               # no 409
    st = states(pg_engine)
    assert st[vocab["id"]] == "abandoned"
    assert st[grammar["id"]] == "in_progress"
    assert list(st.values()).count("in_progress") == 1
    with pg_engine.connect() as conn:
        kept = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers WHERE session_unit_id=:s"),
            {"s": suv}).scalar()
        ended = conn.execute(sa.text(
            "SELECT ended_at IS NOT NULL FROM study_sessions WHERE id=:s"),
            {"s": vocab["id"]}).scalar()
    assert kept == 1 and ended is True  # history kept, abandonment timestamped
    t = client.get("/api/topic-practice/types?level=N5", headers=auth(USER_A)).json()
    assert {x["question_type_id"]: x["new_units"] for x in t["types"]}[
        "vocabulary_kanji_reading"] == 0  # still counted as practised
    cur = client.get("/api/practice/sessions/current", headers=auth(USER_A))
    assert cur.json()["id"] == grammar["id"]  # the single recoverable one


@requires_db
def test_abandoned_session_is_frozen_drafts_do_not_count_and_no_result(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    old = topic(client, USER_A, "grammar_cloze", feedback="end")
    suo = old["units"][0]["id"]
    assert draft(client, USER_A, old["id"], suo, Q1, Q1 + "-o2").status_code == 200
    topic(client, USER_A, "vocabulary_kanji_reading")
    # frozen: nothing can be saved/submitted/finished against it
    assert draft(client, USER_A, old["id"], suo, Q2, Q2 + "-o1").status_code == 409
    assert client.post(f"/api/practice/sessions/{old['id']}/submit",
                       json={"answers": []}, headers=auth(USER_A)).status_code == 409
    assert client.post(f"/api/practice/sessions/{old['id']}/finish",
                       headers=auth(USER_A)).status_code == 409
    r = client.get(f"/api/practice/sessions/{old['id']}/results", headers=auth(USER_A))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "session_abandoned"
    # its unsubmitted draft never became a formal answer, history or score
    with pg_engine.connect() as conn:
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers")).scalar() == 0
        assert conn.execute(sa.text(
            "SELECT count(*) FROM study_results")).scalar() == 0
    t = client.get("/api/topic-practice/types?level=N5", headers=auth(USER_A)).json()
    assert {x["question_type_id"]: x["new_units"] for x in t["types"]}["grammar_cloze"] == 1
    # owner can still read the abandoned session (read-only), others cannot
    assert client.get(f"/api/practice/sessions/{old['id']}",
                      headers=auth(USER_A)).json()["state"] == "abandoned"
    assert client.get(f"/api/practice/sessions/{old['id']}",
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_failed_start_keeps_the_old_practice(pg_engine, published_release,
                                             monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    old = topic(client, USER_A, "grammar_cloze")
    # 1) unit not available → 422 inside the replace transaction
    bad = client.post("/api/practice/sessions", json={
        "feedback_mode": "immediate",
        "units": [{"release_id": str(published_release), "unit_id": "no-such-unit"}]},
        headers=auth(USER_A))
    assert bad.status_code == 422
    # 2) topic count over the limit / no candidates → rejected before replacing
    over = client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": "grammar_cloze", "count": 5,
        "feedback_mode": "end"}, headers=auth(USER_A))
    assert over.status_code == 422
    nothing = client.post("/api/topic-practice/sessions", json={
        "level": "N1", "question_type_id": "grammar_cloze", "count": 1,
        "feedback_mode": "end"}, headers=auth(USER_A))
    assert nothing.status_code == 422
    assert states(pg_engine) == {old["id"]: "in_progress"}
    assert client.get("/api/practice/sessions/current",
                      headers=auth(USER_A)).json()["id"] == old["id"]


@requires_db
def test_refresh_restores_the_current_sessions_drafts_and_order(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    topic(client, USER_A, "vocabulary_kanji_reading")  # abandoned below
    cur = topic(client, USER_A, "grammar_cloze", feedback="end")
    suid = cur["units"][0]["id"]
    draft(client, USER_A, cur["id"], suid, Q1, Q1 + "-o1")
    draft(client, USER_A, cur["id"], suid, Q1, Q1 + "-o2", version=1)
    got = client.get("/api/practice/sessions/current", headers=auth(USER_A)).json()
    assert got["id"] == cur["id"] and got["units"] == cur["units"]
    drafts = client.get(f"/api/practice/sessions/{cur['id']}/drafts",
                        headers=auth(USER_A)).json()["drafts"]
    assert [(d["question_id"], d["chosen_option_id"]) for d in drafts] == [(Q1, Q1 + "-o2")]


@requires_db
def test_completion_keeps_the_result_and_clears_the_resumable_slot(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = topic(client, USER_A, "grammar_cloze", feedback="end")
    su = s["units"][0]["id"]
    done = client.post(f"/api/practice/sessions/{s['id']}/submit", json={"answers": [
        {"session_unit_id": su, "question_id": Q1, "chosen_option_id": Q1 + "-o2"},
        {"session_unit_id": su, "question_id": Q2, "chosen_option_id": Q2 + "-o1"}]},
        headers=auth(USER_A))
    assert done.status_code == 200
    # nothing resumable left; the formal result is stored and readable
    assert client.get("/api/practice/sessions/current",
                      headers=auth(USER_A)).status_code == 404
    res = client.get(f"/api/practice/sessions/{s['id']}/results", headers=auth(USER_A))
    assert res.status_code == 200 and res.json()["correct_count"] == 2
    # the next practice abandons nothing: completed stays completed with its result
    nxt = topic(client, USER_A, "vocabulary_kanji_reading")
    st = states(pg_engine)
    assert st[s["id"]] == "completed" and st[nxt["id"]] == "in_progress"
    assert client.get(f"/api/practice/sessions/{s['id']}/results",
                      headers=auth(USER_A)).status_code == 200


@requires_db
def test_repeated_starts_always_leave_exactly_one_in_progress(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    ids = [topic(client, USER_A, "grammar_cloze")["id"] for _ in range(4)]
    st = states(pg_engine)
    assert [st[i] for i in ids] == ["abandoned"] * 3 + ["in_progress"]
    # other users are never touched
    other = topic(client, USER_B, "grammar_cloze")
    assert states(pg_engine, USER_B) == {other["id"]: "in_progress"}
    assert list(states(pg_engine).values()).count("in_progress") == 1


@requires_db
def test_concurrent_starts_end_with_a_single_in_progress_session(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)

    def start(_):
        return client.post("/api/topic-practice/sessions", json={
            "level": "N5", "question_type_id": "grammar_cloze", "count": 1,
            "feedback_mode": "immediate"}, headers=auth(USER_A)).status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(start, range(4)))
    assert all(c in (201, 409) for c in codes) and 201 in codes
    assert list(states(pg_engine).values()).count("in_progress") == 1


@requires_db
def test_quick_practice_and_mock_slots_keep_their_own_rules(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    p1 = topic(client, USER_A, "grammar_cloze")
    q1 = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": SINGLE_UNIT},
        headers=auth(USER_A)).json()
    p2 = topic(client, USER_A, "vocabulary_kanji_reading")  # abandons p1 only
    q2 = client.post("/api/quick-practice/sessions", json={
        "release_id": str(published_release), "unit_id": CLOZE_UNIT},
        headers=auth(USER_A)).json()  # replaces q1 only; p2 untouched
    st = states(pg_engine)
    assert (st[p1["id"]], st[p2["id"]]) == ("abandoned", "in_progress")
    assert (st[q1["id"]], st[q2["id"]]) == ("ended_early", "in_progress")
    with pg_engine.connect() as conn:
        idx = {r[0]: r[1] for r in conn.execute(sa.text(
            "SELECT indexname, indexdef FROM pg_indexes"
            " WHERE tablename = 'study_sessions'"))}
    for name in ("ux_one_active_practice", "ux_one_active_quick", "ux_one_active_mock"):
        assert "UNIQUE" in idx[name]
    assert "ix_sessions_user_active_practice" not in idx
