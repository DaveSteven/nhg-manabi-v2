"""Backfill user_question_progress from formal submitted answers.

Data-only revision (no schema change): the table has existed since 0001 but
was never populated. From this revision the application maintains it inside
every answer-submit transaction (`app.question_progress`); this backfill
derives the rows for answers submitted earlier, with the same statement.

The cache is derived and rebuildable, so downgrade simply empties it.
"""
from alembic import op

revision = "0012_backfill_question_progress"
down_revision = "0011_single_active_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.question_progress import rebuild_all_progress
    rebuild_all_progress(op.get_bind())


def downgrade() -> None:
    op.execute("DELETE FROM user_question_progress")
