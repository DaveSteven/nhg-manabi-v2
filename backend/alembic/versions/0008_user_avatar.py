"""users.avatar: fixed-set avatar id (user center).

NULL means the default solid-colour avatar. The allowed ids are the app's
fixed 12-avatar set, validated in the API (the set may grow without a
migration); the column only bounds the length.

Purely additive.
"""
from alembic import op

revision = "0008_user_avatar"
down_revision = "0007_student_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN avatar TEXT"
               " CHECK (avatar IS NULL OR length(avatar) <= 32)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN avatar")
