"""Strict mock listening: server record of when each audio started (ADR-0019 M3).

`study_audio_plays` holds ONE row per (session unit, audio material): the
server time the user pressed play. The audio is a live timeline from then on
(no pause, no rewind, no replay): position = now - started_at, so a refresh
resumes where the exam audio really is, and once the duration has elapsed the
audio is consumed for good. The row is only ever inserted (idempotent claim),
never updated or deleted by the application.
"""
from alembic import op

revision = "0015_audio_plays"
down_revision = "0014_split_mock_slot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE study_audio_plays ("
        " session_unit_id UUID NOT NULL REFERENCES study_session_units (id),"
        " material_id TEXT NOT NULL,"
        " started_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        " PRIMARY KEY (session_unit_id, material_id))")


def downgrade() -> None:
    op.execute("DROP TABLE study_audio_plays")
