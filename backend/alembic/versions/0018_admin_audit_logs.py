"""Append-only audit log for admin account operations (user management P2).

Records who (admin id, server-derived) did what to which target and why.
Rows are only ever inserted; the API exposes no update/delete.
"""
from alembic import op

revision = "0018_admin_audit_logs"
down_revision = "0017_user_visit_days"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE admin_audit_logs ("
        " id UUID PRIMARY KEY,"
        " admin_id UUID NOT NULL,"
        " admin_username TEXT NOT NULL,"
        " action TEXT NOT NULL CHECK (action IN ('user_disable', 'user_enable')),"
        " target_type TEXT NOT NULL CHECK (target_type = 'user'),"
        " target_id UUID NOT NULL,"
        " reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),"
        " created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
    op.execute("CREATE INDEX ix_admin_audit_target ON admin_audit_logs"
               " (target_type, target_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE admin_audit_logs")
