"""user_question_progress: per-user, per-question cache derived from the
immutable formal answers (study_submitted_answers) of practice and
quick_practice sessions. Drafts never count; mock is not implemented yet.

Semantics (business-rules): attempt_count = answers with a chosen option;
skip_count = formal submissions with none (skip != wrong); last_valid_result
and last_answered_at follow ONLY real choices, so a later skip never
overwrites the last right/wrong; last_seen_* follow any submission.

The cache is always recomputed from the source rows of the touched
questions (never incremented), so it is idempotent and `rebuild_user_progress`
and the in-transaction upkeep share one statement and cannot drift.
"""
import uuid

from sqlalchemy import text

_UPSERT = (
    "INSERT INTO user_question_progress (user_id, question_id,"
    " attempt_count, correct_count, wrong_count, skip_count,"
    " last_valid_result, last_answered_at, last_seen_at, last_release_id,"
    " updated_at)"
    " SELECT s.user_id, sa.question_id,"
    "  count(*) FILTER (WHERE sa.chosen_option_id IS NOT NULL),"
    "  count(*) FILTER (WHERE sa.is_correct IS TRUE),"
    "  count(*) FILTER (WHERE sa.is_correct IS FALSE),"
    "  count(*) FILTER (WHERE sa.chosen_option_id IS NULL),"
    "  (array_agg(sa.is_correct ORDER BY sa.submitted_at DESC)"
    "    FILTER (WHERE sa.chosen_option_id IS NOT NULL))[1],"
    "  max(sa.submitted_at) FILTER (WHERE sa.chosen_option_id IS NOT NULL),"
    "  max(sa.submitted_at),"
    "  (array_agg(sa.release_id ORDER BY sa.submitted_at DESC))[1],"
    "  now()"
    " FROM study_submitted_answers sa"
    " JOIN study_session_units su ON su.id = sa.session_unit_id"
    " JOIN study_sessions s ON s.id = su.session_id"
    " WHERE s.user_id = :u AND s.mode IN ('practice', 'quick_practice')"
    "  {scope}"
    " GROUP BY s.user_id, sa.question_id"
    " ON CONFLICT (user_id, question_id) DO UPDATE SET"
    "  attempt_count = EXCLUDED.attempt_count,"
    "  correct_count = EXCLUDED.correct_count,"
    "  wrong_count = EXCLUDED.wrong_count,"
    "  skip_count = EXCLUDED.skip_count,"
    "  last_valid_result = EXCLUDED.last_valid_result,"
    "  last_answered_at = EXCLUDED.last_answered_at,"
    "  last_seen_at = EXCLUDED.last_seen_at,"
    "  last_release_id = EXCLUDED.last_release_id,"
    "  updated_at = now()")


def refresh_question_progress(conn, user_id: uuid.UUID,
                              question_ids: list[str]) -> int:
    """Recompute the touched questions inside the caller's transaction."""
    if not question_ids:
        return 0
    return conn.execute(
        text(_UPSERT.format(scope="AND sa.question_id = ANY(:qs)")),
        {"u": user_id, "qs": list(question_ids)}).rowcount


def rebuild_user_progress(conn, user_id: uuid.UUID) -> int:
    """Recompute every question the user has formally answered."""
    return conn.execute(text(_UPSERT.format(scope="")),
                        {"u": user_id}).rowcount


def rebuild_all_progress(conn) -> int:
    """Backfill for every user (used by the data migration)."""
    return conn.execute(text(_UPSERT.format(scope="").replace(
        "WHERE s.user_id = :u AND", "WHERE"))).rowcount
