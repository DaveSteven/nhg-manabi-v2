"""Supplementary (扩展练习) exams may have no year/month (ADR-0030).

exam_catalogs.year/month become nullable; a CHECK keeps them mandatory for
past_exam / mock_exam. Existing rows are unaffected. Downgrade refuses when
supplementary catalog rows exist (they could not satisfy NOT NULL).
"""
from alembic import op

revision = "0020_supplementary_exams"
down_revision = "0019_username_login"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE exam_catalogs ALTER COLUMN year DROP NOT NULL")
    op.execute("ALTER TABLE exam_catalogs ALTER COLUMN month DROP NOT NULL")
    op.execute(
        "ALTER TABLE exam_catalogs ADD CONSTRAINT exam_catalogs_dated_kinds"
        " CHECK (kind NOT IN ('past_exam', 'mock_exam')"
        " OR (year IS NOT NULL AND month IS NOT NULL))")


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM exam_catalogs"
        " WHERE year IS NULL OR month IS NULL) THEN"
        " RAISE EXCEPTION 'cannot downgrade: undated exam_catalogs rows exist';"
        " END IF; END $$")
    op.execute("ALTER TABLE exam_catalogs DROP CONSTRAINT exam_catalogs_dated_kinds")
    op.execute("ALTER TABLE exam_catalogs ALTER COLUMN month SET NOT NULL")
    op.execute("ALTER TABLE exam_catalogs ALTER COLUMN year SET NOT NULL")
