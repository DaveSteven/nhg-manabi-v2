"""Single recent practice session per user, replaced on new start (ADR-0016).

Supersedes ADR-0015's "many in-progress practice sessions". A user keeps at
most ONE recoverable `mode='practice'` session. Starting another abandons the
previous in-progress one in the SAME transaction (state='abandoned',
ended_at set; submitted answers/history untouched, unsubmitted drafts simply
never count) — so a failed creation rolls the abandonment back too.

Constraint: `ux_one_active_practice` is restored (partial unique index on
user_id WHERE mode='practice' AND state='in_progress'); the non-unique
`ix_sessions_user_active_practice` from 0010 is dropped. Quick
(`ux_one_active_quick`) and mock (`ux_one_active_mock`) are untouched.

Data: rows created under the relaxed 0010 rule may contain several
in-progress practice sessions per user. Before the unique index is built,
all but the newest per user become `abandoned` (answers kept, no results).

Downgrade restores the 0010 shape (non-unique index, no unique constraint).
"""
from alembic import op

revision = "0011_single_active_practice"
down_revision = "0010_multi_active_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX ix_sessions_user_active_practice")
    op.execute(
        "UPDATE study_sessions s SET state = 'abandoned', ended_at = now(),"
        " version = version + 1"
        " WHERE s.mode = 'practice' AND s.state = 'in_progress'"
        " AND EXISTS (SELECT 1 FROM study_sessions n"
        "   WHERE n.user_id = s.user_id AND n.mode = 'practice'"
        "   AND n.state = 'in_progress'"
        "   AND (n.created_at, n.id) > (s.created_at, s.id))")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_practice ON study_sessions (user_id)"
        " WHERE mode = 'practice' AND state = 'in_progress'")


def downgrade() -> None:
    op.execute("DROP INDEX ux_one_active_practice")
    op.execute(
        "CREATE INDEX ix_sessions_user_active_practice"
        " ON study_sessions (user_id, created_at DESC)"
        " WHERE mode = 'practice' AND state = 'in_progress'")
