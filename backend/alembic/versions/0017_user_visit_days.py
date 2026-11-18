"""Lightweight visit tracking for the admin dashboard.

One row per (user, Asia/Tokyo calendar day) the signed-in student opened the
learning app. No IP / user-agent / path / content: just who-was-here-which-day,
which is all the dashboard's visit-active and funnel stages need. The unique
key makes repeated pings idempotent.
"""
from alembic import op

revision = "0017_user_visit_days"
down_revision = "0016_phase_audio_plays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE user_visit_days ("
        " user_id UUID NOT NULL,"
        " visit_date DATE NOT NULL,"
        " first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        " PRIMARY KEY (user_id, visit_date))")
    op.execute("CREATE INDEX ix_user_visit_days_date ON user_visit_days (visit_date)")


def downgrade() -> None:
    op.execute("DROP TABLE user_visit_days")
