"""Strict mock listening, continuous mode (ADR-0022): one server timeline per
listening Phase.

When the exam has a verified full listening recording, the whole listening
Phase plays that ONE recording continuously. `study_phase_audio_plays` holds
one row per (session, phase): the server time the user pressed 「开始听力考试」.
Position = now - started_at, so a refresh resumes at the live position and the
recording is never replayed. Insert-only, like `study_audio_plays`.
"""
from alembic import op

revision = "0016_phase_audio_plays"
down_revision = "0015_audio_plays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE study_phase_audio_plays ("
        " session_id UUID NOT NULL REFERENCES study_sessions (id),"
        " phase_id TEXT NOT NULL,"
        " asset_id TEXT NOT NULL REFERENCES media_assets (id),"
        " started_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        " PRIMARY KEY (session_id, phase_id))")


def downgrade() -> None:
    op.execute("DROP TABLE study_phase_audio_plays")
