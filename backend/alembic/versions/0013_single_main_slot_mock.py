"""Practice and strict mock exam share ONE in-progress slot (ADR-0019 M8).

A user has at most one in-progress `practice` OR `mock` session. Starting
either abandons/replaces the other in the same transaction (application
code); this partial unique index is the concurrency backstop:

- `ux_one_active_practice` and `ux_one_active_mock` are replaced by
  `ux_one_active_main` (user_id WHERE mode IN ('practice','mock') AND
  state = 'in_progress'). Quick Practice keeps its own `ux_one_active_quick`.
- `study_phase_runs` gains the integrity the mock state machine relies on:
  one run per (session, phase), at most one OPEN run per session, and a
  positive window (expires_at > started_at).

Data: no mock session can exist before this revision (the API did not exist),
but if a user somehow has both kinds in progress, all but the newest become
`abandoned` before the unique index is built.

Downgrade restores the two per-mode indexes and drops the phase-run guards.
"""
from alembic import op

revision = "0013_single_main_slot_mock"
down_revision = "0012_backfill_question_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE study_sessions s SET state = 'abandoned', ended_at = now(),"
        " version = version + 1"
        " WHERE s.mode IN ('practice', 'mock') AND s.state = 'in_progress'"
        " AND EXISTS (SELECT 1 FROM study_sessions n"
        "   WHERE n.user_id = s.user_id AND n.mode IN ('practice', 'mock')"
        "   AND n.state = 'in_progress'"
        "   AND (n.created_at, n.id) > (s.created_at, s.id))")
    op.execute("DROP INDEX ux_one_active_practice")
    op.execute("DROP INDEX ux_one_active_mock")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_main ON study_sessions (user_id)"
        " WHERE mode IN ('practice', 'mock') AND state = 'in_progress'")
    op.execute(
        "ALTER TABLE study_phase_runs ADD CONSTRAINT uq_phase_run_once"
        " UNIQUE (session_id, phase_id)")
    op.execute(
        "ALTER TABLE study_phase_runs ADD CONSTRAINT ck_phase_run_window"
        " CHECK (expires_at > started_at)")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_open_phase_run ON study_phase_runs"
        " (session_id) WHERE closed_at IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX ux_one_open_phase_run")
    op.execute("ALTER TABLE study_phase_runs DROP CONSTRAINT ck_phase_run_window")
    op.execute("ALTER TABLE study_phase_runs DROP CONSTRAINT uq_phase_run_once")
    op.execute("DROP INDEX ux_one_active_main")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_practice ON study_sessions (user_id)"
        " WHERE mode = 'practice' AND state = 'in_progress'")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_mock ON study_sessions (user_id)"
        " WHERE mode = 'mock' AND state = 'in_progress'")
