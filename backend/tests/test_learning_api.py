"""我的学习 APIs: overview, 练习历史, 题目记录 (错题策略 B).

Source of truth = formal submitted answers via the user_question_progress
cache (drafts never count, skip != wrong). Own data only; never answers.

Fixture: one N5 exam, 3 questions (grammar_cloze Q1 -o2 / Q2 -o1, vocabulary
QS -o3). The exam is published, so the level has 3 practicable questions.
"""
import os

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT
from test_topic_practice import (Q1, Q2, QS, USER_A, USER_B, auth, create,
                                 make_client, submit)

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL")


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain (incl. the progress cache) around each test."""


def get(client, user, path, **params):
    r = client.get(f"/api/me/learning/{path}", params=params, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()


def practice(client, user, qtype, answers, feedback="immediate"):
    s = create(client, user, qtype=qtype, feedback=feedback).json()
    r = submit(client, user, s["id"], s["units"][0]["id"], answers)
    assert r.status_code == 200, r.text
    return s


def seed(client):
    """A: Q1 right, Q2 wrong, QS skipped → then Q1 wrong again later."""
    practice(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o3")])
    practice(client, USER_A, "vocabulary_kanji_reading", [])           # QS skipped


@requires_db
def test_endpoints_require_auth(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    for p in ("overview", "history", "questions"):
        assert client.get(f"/api/me/learning/{p}").status_code == 401


@requires_db
def test_overview_for_a_new_user_is_zero_not_fake(pg_engine, published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    o = get(client, USER_A, "overview", level="N5")
    assert o["totals"] == {"attempts": 0, "correct": 0, "wrong": 0,
                           "skipped": 0, "answered_accuracy": None,
                           "practiced_questions": 0, "still_wrong_questions": 0,
                           "completed_sessions": 0, "last_practiced_at": None}
    assert o["coverage"] == {"practiced_questions": 0, "total_questions": 3,
                             "ratio": 0.0}
    assert o["weak_types"] == []


@requires_db
def test_overview_counts_accuracy_coverage_and_skip_semantics(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    seed(client)
    o = get(client, USER_A, "overview", level="N5")
    t = o["totals"]
    assert (t["attempts"], t["correct"], t["wrong"], t["skipped"]) == (2, 1, 1, 1)
    assert t["answered_accuracy"] == 0.5            # skip not in denominator
    assert t["practiced_questions"] == 2            # QS only skipped → not practiced
    assert t["still_wrong_questions"] == 1
    assert t["completed_sessions"] == 0             # immediate sessions not finished
    assert t["last_practiced_at"] is not None
    assert o["coverage"] == {"practiced_questions": 2, "total_questions": 3,
                             "ratio": pytest.approx(2 / 3)}
    subj = {s["subject"]: s for s in o["by_subject"]}
    assert subj["grammar"]["attempts"] == 2 and subj["grammar"]["wrong"] == 1
    assert subj["vocabulary"]["attempts"] == 0
    assert subj["vocabulary"]["accuracy"] is None   # "—", never 0%
    assert "correct_option" not in str(o) and "explanation" not in str(o)
    # other user / other level see nothing
    assert get(client, USER_B, "overview", level="N5")["totals"]["attempts"] == 0
    assert get(client, USER_A, "overview", level="N1")["totals"]["attempts"] == 0


@requires_db
def test_weak_types_need_enough_samples(pg_engine, published_release,
                                        monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    seed(client)
    assert get(client, USER_A, "overview", level="N5")["weak_types"] == []
    import app.api.learning as learning
    monkeypatch.setattr(learning, "MIN_WEAK_SAMPLE", 2)
    weak = get(client, USER_A, "overview", level="N5")["weak_types"]
    assert [w["question_type_id"] for w in weak] == ["grammar_cloze"]
    assert weak[0]["accuracy"] == 0.5 and weak[0]["still_wrong"] == 1


@requires_db
def test_history_lists_finished_sessions_with_real_counts(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    # unified feedback, finished as a whole → completed with a result page
    s = create(client, USER_A, feedback="end").json()
    suid = s["units"][0]["id"]
    done = client.post(f"/api/practice/sessions/{s['id']}/submit", json={
        "answers": [{"session_unit_id": suid, "question_id": Q1,
                     "chosen_option_id": Q1 + "-o2"}]}, headers=auth(USER_A))
    assert done.status_code == 200, done.text
    # a replaced session without any formal answer must not appear
    create(client, USER_A, qtype="vocabulary_kanji_reading")
    h = get(client, USER_A, "history")
    assert h["total"] == 1
    row = h["items"][0]
    assert row["session_id"] == s["id"] and row["state"] == "completed"
    assert row["has_result"] is True and row["mode"] == "practice"
    assert (row["correct"], row["wrong"], row["skipped"], row["total"]) == (1, 0, 1, 2)
    assert row["source"]["kind"] == "topic"
    assert row["source"]["label"] == "文法填空"
    assert get(client, USER_B, "history")["total"] == 0


@requires_db
def test_history_pagination_and_ended_early_has_no_result(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = practice(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o2")])
    fin = client.post(f"/api/practice/sessions/{s['id']}/finish", headers=auth(USER_A))
    assert fin.status_code == 200, fin.text
    h = get(client, USER_A, "history", limit=1, offset=0)
    assert h["total"] == 1 and len(h["items"]) == 1
    assert get(client, USER_A, "history", limit=1, offset=1)["items"] == []
    assert h["items"][0]["state"] in ("completed", "ended_early")


@requires_db
def test_question_records_follow_strategy_b(pg_engine, published_release,
                                            monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    seed(client)                                     # Q2 wrong; Q1 right; QS skip
    ever = get(client, USER_A, "questions", filter="ever_wrong")
    assert [i["question_id"] for i in ever["items"]] == [Q2]
    assert ever["total"] == 1
    still = get(client, USER_A, "questions", filter="still_wrong")
    assert [i["question_id"] for i in still["items"]] == [Q2]
    assert get(client, USER_A, "questions", filter="recovered")["items"] == []

    # answer Q2 right next time → recovered, no longer still wrong
    practice(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    assert get(client, USER_A, "questions", filter="still_wrong")["items"] == []
    rec = get(client, USER_A, "questions", filter="recovered")["items"]
    assert [i["question_id"] for i in rec] == [Q2]
    assert get(client, USER_A, "questions", filter="ever_wrong")["total"] == 1

    # a later skip changes neither list
    practice(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o2")])
    assert [i["question_id"] for i in
            get(client, USER_A, "questions", filter="recovered")["items"]] == [Q2]


@requires_db
def test_question_row_shape_filters_and_no_answer_leak(pg_engine,
                                                       published_release,
                                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    seed(client)
    r = get(client, USER_A, "questions", filter="ever_wrong", level="N5",
            subject="grammar")
    item = r["items"][0]
    assert item["exam_id"] == "JLPTGO-N5-TEST-EX"
    assert item["release_id"] == str(published_release)
    assert item["unit_id"] == CLOZE_UNIT and item["level"] == "N5"
    assert item["subject"] == "grammar"
    assert item["question_type_id"] == "grammar_cloze"
    assert (item["attempt_count"], item["wrong_count"]) == (1, 1)
    assert item["last_result"] == "wrong"
    banned = {"correct_option_id", "explanation", "chosen_option_id", "prompt"}
    assert not banned & set(item)
    assert get(client, USER_A, "questions", filter="ever_wrong",
               subject="vocabulary")["items"] == []
    assert get(client, USER_A, "questions", filter="ever_wrong",
               level="N1")["items"] == []
    assert get(client, USER_B, "questions", filter="ever_wrong")["items"] == []
    bad = client.get("/api/me/learning/questions?filter=nope",
                     headers=auth(USER_A))
    assert bad.status_code == 422
