"""Student accounts (ADR-0011).

users: student accounts, fully separate from admin_users. Email is the
login identity (lowercased, unique). current_level is the student's JLPT
target level preference (N5-N1). Lockout columns mirror admin_users.

user_sessions: opaque 30-day bearer sessions; only the SHA-256 of the
token is stored; sessions expire absolutely and can be revoked.

auth_email_tokens: one-time hashed tokens for email verification
(24h) and password reset (1h). purpose marks the flow; used_at burns
the token.

Purely additive; students had no table before this revision (ADR-0006).
"""
from alembic import op

revision = "0007_student_accounts"
down_revision = "0006_super_admin_only"
branch_labels = None
depends_on = None

_UP = [
    """
    CREATE TABLE users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE
            CHECK (length(email) <= 255 AND email ~ '@'),
        display_name TEXT NOT NULL CHECK (length(display_name) <= 128),
        password_hash TEXT NOT NULL,
        current_level TEXT NOT NULL DEFAULT 'N5'
            CHECK (current_level IN ('N5', 'N4', 'N3', 'N2', 'N1')),
        activated_at TIMESTAMPTZ,
        disabled_at TIMESTAMPTZ,
        failed_login_count INTEGER NOT NULL DEFAULT 0
            CHECK (failed_login_count >= 0),
        locked_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE user_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users (id),
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        CHECK (expires_at > created_at)
    )
    """,
    "CREATE INDEX ix_user_sessions_user ON user_sessions (user_id)",
    """
    CREATE TABLE auth_email_tokens (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users (id),
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_auth_email_tokens_user ON auth_email_tokens (user_id)",
]

_DOWN = [
    "DROP INDEX ix_auth_email_tokens_user",
    "DROP TABLE auth_email_tokens",
    "DROP INDEX ix_user_sessions_user",
    "DROP TABLE user_sessions",
    "DROP TABLE users",
]


def upgrade() -> None:
    for ddl in _UP:
        op.execute(ddl)


def downgrade() -> None:
    for ddl in _DOWN:
        op.execute(ddl)
