"""V1 textbook answers -> formal v2 answers (ADR-0030)."""
from datetime import datetime

import pytest
import sqlalchemy as sa

from test_supplementary import SUP_EXAM, requires_db, sup_published  # noqa: F401
from test_topic_practice import USER_A, auth, make_client  # noqa: F401
from test_topic_practice import _study_isolation  # noqa: F401

V1_USER = "v1-user-1"
# V1 option ids: question 1 -> 101..104, question 2 -> 201..204, q4 (3 opts) -> 401..403
ORDER = {**{100 + i + 1: i for i in range(4)}, **{200 + i + 1: i for i in range(4)},
         **{400 + i + 1: i for i in range(3)}, **{900 + i + 1: i for i in range(4)}}
T = datetime(2026, 11, 15, 10, 0, 0)


@pytest.fixture()
def v1_user(pg_engine, sup_published):  # noqa: F811
    with pg_engine.begin() as c:
        c.execute(sa.text("DELETE FROM users WHERE id = :u OR legacy_v1_user_id = :v"),
                  {"u": USER_A, "v": V1_USER})
        c.execute(sa.text(
            "INSERT INTO users (id, username, display_name, password_hash, activated_at,"
            " legacy_v1_user_id) VALUES (:u, 'v1user', 'x', 'x', now(), :v)"),
            {"u": USER_A, "v": V1_USER})
    yield USER_A
    with pg_engine.begin() as c:
        c.execute(sa.text("DELETE FROM users WHERE id = :u"), {"u": USER_A})


def ans(i, attempt, q, chosen, correct, ok, minutes=0):
    return dict(id=i, attempt_id=attempt, user_id=V1_USER, question_id=q,
                chosen_option_id=chosen, correct_option_id=correct, is_correct=ok,
                created_at=T.replace(minute=minutes))


def attempts():
    return [dict(id=1, user_id=V1_USER, created_at=T, duration_seconds=60),
            dict(id=2, user_id=V1_USER, created_at=T.replace(day=16), duration_seconds=None),
            dict(id=3, user_id="someone-not-imported", created_at=T, duration_seconds=None),
            dict(id=4, user_id=V1_USER, created_at=T.replace(day=17), duration_seconds=None)]


def answers():
    return [
        ans(1, 1, 1, 101, 101, 1),        # q1 right
        ans(2, 1, 2, 202, 201, 0, 1),     # q2 wrong
        ans(3, 1, 4, 401, 401, 1, 2),     # q4: unit needs_review -> skipped
        ans(4, 1, 9, 901, 901, 1, 3),     # unmapped V1 question -> skipped
        ans(5, 2, 1, None, 101, 0, 4),    # q1 skipped (no choice)
        ans(6, 2, 2, 201, 202, 1, 5),     # snapshot key (202) differs from v2 key (201) -> skipped
        ans(7, 3, 1, 101, 101, 1),        # belongs to a user that is not imported
        ans(8, 4, 1, 102, 101, 1, 6),     # V1 said correct, but chosen 102 is wrong -> re-judged wrong
    ]


def run(engine, apply):
    from app.v1_answer_import import import_answers
    return import_answers(engine, attempts(), answers(), ORDER, apply)


@requires_db
def test_dry_run_writes_nothing_then_apply_imports_formal_answers(pg_engine, v1_user):
    dry = run(pg_engine, apply=False)
    assert dry["applied"] is False and dry["sessions_imported"] == 3
    with pg_engine.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM study_sessions")).scalar_one() == 0

    rep = run(pg_engine, apply=True)
    assert rep["sessions_imported"] == 3 and rep["answers_imported"] == 4  # a1,a2 | a5 | a8
    assert rep["skipped_answers"] == {"unit_not_practicable": 1, "no_v2_question": 1,
                                      "answer_key_differs": 1}
    assert rep["skipped_attempts"] == {"user_not_imported": 1}
    assert rep["judgement_changed"] == 1 and rep["users"] == 1
    with pg_engine.connect() as c:
        rows = c.execute(sa.text(
            "SELECT s.state, s.mode, s.config -> 'supplementary' ->> 'imported_from',"
            " res.correct_count, res.wrong_count, res.skipped_count, res.total_count"
            " FROM study_sessions s JOIN study_results res ON res.session_id = s.id"
            " ORDER BY s.created_at")).all()
        assert [tuple(r) for r in rows] == [
            ("completed", "practice", "v1", 1, 1, 0, 2),
            ("completed", "practice", "v1", 0, 0, 1, 1),
            ("completed", "practice", "v1", 0, 1, 0, 1)]
        subs = c.execute(sa.text(
            "SELECT question_id, chosen_option_id IS NULL, is_correct, submitted_at"
            " FROM study_submitted_answers ORDER BY submitted_at")).all()
        assert subs[0][2] is True and subs[1][2] is False
        assert subs[2][1] is True and subs[2][2] is None           # skip stays NULL, not wrong
        assert subs[3][2] is False                                  # re-judged by v2's key
        assert subs[0][3].isoformat().startswith("2026-11-15T10:00")
        prog = sorted(tuple(r) for r in c.execute(sa.text(
            "SELECT attempt_count, correct_count, wrong_count, skip_count, last_valid_result"
            " FROM user_question_progress WHERE user_id = :u"), {"u": USER_A}))
        # q2: one wrong answer; q1: right, skipped, then wrong (latest) -> 2 attempts,
        # 1 right, 1 wrong, 1 skip, latest result wrong
        assert prog == [(1, 0, 1, 0, False), (2, 1, 1, 1, False)]


@requires_db
def test_import_is_idempotent_and_survives_later_progress_refresh(pg_engine, v1_user):
    run(pg_engine, apply=True)
    again = run(pg_engine, apply=True)
    assert again["sessions_imported"] == 0 and again["already_imported"] == 3
    from app.question_progress import rebuild_user_progress
    with pg_engine.begin() as c:
        before = c.execute(sa.text(
            "SELECT count(*), sum(attempt_count) FROM user_question_progress")).one()
        rebuild_user_progress(c, USER_A)       # what every later submit effectively does
        after = c.execute(sa.text(
            "SELECT count(*), sum(attempt_count) FROM user_question_progress")).one()
    assert tuple(before) == tuple(after) == (2, 3)


@requires_db
def test_imported_lessons_show_progress_but_not_in_my_learning(pg_engine, v1_user, monkeypatch):
    run(pg_engine, apply=True)
    client = make_client(monkeypatch, pg_engine)
    (lesson,) = client.get("/api/supplementary/lessons?level=N3",
                           headers=auth(USER_A)).json()["subjects"][0]["lessons"]
    assert (lesson["answered"], lesson["correct"], lesson["wrong"]) == (2, 0, 2)
    assert client.get("/api/me/learning/history", headers=auth(USER_A)).json()["total"] == 0
    ov = client.get("/api/me/learning/overview?level=N3", headers=auth(USER_A)).json()
    assert ov["totals"]["completed_sessions"] == 0


@requires_db
def test_reused_v1_attempt_id_with_other_timestamp_is_a_new_attempt(pg_engine, v1_user):
    """V1 was restored from an older backup, so its attempt ids were handed
    out again for different attempts. Dedupe by (id, created_at), not id."""
    from app.v1_answer_import import import_answers
    run(pg_engine, apply=True)                       # attempts 1, 2, 4 imported
    reused = [dict(id=1, user_id=V1_USER, created_at=T.replace(day=25),
                   duration_seconds=None)]          # id 1 again, a different day
    more = [ans(20, 1, 1, 101, 101, 1, 7)]
    rep = import_answers(pg_engine, reused, more, ORDER, apply=True)
    assert rep["sessions_imported"] == 1 and rep["already_imported"] == 0
    again = import_answers(pg_engine, reused, more, ORDER, apply=True)
    assert again["sessions_imported"] == 0 and again["already_imported"] == 1


@requires_db
def test_users_matched_by_username_when_v1_ids_differ(pg_engine, v1_user):
    from app.v1_answer_import import import_answers
    rebuilt = [dict(id=1, user_id="rebuilt-id-1", created_at=T, duration_seconds=None)]
    rows = [ans(1, 1, 1, 101, 101, 1)]
    rows[0]["user_id"] = "rebuilt-id-1"
    none = import_answers(pg_engine, rebuilt, rows, ORDER, apply=False)
    assert none["skipped_attempts"] == {"user_not_imported": 1}
    rep = import_answers(pg_engine, rebuilt, rows, ORDER, apply=True,
                         v1_usernames={"rebuilt-id-1": "v1user",
                                       "other": "someone-else"})
    assert rep["sessions_imported"] == 1 and rep["users"] == 1


def test_filter_since_keeps_later_attempts_and_their_answers():
    from app.v1_answer_import import filter_since
    at, an = filter_since(attempts(), answers(), "2026-11-16T00:00:00")
    assert [a["id"] for a in at] == [2, 4]
    assert {a["attempt_id"] for a in an} == {2, 4}
