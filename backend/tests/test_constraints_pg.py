"""Real-PostgreSQL constraint verification for the migrated schema.

Skipped unless DATABASE_URL points at a migrated database, so unit test runs
stay hermetic. Run with: DATABASE_URL=... pytest tests/test_constraints_pg.py
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="DATABASE_URL not set; requires a migrated PostgreSQL"
)


@pytest.fixture(scope="module")
def engine(pg_engine):
    """Alias to the session-scoped isolated test-DB engine (see conftest.py)."""
    with pg_engine.connect() as conn:
        migrated = conn.execute(
            text("SELECT to_regclass('public.study_sessions') IS NOT NULL")
        ).scalar()
    if not migrated:
        pytest.skip("test database not migrated (run alembic upgrade head first)")
    return pg_engine


def _seed_release(engine) -> tuple[str, str]:
    """Minimal exam → release → section → layer → unit → question → option chain."""
    _cleanup(engine, str(uuid.uuid4()))  # clear leftovers from earlier runs
    release_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO exam_catalogs (id, level, year, month, kind, title)"
            " VALUES ('exam-test', 'N5', 2024, 12, 'real', 'Test Exam')"
        ))
        conn.execute(text(
            "INSERT INTO question_types (id, subject, label_zh, label_ja,"
            " answer_mode, default_unit_kind)"
            " VALUES ('qt-test', 'japanese', '测试', 'テスト', 'single', 'standalone')"
        ))
        conn.execute(text(
            "INSERT INTO question_registry (id, exam_id)"
            " VALUES ('q1', 'exam-test')"
        ))
        conn.execute(text(
            "INSERT INTO exam_releases (id, exam_id, revision, content_hash,"
            " schema_version) VALUES (:rid, 'exam-test', 1,"
            " :hash, '2.0')",
        ), {"rid": release_id, "hash": "a" * 64})
        conn.execute(text(
            "INSERT INTO release_sections (release_id, section_id, subject,"
            " position, title) VALUES (:rid, 's1', 'japanese', 1, 'S')",
        ), {"rid": release_id})
        conn.execute(text(
            "INSERT INTO release_layers (release_id, layer_id, section_id,"
            " question_type_id, position)"
            " VALUES (:rid, 'l1', 's1', 'qt-test', 1)",
        ), {"rid": release_id})
        conn.execute(text(
            "INSERT INTO release_units (release_id, unit_id, layer_id,"
            " question_type_id, kind, position, slot_ids)"
            " VALUES (:rid, 'u1', 'l1', 'qt-test', 'standalone', 1, '[]'::jsonb)",
        ), {"rid": release_id})
        conn.execute(text(
            "INSERT INTO release_questions (release_id, question_id, unit_id,"
            " question_type_id, position)"
            " VALUES (:rid, 'q1', 'u1', 'qt-test', 1)",
        ), {"rid": release_id})
        for pos_, oid in ((1, "o1"), (2, "o2")):
            conn.execute(text(
                "INSERT INTO release_options (release_id, option_id,"
                " question_id, position, content)"
                " VALUES (:rid, :oid, 'q1', :pos, '{}'::jsonb)",
            ), {"rid": release_id, "oid": oid, "pos": pos_})
        conn.execute(text(
            "INSERT INTO release_answer_keys (release_id, question_id,"
            " correct_option_id, revision, review_status)"
            " VALUES (:rid, 'q1', 'o2', 1, 'human_reviewed')",
        ), {"rid": release_id})
    return release_id, "q1"


def _cleanup(engine, release_id: str) -> None:
    """Delete every row chained to the fixed 'exam-test' catalog, children first.

    Uses a subquery on exam_releases.exam_id so leftovers from earlier runs
    (whose release ids were random) are also removed.
    """
    statements = [
        "DELETE FROM study_answer_drafts WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM study_submitted_answers WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM study_results WHERE session_id IN (SELECT id FROM study_sessions WHERE mock_release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test'))",
        "DELETE FROM study_phase_runs WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM study_session_units WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM study_sessions WHERE mock_release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_answer_keys WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_explanations WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_question_media WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_option_media WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_exam_media WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_phase_units WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_options WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_questions WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_unit_materials WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_units WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_layers WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_sections WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM release_exam_phases WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM exam_current_releases WHERE release_id IN (SELECT id FROM exam_releases WHERE exam_id = 'exam-test')",
        "DELETE FROM exam_releases WHERE exam_id = 'exam-test'",
        "DELETE FROM question_registry WHERE exam_id = 'exam-test'",
        "DELETE FROM publication_decisions WHERE exam_id = 'exam-test'",
        "DELETE FROM exam_catalogs WHERE id = 'exam-test'",
        "DELETE FROM question_types WHERE id = 'qt-test'",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def test_check_constraint_result_total(engine):
    release_id, _ = _seed_release(engine)
    try:
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO study_results (id, session_id, correct_count,"
                    " wrong_count, skipped_count, total_count, scoring_method,"
                    " scoring_version) VALUES (:id, :sid, 1, 1, 1, 4, 'plain', '1')",
                ), {"id": str(uuid.uuid4()), "sid": str(uuid.uuid4())})
    finally:
        _cleanup(engine, release_id)


def test_one_active_practice_session_per_user(engine):
    release_id, _ = _seed_release(engine)
    user_id = str(uuid.uuid4())
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO study_sessions (id, user_id, mode, feedback_mode,"
                " config) VALUES (:id, :uid, 'practice', 'end', '{}'::jsonb)",
            ), {"id": str(uuid.uuid4()), "uid": user_id})
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO study_sessions (id, user_id, mode,"
                    " feedback_mode, config)"
                    " VALUES (:id, :uid, 'practice', 'end', '{}'::jsonb)",
                ), {"id": str(uuid.uuid4()), "uid": user_id})
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM study_sessions WHERE user_id = :uid"), {"uid": user_id})
        _cleanup(engine, release_id)


def test_answer_key_requires_existing_option(engine):
    release_id, _ = _seed_release(engine)
    try:
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO release_answer_keys (release_id, question_id,"
                    " correct_option_id, revision, review_status)"
                    " VALUES (:rid, 'q1', 'nonexistent', 1, 'human_reviewed')",
                ), {"rid": release_id})
    finally:
        _cleanup(engine, release_id)


def test_mock_session_requires_release(engine):
    release_id, _ = _seed_release(engine)
    try:
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO study_sessions (id, user_id, mode,"
                    " feedback_mode, config)"
                    " VALUES (:id, :uid, 'mock', 'end', '{}'::jsonb)",
                ), {"id": str(uuid.uuid4()), "uid": str(uuid.uuid4())})
    finally:
        _cleanup(engine, release_id)


def test_exam_level_check_constraint(engine):
    with pytest.raises(Exception):
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO exam_catalogs (id, level, year, month, kind, title)"
                " VALUES ('exam-bad', 'N0', 2024, 12, 'real', 'Bad')"
            ))
