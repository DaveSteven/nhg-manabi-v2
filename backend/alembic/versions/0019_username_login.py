"""Username login and optional email for students (ADR-0029).

users.username: nullable, unique, lowercase [a-z0-9_]{1,64} (never '@', so a
login identifier is an email iff it contains '@'). users.email becomes
nullable (V1 accounts may have none); at least one of the two must exist.
users.legacy_v1_user_id: provenance + idempotency key for the V1 import.
admin_audit_logs.action gains 'user_password_reset' (admin resets the
password of accounts that cannot self-recover).

Downgrade refuses when email-less users exist rather than dropping accounts.
"""
from alembic import op

revision = "0019_username_login"
down_revision = "0018_admin_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN email DROP NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN username TEXT"
               " CONSTRAINT users_username_key UNIQUE"
               " CONSTRAINT users_username_check"
               " CHECK (username ~ '^[a-z0-9_]{1,64}$')")
    op.execute("ALTER TABLE users ADD COLUMN legacy_v1_user_id TEXT"
               " CONSTRAINT users_legacy_v1_user_id_key UNIQUE")
    op.execute("ALTER TABLE users ADD CONSTRAINT users_identity_present"
               " CHECK (email IS NOT NULL OR username IS NOT NULL)")
    op.execute("ALTER TABLE admin_audit_logs DROP CONSTRAINT"
               " admin_audit_logs_action_check")
    op.execute("ALTER TABLE admin_audit_logs ADD CONSTRAINT"
               " admin_audit_logs_action_check CHECK (action IN"
               " ('user_disable', 'user_enable', 'user_password_reset'))")


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM users WHERE email IS NULL) THEN"
        " RAISE EXCEPTION 'cannot downgrade: users without email exist'; END IF;"
        " IF EXISTS (SELECT 1 FROM admin_audit_logs"
        " WHERE action = 'user_password_reset') THEN"
        " RAISE EXCEPTION 'cannot downgrade: password reset audit rows exist';"
        " END IF; END $$")
    op.execute("ALTER TABLE admin_audit_logs DROP CONSTRAINT"
               " admin_audit_logs_action_check")
    op.execute("ALTER TABLE admin_audit_logs ADD CONSTRAINT"
               " admin_audit_logs_action_check CHECK (action IN"
               " ('user_disable', 'user_enable'))")
    op.execute("ALTER TABLE users DROP CONSTRAINT users_identity_present")
    op.execute("ALTER TABLE users DROP COLUMN legacy_v1_user_id")
    op.execute("ALTER TABLE users DROP COLUMN username")
    op.execute("ALTER TABLE users ALTER COLUMN email SET NOT NULL")
