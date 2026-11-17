"""Allow multiple in-progress 专项/普通 practice sessions per user (ADR-0015).

Sessions exist to hold study data (ordered units, drafts, feedback mode,
state), not to limit what the student may start. The partial unique index
`ux_one_active_practice` (at most one in-progress `mode='practice'` session
per user) is dropped. Untouched: `ux_one_active_mock` (strict mock exams
keep a single active slot) and `ux_one_active_quick` (quick practice stays
silent-replace).

A non-unique partial index serves the "most recent in-progress practice"
lookup behind GET /api/practice/sessions/current.

Downgrade restores the single-active rule. Rows that would violate it are
first closed as `ended_early` (all but the newest in-progress practice per
user): submitted answers are kept, no result rows are fabricated — the same
outcome as a user ending the older practice — so the unique index can be
rebuilt on data that was created under the relaxed rule.
"""
from alembic import op

revision = "0010_multi_active_practice"
down_revision = "0009_quick_practice_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX ux_one_active_practice")
    op.execute(
        "CREATE INDEX ix_sessions_user_active_practice"
        " ON study_sessions (user_id, created_at DESC)"
        " WHERE mode = 'practice' AND state = 'in_progress'")


def downgrade() -> None:
    op.execute("DROP INDEX ix_sessions_user_active_practice")
    op.execute(
        "UPDATE study_sessions s SET state = 'ended_early', ended_at = now(),"
        " version = version + 1"
        " WHERE s.mode = 'practice' AND s.state = 'in_progress'"
        " AND EXISTS (SELECT 1 FROM study_sessions n"
        "   WHERE n.user_id = s.user_id AND n.mode = 'practice'"
        "   AND n.state = 'in_progress'"
        "   AND (n.created_at, n.id) > (s.created_at, s.id))")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_practice ON study_sessions (user_id)"
        " WHERE mode = 'practice' AND state = 'in_progress'")
