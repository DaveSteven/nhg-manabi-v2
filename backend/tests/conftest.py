"""Session-scoped isolated test database.

All DB-backed tests run against `<db>_test` derived from DATABASE_URL, never
the real development database: the test DB is created if missing and migrated
with `alembic upgrade head`. Real staging/release data is untouched.

Requires DATABASE_URL; without it, DB tests skip (module-level skipifs).
"""
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Shared identifiers for the synthetic fixture package (importer_fixture).
EXAM_ID = "JLPTGO-N5-TEST-EX"
PACKAGE_ID = "JLPTGO-N5-TEST-EX-r1"
CLOZE_UNIT = "JLPTGO-N5-TEST-EX-ly-01-u01"
SINGLE_UNIT = "JLPTGO-N5-TEST-EX-ly-02-u01"

RELEASE_TABLES = (
    "release_phase_units", "release_exam_phases", "release_answer_keys", "release_explanations", "release_option_media",
    "release_question_media", "release_exam_media", "release_options",
    "release_questions", "release_unit_materials", "release_units",
    "release_layers", "release_sections",
)


@pytest.fixture(scope="session")
def test_db_url():
    base = os.environ.get("DATABASE_URL")
    if not base:
        pytest.skip("DATABASE_URL not set; DB-backed tests skipped")

    url = make_url(base)
    test_db_name = url.database + "_test"
    test_url = url.set(database=test_db_name)
    admin_url = url.set(database="postgres")
    # str(url) hides the password (SA>=2.1); render with credentials instead.
    test_url_str = test_url.render_as_string(hide_password=False)

    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text(
            "SELECT 1 FROM pg_database WHERE datname = :d"), {"d": test_db_name}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{test_db_name}"'))
    admin.dispose()

    # Migrate the test DB to head with its own DATABASE_URL (alembic env.py
    # reads DATABASE_URL from the environment).
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = test_url_str
    try:
        command.upgrade(cfg, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
    return test_url_str


@pytest.fixture(scope="session")
def pg_engine(test_db_url):
    engine = create_engine(test_db_url)
    yield engine
    engine.dispose()


@pytest.fixture()
def clean_publish(pg_engine):
    """Wipe all rows belonging to the synthetic fixture package (before/after)."""
    from sqlalchemy import text

    def wipe():
        with pg_engine.begin() as conn:
            # Study-domain rows may reference the fixture release via
            # study_session_units (FK fk_session_unit_snapshot); clear them
            # (isolated test DB) before the release cascade.
            for table in ("study_answer_drafts", "study_submitted_answers",
                          "study_session_units", "study_results",
                          "study_phase_runs", "study_sessions",
                          "user_question_progress", "user_favorites"):
                conn.execute(text(f"DELETE FROM {table}"))
            conn.execute(text(
                "DELETE FROM import_records WHERE job_id IN"
                " (SELECT id FROM import_jobs WHERE package_id = :p)"),
                {"p": PACKAGE_ID})
            conn.execute(text(
                "DELETE FROM import_jobs WHERE package_id = :p"), {"p": PACKAGE_ID})
            for table in RELEASE_TABLES:
                conn.execute(text(
                    f"DELETE FROM {table} WHERE release_id IN"
                    " (SELECT id FROM exam_releases WHERE exam_id = :e)"), {"e": EXAM_ID})
            conn.execute(text(
                "DELETE FROM exam_current_releases WHERE exam_id = :e"), {"e": EXAM_ID})
            conn.execute(text(
                "DELETE FROM content_reviews WHERE canonical_id LIKE"
                " 'JLPTGO-N5-TEST-EX-%'"))
            conn.execute(text(
                "DELETE FROM content_issues WHERE canonical_id LIKE"
                " 'JLPTGO-N5-TEST-EX-%'"))
            conn.execute(text(
                "DELETE FROM publication_decisions WHERE exam_id = :e"), {"e": EXAM_ID})
            conn.execute(text("DELETE FROM exam_releases WHERE exam_id = :e"), {"e": EXAM_ID})
            conn.execute(text(
                "DELETE FROM question_registry WHERE exam_id = :e"), {"e": EXAM_ID})
            conn.execute(text("DELETE FROM media_assets WHERE id IN"
                              " ('JLPTGO-N5-TEST-EX-as001',"
                              " 'JLPTGO-N5-TEST-EX-as002')"))
            conn.execute(text(
                "DELETE FROM question_types t WHERE t.id IN"
                " ('grammar_cloze', 'vocabulary_kanji_reading')"
                " AND NOT EXISTS (SELECT 1 FROM release_layers l"
                " WHERE l.question_type_id = t.id)"))
            conn.execute(text("DELETE FROM exam_catalogs WHERE id = :e"), {"e": EXAM_ID})
    wipe()
    yield
    wipe()


@pytest.fixture()
def staged_and_published(pg_engine, clean_publish):
    """Stage + publish the synthetic fixture package; returns publish result."""
    import os
    import tempfile
    from pathlib import Path

    from importer_fixture import make_provenance, make_records, write_zip
    from app.importer.reader import load_archive
    from app.importer.staging import stage_package
    from app.publisher import publish_package

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "pkg.zip")
        write_zip(make_records(), make_provenance(), path)
        stage_package(pg_engine, load_archive(Path(path))[0])
        return publish_package(pg_engine, PACKAGE_ID)


@pytest.fixture()
def clean_study(pg_engine):
    """Wipe the study domain between tests (isolated test DB only).

    study_* rows are NOT covered by clean_publish; leftover in-progress
    sessions would otherwise trip the one-active-practice rule. Non-autouse:
    study test modules wrap it in a module-level autouse fixture.
    """
    import sqlalchemy as sa

    def wipe():
        with pg_engine.begin() as conn:
            for table in ("study_answer_drafts", "study_submitted_answers",
                          "study_session_units", "study_results",
                          "study_phase_runs", "study_sessions",
                          "user_question_progress", "user_favorites"):
                conn.execute(sa.text(f"DELETE FROM {table}"))
    wipe()
    yield
    wipe()


@pytest.fixture()
def published_release(pg_engine, staged_and_published):
    """Walk the fixture release through the full publish gate to 'published'.

    Marks answer keys human_reviewed and media verified *in the test DB
    only*, records rights, then promotes. Returns the published release id.
    """
    from sqlalchemy import text

    from app.publisher import confirm_rights, promote_release

    release_id = staged_and_published["release_id"]
    with pg_engine.begin() as conn:
        conn.execute(text(
            "UPDATE release_answer_keys SET review_status = 'human_reviewed'"
            " WHERE release_id = :r"), {"r": release_id})
        conn.execute(text(
            "UPDATE media_assets SET availability = 'verified'"
            " WHERE id IN ('JLPTGO-N5-TEST-EX-as001',"
            " 'JLPTGO-N5-TEST-EX-as002')"))
    confirm_rights(pg_engine, EXAM_ID, reviewer_id="legal")
    promote_release(pg_engine, release_id, reviewer_id="reviewer-1")
    return release_id
