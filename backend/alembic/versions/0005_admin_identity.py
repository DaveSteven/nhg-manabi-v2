"""Admin identity tables (ADR-0009).

admin_users: dedicated administrator accounts, fully separate from the
student identity space (students have no table; ADR-0006). Passwords are
stored only as scrypt hashes. Roles are ordered viewer < reviewer <
publisher. Lockout state lives on the row.

admin_sessions: opaque bearer sessions. Only the SHA-256 of the token is
stored; sessions expire absolutely and can be revoked.

Purely additive; defined here only (post-0001 tables live in migrations,
like content_issues in 0003 and media_storage in 0004).
"""
from alembic import op

revision = "0005_admin_identity"
down_revision = "0004_media_storage"
branch_labels = None
depends_on = None

_UP = [
    """
    CREATE TABLE admin_users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE
            CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'reviewer', 'publisher')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        failed_login_count INTEGER NOT NULL DEFAULT 0
            CHECK (failed_login_count >= 0),
        locked_until TIMESTAMPTZ,
        password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE admin_sessions (
        id UUID PRIMARY KEY,
        admin_id UUID NOT NULL REFERENCES admin_users (id),
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        CHECK (expires_at > created_at)
    )
    """,
    "CREATE INDEX ix_admin_sessions_admin ON admin_sessions (admin_id)",
]

_DOWN = [
    "DROP INDEX ix_admin_sessions_admin",
    "DROP TABLE admin_sessions",
    "DROP TABLE admin_users",
]


def upgrade() -> None:
    for ddl in _UP:
        op.execute(ddl)


def downgrade() -> None:
    for ddl in _DOWN:
        op.execute(ddl)
