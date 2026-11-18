"""Mock exam gets its own slot again; practice and mock no longer collide (ADR-0020).

Reverses the shared-slot part of 0013 (ADR-0019 M8 was superseded): a user may
have one in-progress `practice` session AND one in-progress `mock` session at
the same time (plus the independent Quick slot). `ux_one_active_main` is
replaced by the per-mode `ux_one_active_practice` / `ux_one_active_mock`.
The phase-run guards added in 0013 stay.

Data: the shared index guaranteed at most one of the two modes in progress,
so both per-mode indexes build without data fixes. Downgrade re-merges the
slot; if a user then has both in progress, the older one is abandoned first.
"""
from alembic import op

revision = "0014_split_mock_slot"
down_revision = "0013_single_main_slot_mock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX ux_one_active_main")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_practice ON study_sessions (user_id)"
        " WHERE mode = 'practice' AND state = 'in_progress'")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_mock ON study_sessions (user_id)"
        " WHERE mode = 'mock' AND state = 'in_progress'")


def downgrade() -> None:
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
