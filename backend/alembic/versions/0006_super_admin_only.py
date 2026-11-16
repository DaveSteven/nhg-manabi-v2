"""Narrow admin roles to a single 'super_admin' (ADR-0010).

The multi-role hierarchy of ADR-0009 is deferred. Any existing rows are
converted to super_admin first; downgrade restores the 3-role CHECK and
maps super_admin back to 'publisher' (the closest previous equivalent).
"""
from alembic import op

revision = "0006_super_admin_only"
down_revision = "0005_admin_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check")
    op.execute("UPDATE admin_users SET role = 'super_admin'")
    op.execute("ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check"
               " CHECK (role = 'super_admin')")


def downgrade() -> None:
    op.execute("ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check")
    op.execute("UPDATE admin_users SET role = 'publisher'")
    op.execute("ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check"
               " CHECK (role IN ('viewer', 'reviewer', 'publisher'))")
