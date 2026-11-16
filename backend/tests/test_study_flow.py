"""M2 Tasks 05-08 tests: drafts, unit submission, feedback gate, results.

The fixture release mirrors the N2 grammar shape in miniature: the cloze
unit (JLPTGO-N5-TEST-EX-ly-01-u01) is a 2-question slot-bound group, so the
atomicity tests exercise "submit the whole group or nothing" end to end.
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
Q3 = f"{SINGLE_UNIT}-q01"  # correct: -o3


@pytest.fixture(autouse=True)
def _study_isolation(clean_study):
    """Wipe the study domain around each test (shared conftest fixture)."""


def make_client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", f"{USER_A},{USER_B}")
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {user_id}"}


def create_session(client, user_id, release_id, unit_ids, feedback="immediate"):
    resp = client.post(
        "/api/practice/sessions", json={
            "feedback_mode": feedback,
            "units": [{"release_id": str(release_id), "unit_id": u}
                      for u in unit_ids],
        }, headers=auth(user_id))
    assert resp.status_code == 201, resp.text
    return resp.json()


def unit_id_map(session: dict) -> dict:
    return {u["unit_id"]: u["id"] for u in session["units"]}


def options_of(pg_engine, question_id: str) -> list[str]:
    with pg_engine.connect() as conn:
        rows = conn.execute(sa.text(
            "SELECT option_id FROM release_options"
            " WHERE question_id = :q ORDER BY position"),
            {"q": question_id}).scalars().all()
    return [str(o) for o in rows]


def put_draft(client, user, sid, suid, qid, chosen, version):
    return client.put(
        f"/api/practice/sessions/{sid}/units/{suid}/drafts",
        json={"question_id": qid, "chosen_option_id": chosen,
              "expected_row_version": version},
        headers=auth(user))


def submit(client, user, sid, suid, answers):
    return client.post(
        f"/api/practice/sessions/{sid}/units/{suid}/submit",
        json={"answers": [{"question_id": q, "chosen_option_id": c}
                          for q, c in answers]},
        headers=auth(user))


# ------------------------------------------------------- Task 05: drafts ----

@requires_db
def test_draft_save_modify_restore_conflict_clear(pg_engine, published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]

    r = put_draft(client, USER_A, session["id"], suid, Q1,
                  f"{Q1}-o1", 0)
    assert r.status_code == 200 and r.json()["row_version"] == 1

    r = put_draft(client, USER_A, session["id"], suid, Q1,
                  f"{Q1}-o2", 1)
    assert r.status_code == 200 and r.json()["row_version"] == 2

    drafts = client.get(f"/api/practice/sessions/{session['id']}/drafts",
                        headers=auth(USER_A)).json()["drafts"]
    assert len(drafts) == 1
    assert drafts[0]["question_id"] == Q1
    assert drafts[0]["chosen_option_id"] == f"{Q1}-o2"
    assert drafts[0]["row_version"] == 2

    stale = put_draft(client, USER_A, session["id"], suid, Q1,
                      f"{Q1}-o3", 1)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "draft_version_conflict"
    assert stale.json()["detail"]["current_row_version"] == 2

    clear = put_draft(client, USER_A, session["id"], suid, Q1, None, 2)
    assert clear.status_code == 200 and clear.json()["row_version"] == 3
    drafts = client.get(f"/api/practice/sessions/{session['id']}/drafts",
                        headers=auth(USER_A)).json()["drafts"]
    assert drafts[0]["chosen_option_id"] is None


@requires_db
def test_draft_rejects_foreign_option_and_question(pg_engine,
                                                   published_release,
                                                   monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]

    # An option that exists in the release but belongs to another question.
    foreign = f"{SINGLE_UNIT}-q01-o3"
    r = put_draft(client, USER_A, session["id"], suid, Q1, foreign, 0)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_option"

    r = put_draft(client, USER_A, session["id"], suid, "NO-SUCH-Q",
                  f"{Q1}-o1", 0)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "question_not_in_unit"


@requires_db
def test_draft_locked_after_submit_and_cross_user(pg_engine,
                                                  published_release,
                                                  monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT])
    suids = unit_id_map(session)
    submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
           [(Q1, f"{Q1}-o2")])

    r = put_draft(client, USER_A, session["id"], suids[CLOZE_UNIT], Q2,
                  f"{Q2}-o1", 0)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_locked"

    assert put_draft(client, USER_B, session["id"], suids[SINGLE_UNIT],
                     Q3, f"{Q3}-o1", 0).status_code == 404
    assert client.get(f"/api/practice/sessions/{session['id']}/drafts",
                      headers=auth(USER_B)).status_code == 404


# ------------------------------------------------------ Task 06: submit ----

@requires_db
def test_submit_group_atomically_with_immediate_feedback(
        pg_engine, published_release, monkeypatch):
    """The N2-grammar analogue: the 2-slot cloze group submits as one unit."""
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]

    # Drafts saved before submitting must not interfere with judging.
    put_draft(client, USER_A, session["id"], suid, Q1, f"{Q1}-o3", 0)

    r = submit(client, USER_A, session["id"], suid,
               [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o1")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "submitted"
    assert body["answered_count"] == 2 and body["skipped_count"] == 0
    assert body["idempotent"] is False
    fb = body["feedback"]
    assert {q["question_id"]: q["is_correct"] for q in fb["questions"]} == {
        Q1: True, Q2: True}
    assert all(q["correct_option_id"] for q in fb["questions"])
    assert fb["unit_explanations"], "unit-level explanation should be served"

    with pg_engine.connect() as conn:
        n, unit_state = conn.execute(sa.text(
            "SELECT (SELECT count(*) FROM study_submitted_answers"
            "        WHERE session_unit_id = :u), state"
            " FROM study_session_units WHERE id = :u"), {"u": suid}).first()
    assert n == 2 and unit_state == "submitted"


@requires_db
def test_submit_skip_is_not_wrong(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]

    r = submit(client, USER_A, session["id"], suid, [(Q1, f"{Q1}-o2")])
    assert r.status_code == 200
    assert r.json()["answered_count"] == 1
    assert r.json()["skipped_count"] == 1
    fb = {q["question_id"]: q for q in r.json()["feedback"]["questions"]}
    assert fb[Q2]["skipped"] is True and fb[Q2]["is_correct"] is None
    assert fb[Q1]["skipped"] is False and fb[Q1]["is_correct"] is True

    with pg_engine.connect() as conn:
        row = conn.execute(sa.text(
            "SELECT chosen_option_id, is_correct FROM study_submitted_answers"
            " WHERE session_unit_id = :u AND question_id = :q"),
            {"u": suid, "q": Q2}).first()
    assert row.chosen_option_id is None and row.is_correct is None


@requires_db
def test_submit_wrong_answer_judged_false(pg_engine, published_release,
                                          monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [SINGLE_UNIT])
    suid = unit_id_map(session)[SINGLE_UNIT]
    r = submit(client, USER_A, session["id"], suid, [(Q3, f"{Q3}-o1")])
    assert r.status_code == 200
    fb = r.json()["feedback"]["questions"][0]
    assert fb["is_correct"] is False
    assert fb["chosen_option_id"] == f"{Q3}-o1"
    assert fb["correct_option_id"] == f"{Q3}-o3"


@requires_db
def test_submit_is_atomic_on_invalid_option(pg_engine, published_release,
                                            monkeypatch):
    """A bad option in question 2 must roll back question 1 too: the group
    either lands completely or not at all, and the unit stays retryable."""
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]

    r = submit(client, USER_A, session["id"], suid,
               [(Q1, f"{Q1}-o2"), (Q2, f"{SINGLE_UNIT}-q01-o3")])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_option"

    with pg_engine.connect() as conn:
        n, unit_state = conn.execute(sa.text(
            "SELECT (SELECT count(*) FROM study_submitted_answers"
            "        WHERE session_unit_id = :u), state"
            " FROM study_session_units WHERE id = :u"), {"u": suid}).first()
    assert n == 0 and unit_state == "pending"

    retry = submit(client, USER_A, session["id"], suid,
                   [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o1")])
    assert retry.status_code == 200 and retry.json()["idempotent"] is False


@requires_db
def test_submit_idempotent_no_duplicate_rows(pg_engine, published_release,
                                             monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release, [CLOZE_UNIT])
    suid = unit_id_map(session)[CLOZE_UNIT]
    answers = [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o1")]

    first = submit(client, USER_A, session["id"], suid, answers)
    assert first.status_code == 200 and first.json()["idempotent"] is False
    second = submit(client, USER_A, session["id"], suid, answers)
    assert second.status_code == 200 and second.json()["idempotent"] is True
    assert second.json()["answered_count"] == first.json()["answered_count"]

    # A different-looking retry against the same submitted unit is also
    # idempotent: stored answers win, nothing new is written.
    third = submit(client, USER_A, session["id"], suid, [(Q1, f"{Q1}-o1")])
    assert third.status_code == 200 and third.json()["idempotent"] is True

    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers"
            " WHERE session_unit_id = :u"), {"u": suid}).scalar()
    assert n == 2


@requires_db
def test_submit_validation_and_locking(pg_engine, published_release,
                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT])
    suids = unit_id_map(session)

    r = submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
               [("NO-SUCH-Q", f"{Q1}-o1")])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "question_not_in_unit"

    dup = client.post(
        f"/api/practice/sessions/{session['id']}/units/{suids[CLOZE_UNIT]}/submit",
        json={"answers": [{"question_id": Q1, "chosen_option_id": f"{Q1}-o1"},
                          {"question_id": Q1, "chosen_option_id": f"{Q1}-o2"}]},
        headers=auth(USER_A))
    assert dup.status_code == 422

    assert submit(client, USER_B, session["id"], suids[CLOZE_UNIT],
                  []).status_code == 404

    # Finish early (no units submitted) locks the whole session.
    fin = client.post(f"/api/practice/sessions/{session['id']}/finish",
                      headers=auth(USER_A))
    assert fin.status_code == 200
    assert fin.json()["state"] == "ended_early"
    r = submit(client, USER_A, session["id"], suids[SINGLE_UNIT], [])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "session_not_active"


# ----------------------------------------------------- Task 07: feedback ----

@requires_db
def test_feedback_immediate_mode_gate(pg_engine, published_release,
                                      monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT], feedback="immediate")
    suids = unit_id_map(session)
    fb_path = f"/api/practice/sessions/{session['id']}/units"

    # Before submission: sealed, even in immediate mode.
    r = client.get(f"{fb_path}/{suids[CLOZE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_not_submitted"

    submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
           [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o1")])
    r = client.get(f"{fb_path}/{suids[CLOZE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 200
    payload = r.json()
    assert payload["feedback_mode"] == "immediate"
    flat = str(payload)
    assert "correct_option_id" in flat  # submitted unit is now revealed

    # The OTHER unit was not submitted: its answers stay sealed.
    r = client.get(f"{fb_path}/{suids[SINGLE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "unit_not_submitted"

    assert client.get(f"{fb_path}/{suids[CLOZE_UNIT]}/feedback",
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_feedback_end_mode_sealed_until_session_ends(pg_engine,
                                                     published_release,
                                                     monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT], feedback="end")
    suids = unit_id_map(session)
    fb_path = f"/api/practice/sessions/{session['id']}/units"

    r = submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
               [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o1")])
    assert r.status_code == 200
    body = r.json()
    assert "feedback" not in body
    flat = str(body)
    assert "correct_option_id" not in flat and "is_correct" not in flat, \
        "end mode must not leak correctness before the session ends"

    r = client.get(f"{fb_path}/{suids[CLOZE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "feedback_locked_until_end"

    # Ending the session early (unit 2 pending) unlocks submitted-unit
    # feedback but still produces no aggregate result.
    fin = client.post(f"/api/practice/sessions/{session['id']}/finish",
                      headers=auth(USER_A))
    assert fin.json()["state"] == "ended_early"
    assert "results" not in fin.json()

    r = client.get(f"{fb_path}/{suids[CLOZE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 200
    assert {q["question_id"]: q["is_correct"]
            for q in r.json()["questions"]} == {Q1: True, Q2: True}
    r = client.get(f"{fb_path}/{suids[SINGLE_UNIT]}/feedback",
                   headers=auth(USER_A))
    assert r.status_code == 409  # never submitted -> stays sealed


# ------------------------------------------------------ Task 08: results ----

@requires_db
def test_completed_session_results(pg_engine, published_release, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT])
    suids = unit_id_map(session)
    submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
           [(Q1, f"{Q1}-o2"), (Q2, f"{Q2}-o2")])  # correct + wrong
    submit(client, USER_A, session["id"], suids[SINGLE_UNIT], [])  # all skip

    fin = client.post(f"/api/practice/sessions/{session['id']}/finish",
                      headers=auth(USER_A))
    assert fin.status_code == 200
    body = fin.json()
    assert body["state"] == "completed"
    res = body["results"]
    assert res["correct_count"] == 1
    assert res["wrong_count"] == 1
    assert res["skipped_count"] == 1
    assert res["total_count"] == 3
    assert res["correct_count"] + res["wrong_count"] + res["skipped_count"] \
        == res["total_count"]
    assert res["score_rate"] == round(1 / 3, 4)
    assert res["answered_accuracy"] == 0.5
    by_q = {q["question_id"]: q for q in res["questions"]}
    assert by_q[Q1]["is_correct"] is True
    assert by_q[Q2]["is_correct"] is False
    assert by_q[Q3]["skipped"] is True and by_q[Q3]["is_correct"] is None

    # Idempotent: re-finishing returns the same stored result, one row only.
    again = client.post(f"/api/practice/sessions/{session['id']}/finish",
                        headers=auth(USER_A))
    assert again.json()["idempotent"] is True
    assert again.json()["results"]["total_count"] == 3
    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_results WHERE session_id = :s"),
            {"s": session["id"]}).scalar()
    assert n == 1

    got = client.get(f"/api/practice/sessions/{session['id']}/results",
                     headers=auth(USER_A))
    assert got.status_code == 200
    assert got.json()["total_count"] == 3
    assert client.get(f"/api/practice/sessions/{session['id']}/results",
                      headers=auth(USER_B)).status_code == 404


@requires_db
def test_early_end_produces_no_results(pg_engine, published_release,
                                       monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    session = create_session(client, USER_A, published_release,
                             [CLOZE_UNIT, SINGLE_UNIT])
    suids = unit_id_map(session)
    submit(client, USER_A, session["id"], suids[CLOZE_UNIT],
           [(Q1, f"{Q1}-o1")])  # wrong, but a real answer

    fin = client.post(f"/api/practice/sessions/{session['id']}/finish",
                      headers=auth(USER_A))
    assert fin.status_code == 200
    assert fin.json()["state"] == "ended_early"
    assert "results" not in fin.json()

    with pg_engine.connect() as conn:
        n = conn.execute(sa.text(
            "SELECT count(*) FROM study_results WHERE session_id = :s"),
            {"s": session["id"]}).scalar()
        kept = conn.execute(sa.text(
            "SELECT count(*) FROM study_submitted_answers sa"
            " JOIN study_session_units su ON su.id = sa.session_unit_id"
            " WHERE su.session_id = :s"), {"s": session["id"]}).scalar()
    assert n == 0, "early end must not fabricate a full-exam score"
    assert kept == 2, "already-submitted answers are preserved"

    r = client.get(f"/api/practice/sessions/{session['id']}/results",
                   headers=auth(USER_A))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "no_results_early_end"

    # Ending the active slot is freed: a new session can start.
    nxt = create_session(client, USER_A, published_release, [SINGLE_UNIT])
    assert nxt["state"] == "in_progress"
