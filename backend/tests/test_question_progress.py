"""user_question_progress cache + 专项「只复习最近仍错」.

The cache is derived from immutable submitted answers (business-rules):
attempt_count = answers with a chosen option; skip_count = formal
submissions with none; last_valid_result only follows real choices, so a
later skip never overwrites the last right/wrong. It must be rebuildable
and the incremental upkeep must agree with a full rebuild.

Fixture: one N5 exam; CLOZE_UNIT (Q1 correct -o2, Q2 correct -o1) and
SINGLE_UNIT (QS correct -o3).
"""
import os
import random

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT
from test_topic_practice import (QS, Q1, Q2, USER_A, USER_B, auth, create,
                                 make_client, submit, types)

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain (incl. the progress cache) around each test."""


def progress(pg_engine, user):
    with pg_engine.connect() as conn:
        rows = conn.execute(sa.text(
            "SELECT question_id, attempt_count, correct_count, wrong_count,"
            " skip_count, last_valid_result FROM user_question_progress"
            " WHERE user_id = :u ORDER BY question_id"), {"u": user}).all()
    return {r[0]: tuple(r[1:]) for r in rows}


def practice_unit(client, user, qtype, answers, feedback="immediate"):
    s = create(client, user, qtype=qtype, feedback=feedback).json()
    r = submit(client, user, s["id"], s["units"][0]["id"], answers)
    assert r.status_code == 200, r.text
    return s


@requires_db
def test_submit_maintains_progress_and_skip_never_overwrites(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    # Q1 right, Q2 wrong
    practice_unit(client, USER_A, "grammar_cloze",
                  [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o3")])
    assert progress(pg_engine, USER_A) == {
        Q1: (1, 1, 0, 0, True), Q2: (1, 0, 1, 0, False)}
    # second round: Q1 wrong, Q2 skipped
    practice_unit(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o3")])
    assert progress(pg_engine, USER_A) == {
        Q1: (2, 1, 1, 0, False),          # latest valid answer now wrong
        Q2: (1, 0, 1, 1, False)}          # skip counted, result untouched
    assert progress(pg_engine, USER_B) == {}


@requires_db
def test_unified_final_submit_also_updates_progress(
        pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = create(client, USER_A, feedback="end").json()
    suid = s["units"][0]["id"]
    r = client.post(f"/api/practice/sessions/{s['id']}/submit",
                    json={"answers": [
                        {"session_unit_id": suid, "question_id": Q1,
                         "chosen_option_id": Q1 + "-o3"},
                        {"session_unit_id": suid, "question_id": Q2,
                         "chosen_option_id": Q2 + "-o1"}]},
                    headers=auth(USER_A))
    assert r.status_code == 200, r.text
    assert progress(pg_engine, USER_A) == {
        Q1: (1, 0, 1, 0, False), Q2: (1, 1, 0, 0, True)}


@requires_db
def test_rebuild_equals_incremental(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    practice_unit(client, USER_A, "grammar_cloze",
                  [(Q1, Q1 + "-o3"), (Q2, Q2 + "-o1")])
    practice_unit(client, USER_A, "grammar_cloze", [(Q1, Q1 + "-o2")])
    practice_unit(client, USER_A, "vocabulary_kanji_reading",
                  [(QS, QS + "-o3")])
    live = progress(pg_engine, USER_A)
    assert len(live) == 3
    from app.question_progress import rebuild_user_progress
    with pg_engine.begin() as conn:
        conn.execute(sa.text("DELETE FROM user_question_progress"))
        assert rebuild_user_progress(conn, USER_A) == 3
        rebuild_user_progress(conn, USER_A)  # idempotent
    assert progress(pg_engine, USER_A) == live


@requires_db
def test_wrong_only_catalog_and_session(pg_engine, published_release,
                                        monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    t = types(client, USER_A)
    assert t["grammar_cloze"]["wrong_units"] == 0
    none = create_wrong(client, USER_A)
    assert none.status_code == 422
    assert none.json()["detail"]["code"] == "no_wrong_units"

    practice_unit(client, USER_A, "grammar_cloze",
                  [(Q1, Q1 + "-o3"), (Q2, Q2 + "-o1")])
    t = types(client, USER_A)
    assert t["grammar_cloze"]["wrong_units"] == 1
    assert t["vocabulary_kanji_reading"]["wrong_units"] == 0
    assert types(client, USER_B)["grammar_cloze"]["wrong_units"] == 0

    r = create_wrong(client, USER_A)
    assert r.status_code == 201, r.text
    s = r.json()
    assert [u["unit_id"] for u in s["units"]] == [CLOZE_UNIT]
    assert s["config"]["topic"]["selection"] == "wrong_only"
    assert "correct" not in r.text
    # over-asking is bounded by the wrong pool, not the whole type pool
    over = create_wrong(client, USER_A, count=2)
    assert over.json()["detail"]["code"] == "count_exceeds_available"
    assert over.json()["detail"]["available_units"] == 1

    # answer it right → no longer "still wrong"
    submit(client, USER_A, s["id"], s["units"][0]["id"],
           [(Q1, Q1 + "-o2"), (Q2, Q2 + "-o1")])
    assert types(client, USER_A)["grammar_cloze"]["wrong_units"] == 0
    assert create_wrong(client, USER_A).json()["detail"]["code"] \
        == "no_wrong_units"


@requires_db
def test_skip_does_not_make_a_unit_wrong_or_clear_it(pg_engine,
                                                     published_release,
                                                     monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    practice_unit(client, USER_A, "grammar_cloze",
                  [(Q1, Q1 + "-o3"), (Q2, Q2 + "-o1")])      # Q1 wrong
    practice_unit(client, USER_A, "grammar_cloze", [(Q2, Q2 + "-o1")])  # skip Q1
    assert types(client, USER_A)["grammar_cloze"]["wrong_units"] == 1


@requires_db
def test_default_selection_is_smart_and_recorded(pg_engine, published_release,
                                                 monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = create(client, USER_A)
    assert r.status_code == 201
    assert r.json()["config"]["topic"]["selection"] == "smart"


def create_wrong(client, user, qtype="grammar_cloze", count=1):
    return client.post("/api/topic-practice/sessions", json={
        "level": "N5", "question_type_id": qtype, "count": count,
        "feedback_mode": "immediate", "selection": "wrong_only"},
        headers=auth(user))


def test_select_wrong_units_is_pure_whole_unit_and_bounded():
    from app.topic_sampling import Candidate, select_wrong_units
    cands = [Candidate("r", f"u{i}", "e") for i in range(5)]
    wrong = {("r", "u0"): 3, ("r", "u1"): 1, ("r", "u2"): 1}
    picked = select_wrong_units(cands, wrong, 2, random.Random(1))
    assert len(picked) == 2 and len({c.unit_id for c in picked}) == 2
    assert {c.unit_id for c in picked} <= {"u0", "u1", "u2"}
    assert len(select_wrong_units(cands, wrong, 99, random.Random(1))) == 3
    assert select_wrong_units(cands, {}, 2, random.Random(1)) == []
