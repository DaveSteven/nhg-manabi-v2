"""Quick Practice session mode (docs/design/quick-practice.md v2.0).

Quick Practice gets its own study_sessions.mode value so it never occupies
the single-active slot of 专项练习 (`ux_one_active_practice`) or mock exams:

- mode CHECK gains 'quick_practice'.
- The mode/mock_release_id consistency CHECK gains the quick branch
  (quick sessions are exam-unit practice: mock_release_id IS NULL).
- New partial unique index ux_one_active_quick: at most ONE in-progress
  quick session per user. Starting a new quick practice silently ends the
  previous one in the same transaction (no conflict dialog — the old quick
  session holds nothing but unsubmitted selections, which reset by design).

Purely constraint-level; no table or column changes, existing rows valid
under both the old and new CHECKs.
"""
from alembic import op

revision = "0009_quick_practice_mode"
down_revision = "0008_user_avatar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE study_sessions"
               " DROP CONSTRAINT study_sessions_mode_check,"
               " ADD CONSTRAINT study_sessions_mode_check"
               " CHECK (mode IN ('practice','mock','quick_practice'))")
    op.execute("ALTER TABLE study_sessions"
               " DROP CONSTRAINT study_sessions_check,"
               " ADD CONSTRAINT study_sessions_check CHECK ("
               " (mode = 'mock' AND mock_release_id IS NOT NULL)"
               " OR (mode IN ('practice','quick_practice')"
               "     AND mock_release_id IS NULL))")
    op.execute(
        "CREATE UNIQUE INDEX ux_one_active_quick ON study_sessions (user_id)"
        " WHERE mode = 'quick_practice' AND state = 'in_progress'")


def downgrade() -> None:
    op.execute("DROP INDEX ux_one_active_quick")
    op.execute("ALTER TABLE study_sessions"
               " DROP CONSTRAINT study_sessions_check,"
               " ADD CONSTRAINT study_sessions_check CHECK ("
               " (mode = 'mock' AND mock_release_id IS NOT NULL)"
               " OR (mode = 'practice' AND mock_release_id IS NULL))")
    op.execute("ALTER TABLE study_sessions"
               " DROP CONSTRAINT study_sessions_mode_check,"
               " ADD CONSTRAINT study_sessions_mode_check"
               " CHECK (mode IN ('practice','mock'))")
