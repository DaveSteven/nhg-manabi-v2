"""扩展练习 API (ADR-0030): lesson catalog, starting a lesson, and isolation
from 我的学习 statistics."""
import sqlalchemy as sa

from test_supplementary import SUP_EXAM, requires_db, sup_published  # noqa: F401
from test_topic_practice import USER_A, auth, make_client  # noqa: F401
from test_topic_practice import _study_isolation  # noqa: F401  (autouse wipe)


def lessons(client, level="N3", user=USER_A):
    r = client.get(f"/api/supplementary/lessons?level={level}", headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()


@requires_db
def test_requires_authentication(pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    assert client.get("/api/supplementary/lessons?level=N3").status_code == 401
    assert client.post("/api/supplementary/sessions", json={
        "exam_id": SUP_EXAM, "feedback_mode": "immediate"}).status_code == 401


@requires_db
def test_lesson_catalog_counts_only_practicable_questions(pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    body = lessons(client)
    assert body["level"] == "N3"
    (kanji,) = [s for s in body["subjects"] if s["subject"] == "kanji"]
    assert kanji["label_zh"] == "汉字"
    (lesson,) = kanji["lessons"]
    assert lesson["exam_id"] == SUP_EXAM and lesson["lesson"] == 13
    # fixture lesson: 2 complete units + 1 needs_review unit (hidden)
    assert lesson["question_count"] == 2
    assert (lesson["answered"], lesson["correct"], lesson["wrong"]) == (0, 0, 0)
    assert lessons(client, level="N2")["subjects"] == []
    assert client.get("/api/supplementary/lessons?level=N9", headers=auth(USER_A)).status_code == 422


@requires_db
def test_lesson_progress_reflects_the_users_formal_answers(pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    with pg_engine.begin() as c:
        qids = [r[0] for r in c.execute(sa.text(
            "SELECT q.question_id FROM release_questions q JOIN exam_releases r ON r.id = q.release_id"
            " JOIN release_units u ON u.release_id = q.release_id AND u.unit_id = q.unit_id"
            " WHERE r.exam_id = :e AND u.conversion_status = 'complete' ORDER BY q.question_id"),
            {"e": SUP_EXAM})]
        for qid, ok in zip(qids, (True, False)):
            c.execute(sa.text(
                "INSERT INTO user_question_progress (user_id, question_id, attempt_count,"
                " correct_count, wrong_count, last_valid_result, last_answered_at)"
                " VALUES (:u, :q, 1, :c, :w, :ok, now())"),
                {"u": USER_A, "q": qid, "c": int(ok), "w": int(not ok), "ok": ok})
    (lesson,) = lessons(client)["subjects"][0]["lessons"]
    assert (lesson["answered"], lesson["correct"], lesson["wrong"]) == (2, 1, 1)


@requires_db
def test_start_lesson_creates_practice_session_with_all_practicable_units(
        pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    r = client.post("/api/supplementary/sessions", headers=auth(USER_A),
                    json={"exam_id": SUP_EXAM, "feedback_mode": "immediate"})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["mode"] == "practice" and s["feedback_mode"] == "immediate"
    assert len(s["units"]) == 2 and [u["position"] for u in s["units"]] == [1, 2]
    assert s["config"]["supplementary"] == {
        "kind": "supplementary", "exam_id": SUP_EXAM, "level": "N3",
        "subject": "kanji", "lesson": 13}
    assert "topic" not in s["config"]
    # starting again replaces the in-progress practice (ADR-0016), no conflict
    r2 = client.post("/api/supplementary/sessions", headers=auth(USER_A),
                     json={"exam_id": SUP_EXAM, "feedback_mode": "end"})
    assert r2.status_code == 201 and r2.json()["id"] != s["id"]
    with pg_engine.connect() as c:
        states = c.execute(sa.text(
            "SELECT state FROM study_sessions WHERE id = :s"), {"s": s["id"]}).scalar_one()
    assert states == "abandoned"


@requires_db
def test_start_rejects_non_supplementary_and_unknown_exams(pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    for exam_id in ("JLPTGO-N5-TEST-EX", "JLPTGO-SUP-N3-kanji-L999"):
        r = client.post("/api/supplementary/sessions", headers=auth(USER_A),
                        json={"exam_id": exam_id, "feedback_mode": "immediate"})
        assert r.status_code == 404, (exam_id, r.text)
    assert client.post("/api/supplementary/sessions", headers=auth(USER_A),
                       json={"exam_id": SUP_EXAM, "feedback_mode": "bogus"}).status_code == 422


@requires_db
def test_supplementary_stays_out_of_learning_statistics_and_history(
        pg_engine, sup_published, monkeypatch):
    client = make_client(monkeypatch, pg_engine)
    s = client.post("/api/supplementary/sessions", headers=auth(USER_A),
                    json={"exam_id": SUP_EXAM, "feedback_mode": "immediate"}).json()
    with pg_engine.begin() as c:
        qid = c.execute(sa.text(
            "SELECT q.question_id FROM release_questions q JOIN exam_releases r ON r.id = q.release_id"
            " WHERE r.exam_id = :e ORDER BY q.question_id LIMIT 1"), {"e": SUP_EXAM}).scalar_one()
        c.execute(sa.text(
            "INSERT INTO user_question_progress (user_id, question_id, attempt_count, correct_count,"
            " wrong_count, last_valid_result, last_answered_at) VALUES (:u, :q, 1, 0, 1, false, now())"),
            {"u": USER_A, "q": qid})
        # a finished supplementary session with a formal answer
        c.execute(sa.text("UPDATE study_sessions SET state = 'completed', ended_at = now() WHERE id = :s"),
                  {"s": s["id"]})
        su = c.execute(sa.text(
            "SELECT id, release_id, unit_id FROM study_session_units WHERE session_id = :s"
            " ORDER BY position LIMIT 1"), {"s": s["id"]}).mappings().one()
        q = c.execute(sa.text(
            "SELECT q.question_id, k.correct_option_id FROM release_questions q"
            " JOIN release_answer_keys k ON k.release_id = q.release_id AND k.question_id = q.question_id"
            " WHERE q.release_id = :r AND q.unit_id = :u"), {"r": su["release_id"], "u": su["unit_id"]}).mappings().one()
        c.execute(sa.text(
            "INSERT INTO study_submitted_answers (session_unit_id, release_id, unit_id, question_id,"
            " chosen_option_id, correct_option_id, answer_key_revision, is_correct)"
            " VALUES (:su, :r, :u, :q, :o, :o, 1, true)"),
            {"su": su["id"], "r": su["release_id"], "u": su["unit_id"], "q": q["question_id"],
             "o": q["correct_option_id"]})
    ov = client.get("/api/me/learning/overview?level=N3", headers=auth(USER_A)).json()
    assert ov["coverage"]["total_questions"] == 0 and ov["totals"]["still_wrong_questions"] == 0
    hist = client.get("/api/me/learning/history", headers=auth(USER_A)).json()
    assert hist["total"] == 0 and hist["items"] == []
    rec = client.get("/api/me/learning/questions?filter=still_wrong&level=N3", headers=auth(USER_A)).json()
    assert rec["total"] == 0
