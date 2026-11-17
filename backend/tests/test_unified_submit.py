"""统一反馈 (feedback_mode='end') whole-session submit.

Navigating a unified-feedback session only ever saves drafts. One
POST /sessions/{id}/submit judges everything, writes the formal answers
and the aggregate result in a single transaction; before it nothing —
no payload, no endpoint — reveals correctness.
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


def new_session(client, release_id, units, feedback="end", user=USER_A):
    r = client.post("/api/practice/sessions", json={
        "feedback_mode": feedback,
        "units": [{"release_id": str(release_id), "unit_id": u} for u in units]},
        headers=auth(user))
    assert r.status_code == 201, r.text
    s = r.json()
    return s, {u["unit_id"]: u["id"] for u in s["units"]}


def submit_all(client, sid, answers, user=USER_A):
    return client.post(f"/api/practice/sessions/{sid}/submit", json={
        "answers": [{"session_unit_id": su, "question_id": q,
                     "chosen_option_id": c} for su, q, c in answers]},
        headers=auth(user))


def count(pg_engine, sql, **p):
    with pg_engine.connect() as conn:
        return conn.execute(sa.text(sql), p).scalar()


@requires_db
def test_drafts_and_navigation_never_write_formal_answers_or_judge(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s, su = new_session(client, published_release, [CLOZE_UNIT, SINGLE_UNIT])
    for unit, q, o in ((CLOZE_UNIT, Q1, Q1 + "-o1"), (SINGLE_UNIT, QS, QS + "-o1"),
                       (CLOZE_UNIT, Q1, Q1 + "-o2")):  # change an answer: allowed
        v = client.get(f"/api/practice/sessions/{s['id']}/drafts",
                       headers=auth(USER_A)).json()["drafts"]
        ver = next((d["row_version"] for d in v if d["question_id"] == q), 0)
        r = client.put(f"/api/practice/sessions/{s['id']}/units/{su[unit]}/drafts",
                       json={"question_id": q, "chosen_option_id": o,
                             "expected_row_version": ver}, headers=auth(USER_A))
        assert r.status_code == 200
        assert "correct" not in r.text and "is_correct" not in r.text
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers") == 0
    assert count(pg_engine, "SELECT count(*) FROM study_results") == 0
    got = client.get(f"/api/practice/sessions/{s['id']}", headers=auth(USER_A)).json()
    assert got["state"] == "in_progress"
    assert [u["state"] for u in got["units"]] == ["pending", "pending"]
    # refresh restore: same unit order + the latest drafts, nothing leaked
    assert [u["unit_id"] for u in got["units"]] == [CLOZE_UNIT, SINGLE_UNIT]
    drafts = {d["question_id"]: d["chosen_option_id"] for d in client.get(
        f"/api/practice/sessions/{s['id']}/drafts",
        headers=auth(USER_A)).json()["drafts"]}
    assert drafts == {Q1: Q1 + "-o2", QS: QS + "-o1"}
    for su_id in su.values():  # sealed: no feedback, no transcript
        for ep in ("feedback", "transcript"):
            r = client.get(f"/api/practice/sessions/{s['id']}/units/{su_id}/{ep}",
                           headers=auth(USER_A))
            assert r.status_code == 409


@requires_db
def test_per_unit_submit_is_rejected_in_end_mode_but_fine_in_immediate(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s, su = new_session(client, published_release, [CLOZE_UNIT])
    r = client.post(f"/api/practice/sessions/{s['id']}/units/{su[CLOZE_UNIT]}/submit",
                    json={"answers": []}, headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "end_mode_requires_final_submit"
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers") == 0

    im, imu = new_session(client, published_release, [SINGLE_UNIT],
                          feedback="immediate")
    ok = client.post(f"/api/practice/sessions/{im['id']}/units/{imu[SINGLE_UNIT]}/submit",
                     json={"answers": [{"question_id": QS,
                                        "chosen_option_id": QS + "-o3"}]},
                     headers=auth(USER_A))
    assert ok.status_code == 200 and ok.json()["feedback"]["questions"][0]["is_correct"]
    # and the whole-session submit is not available to immediate sessions
    r = submit_all(client, im["id"], [])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "final_submit_end_mode_only"


@requires_db
def test_final_submit_judges_all_units_once_with_skip_and_wrong_counted_apart(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s, su = new_session(client, published_release, [CLOZE_UNIT, SINGLE_UNIT])
    # cloze: Q1 right, Q2 wrong; single question left unanswered
    r = submit_all(client, s["id"], [(su[CLOZE_UNIT], Q1, Q1 + "-o2"),
                                     (su[CLOZE_UNIT], Q2, Q2 + "-o2")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "completed" and body["idempotent"] is False
    res = body["results"]
    assert (res["correct_count"], res["wrong_count"], res["skipped_count"],
            res["total_count"]) == (1, 1, 1, 3)
    assert [u["state"] for u in body["units"]] == ["submitted", "submitted"]
    assert count(pg_engine,
                 "SELECT count(*) FROM study_submitted_answers") == 3
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers"
                 " WHERE chosen_option_id IS NULL AND is_correct IS NULL") == 1
    # results + feedback now open
    assert client.get(f"/api/practice/sessions/{s['id']}/results",
                      headers=auth(USER_A)).status_code == 200
    fb = client.get(f"/api/practice/sessions/{s['id']}/units/{su[CLOZE_UNIT]}/feedback",
                    headers=auth(USER_A)).json()
    assert {q["question_id"]: q["is_correct"] for q in fb["questions"]} == \
        {Q1: True, Q2: False}


@requires_db
def test_final_submit_is_idempotent_and_never_rewrites(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s, su = new_session(client, published_release, [CLOZE_UNIT])
    first = submit_all(client, s["id"], [(su[CLOZE_UNIT], Q1, Q1 + "-o2"),
                                         (su[CLOZE_UNIT], Q2, Q2 + "-o1")])
    # a retry (even carrying different answers) returns the stored outcome
    again = submit_all(client, s["id"], [(su[CLOZE_UNIT], Q1, Q1 + "-o1")])
    assert again.status_code == 200 and again.json()["idempotent"] is True
    assert again.json()["results"]["correct_count"] == \
        first.json()["results"]["correct_count"] == 2
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers") == 2
    assert count(pg_engine, "SELECT count(*) FROM study_results") == 1
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers"
                 " WHERE chosen_option_id = :o", o=Q1 + "-o2") == 1


@requires_db
def test_invalid_answer_rolls_the_whole_submission_back(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s, su = new_session(client, published_release, [CLOZE_UNIT, SINGLE_UNIT])
    bad = submit_all(client, s["id"], [(su[CLOZE_UNIT], Q1, Q1 + "-o2"),
                                       (su[SINGLE_UNIT], QS, "not-an-option")])
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid_option"
    unknown = submit_all(client, s["id"], [
        ("00000000-0000-0000-0000-000000000000", Q1, None)])
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "session_unit_not_in_session"
    # nothing half-written; session still open and editable
    assert count(pg_engine, "SELECT count(*) FROM study_submitted_answers") == 0
    assert count(pg_engine, "SELECT count(*) FROM study_results") == 0
    got = client.get(f"/api/practice/sessions/{s['id']}", headers=auth(USER_A)).json()
    assert got["state"] == "in_progress"
    assert [u["state"] for u in got["units"]] == ["pending", "pending"]
    # a corrected retry succeeds
    assert submit_all(client, s["id"], [(su[CLOZE_UNIT], Q1, Q1 + "-o2")]
                      ).status_code == 200


@requires_db
def test_final_submit_is_owner_only_and_isolated_between_sessions(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    a, sua = new_session(client, published_release, [CLOZE_UNIT])
    b, sub_ = new_session(client, published_release, [CLOZE_UNIT])
    assert submit_all(client, a["id"], [], user=USER_B).status_code == 404
    # another session's unit id is not accepted
    r = submit_all(client, a["id"], [(sub_[CLOZE_UNIT], Q1, Q1 + "-o2")])
    assert r.status_code == 422
    assert submit_all(client, a["id"], [(sua[CLOZE_UNIT], Q1, Q1 + "-o2")]
                      ).status_code == 200
    # b untouched
    gb = client.get(f"/api/practice/sessions/{b['id']}", headers=auth(USER_A)).json()
    assert gb["state"] == "in_progress" and gb["units"][0]["state"] == "pending"
    # an ended session cannot be submitted
    c, suc = new_session(client, published_release, [CLOZE_UNIT])
    client.post(f"/api/practice/sessions/{c['id']}/finish", headers=auth(USER_A))
    r = submit_all(client, c["id"], [(suc[CLOZE_UNIT], Q1, Q1 + "-o2")])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "session_not_active"
