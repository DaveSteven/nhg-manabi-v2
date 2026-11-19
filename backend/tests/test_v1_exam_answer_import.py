"""V1 真题专项作答 -> formal v2 answers (ADR-0030): identity -> objectId ->
canonical mapping, partial group Units, hidden from 练习历史 but counted."""
import json
from datetime import datetime

import pytest
import sqlalchemy as sa

from conftest import CLOZE_UNIT, SINGLE_UNIT
from test_supplementary import requires_db
from test_topic_practice import USER_A, auth, make_client  # noqa: F401
from test_topic_practice import _study_isolation  # noqa: F401

V1_USER = "v1-exam-user"
Q1, Q2, QS = f"{CLOZE_UNIT}-q01", f"{CLOZE_UNIT}-q02", f"{SINGLE_UNIT}-q01"
# fixture keys: Q1 -> o2, Q2 -> o1, QS -> o3 (positions are 1-based)
T = datetime(2026, 11, 14, 9, 0, 0)


def opt(v1_q, order):          # V1 option id for (V1 question, source_order)
    return v1_q * 10 + order


ORDER = {opt(q, o): o for q in (11, 12, 14) for o in range(4)}


@pytest.fixture()
def v1_user(pg_engine, published_release):
    with pg_engine.begin() as c:
        c.execute(sa.text("DELETE FROM users WHERE id = :u"), {"u": USER_A})
        c.execute(sa.text(
            "INSERT INTO users (id, username, display_name, password_hash, activated_at,"
            " legacy_v1_user_id) VALUES (:u, 'v1exam', 'x', 'x', now(), :v)"),
            {"u": USER_A, "v": V1_USER})
    yield USER_A
    with pg_engine.begin() as c:
        c.execute(sa.text("DELETE FROM users WHERE id = :u"), {"u": USER_A})


def ans(i, attempt, v1q, chosen_order, key_order, ok, minute=0):
    return dict(id=i, attempt_id=attempt, user_id=V1_USER, question_id=v1q,
                chosen_option_id=None if chosen_order is None else opt(v1q, chosen_order),
                correct_option_id=opt(v1q, key_order), is_correct=ok,
                created_at=T.replace(minute=minute))


def attempts(n=1):
    return [dict(id=i, user_id=V1_USER, created_at=T.replace(day=14 + i),
                 duration_seconds=None) for i in range(1, n + 1)]


def raw_dir(tmp_path):
    (tmp_path / "N5" / "x").mkdir(parents=True, exist_ok=True)
    (tmp_path / "N5" / "x" / "exam.json").write_text(json.dumps({"layers": [{"items": [
        {"identity": ["ID-SINGLE"], "objectId": "src1"},
        {"identity": ["ID-CLOZE"], "objectId": "src2"}]}]}), encoding="utf-8")
    return tmp_path


@requires_db
def test_identity_chain_maps_answers_and_judges_by_v2_key(pg_engine, v1_user, tmp_path):
    from app.v1_answer_import import import_answers
    answers = [ans(1, 1, 11, 2, 2, 1),          # QS: chose o3 = key -> correct
               ans(2, 1, 12, 0, 1, 0, 1),       # Q1: chose o1, key o2 -> wrong
               ans(3, 1, 13, 0, 0, 1, 2)]       # identity not in v2 -> skipped
    ident = {11: json.dumps(["ID-SINGLE"]), 12: json.dumps(["ID-CLOZE"]),
             13: json.dumps(["ID-NOWHERE"])}
    run = lambda apply: import_answers(
        pg_engine, attempts(), answers, ORDER, apply, kind="exam",
        identities=ident, raw_dir=raw_dir(tmp_path), object_system="test")
    dry = run(False)
    assert dry["sessions_imported"] == 1 and dry["applied"] is False
    with pg_engine.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM study_sessions")).scalar_one() == 0
    rep = run(True)
    assert rep["answers_imported"] == 2 and rep["skipped_answers"] == {"no_v2_question": 1}
    assert rep["judgement_changed"] == 0
    assert run(True)["already_imported"] == 1
    with pg_engine.connect() as c:
        cfg, = c.execute(sa.text("SELECT config FROM study_sessions")).one()
        assert cfg["imported"] == {"source": "v1_practice", "attempt_id": 1}
        assert "supplementary" not in cfg and len(cfg["requested_units"]) == 2
        got = {r[0]: r[1] for r in c.execute(sa.text(
            "SELECT question_id, is_correct FROM study_submitted_answers"))}
        assert got == {QS: True, Q1: False}


@requires_db
def test_group_unit_answers_share_a_session_unit_and_never_fabricate_skips(
        pg_engine, v1_user):
    from app.v1_answer_import import import_answers
    mapped = {11: QS, 12: Q1, 14: Q2}
    # attempt 1 answers BOTH questions of the cloze unit; attempt 2 only Q1 of it
    answers = [ans(1, 1, 12, 1, 1, 1), ans(2, 1, 14, 0, 0, 1, 1),
               ans(3, 2, 12, 0, 1, 0)]
    rep = import_answers(pg_engine, attempts(2), answers, ORDER, True,
                         kind="exam", mapped=mapped)
    assert rep["sessions_imported"] == 2 and rep["answers_imported"] == 3
    with pg_engine.connect() as c:
        per_session = [tuple(r) for r in c.execute(sa.text(
            "SELECT count(DISTINCT su.id), count(sa.question_id) FROM study_sessions s"
            " JOIN study_session_units su ON su.session_id = s.id"
            " JOIN study_submitted_answers sa ON sa.session_unit_id = su.id"
            " GROUP BY s.id ORDER BY min(s.created_at)"))]
        assert per_session == [(1, 2), (1, 1)]     # no skip rows for the unanswered Q2
        assert c.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers WHERE chosen_option_id IS NULL")
        ).scalar_one() == 0


@requires_db
def test_imported_exam_answers_count_for_progress_but_not_history(
        pg_engine, v1_user, monkeypatch):
    from app.v1_answer_import import import_answers
    import_answers(pg_engine, attempts(), [ans(1, 1, 11, 0, 2, 0)], ORDER, True,
                   kind="exam", mapped={11: QS})
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/me/learning/history", headers=auth(USER_A)).json()["total"] == 0
    ov = client.get("/api/me/learning/overview?level=N5", headers=auth(USER_A)).json()
    assert ov["totals"]["completed_sessions"] == 0
    assert ov["totals"]["practiced_questions"] == 1 and ov["totals"]["still_wrong_questions"] == 1
    with pg_engine.connect() as c:
        sid = str(c.execute(sa.text("SELECT id FROM study_sessions")).scalar_one())
    # the stored session still renders a result without crashing
    r = client.get(f"/api/practice/sessions/{sid}/results", headers=auth(USER_A))
    assert r.status_code == 200, r.text


@requires_db
def test_snapshot_key_that_disagrees_with_v2_is_skipped(pg_engine, v1_user):
    from app.v1_answer_import import import_answers
    rep = import_answers(pg_engine, attempts(), [ans(1, 1, 11, 2, 1, 1)], ORDER, True,
                         kind="exam", mapped={11: QS})    # V1 thought the key was o2
    assert rep["skipped_answers"] == {"answer_key_differs": 1}
    assert rep["sessions_imported"] == 0
