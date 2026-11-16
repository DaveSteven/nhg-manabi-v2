"""Controlled media storage mapping (media sync step, not the importer).

Revision ID: 0004_media_storage
Revises: 0003_review_sequence_issues

media_storage: one row per Canonical media asset that has been checked by
the media sync step. It maps a released asset reference to its internally
stored, content-addressed file WITHOUT touching the release content
snapshot:

- asset_id: Canonical MediaAsset id (stable business identity; the stored
  file is named by sha256, never renamed by asset).
- state: 'stored' (validated copy on disk) or 'unavailable' (source
  missing / hash or size mismatch / undecodable / unreadable store).
- stored_sha256/stored_size_bytes/stored_mime_type/verified_duration_ms:
  actually measured file facts, independent of declared metadata.
- source_system/source_path: internal provenance (where the copy came
  from). NEVER exposed through public DTOs.
- last_error: JSONB diagnostic (reason code + detail), queryable.

Storage layout is derived, not stored: <root>/<sha[:2]>/<sha[2:4]>/<sha>.<ext>
under the configured MEDIA_STORAGE_DIR. Disk paths never enter this table.

Purely additive; existing rows are untouched. Defined here only (not in
app.db.schema metadata) — post-0001 tables live in migrations, mirroring
content_issues in 0003.
"""
from alembic import op

revision = "0004_media_storage"
down_revision = "0003_review_sequence_issues"
branch_labels = None
depends_on = None

_UP = [
    """
    CREATE TABLE media_storage (
        asset_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('stored', 'unavailable')),
        stored_sha256 TEXT CHECK (stored_sha256 IS NULL OR length(stored_sha256) = 64),
        stored_size_bytes BIGINT CHECK (stored_size_bytes IS NULL OR stored_size_bytes >= 0),
        stored_mime_type TEXT,
        verified_duration_ms BIGINT CHECK (verified_duration_ms IS NULL OR verified_duration_ms >= 0),
        source_system TEXT,
        source_path TEXT,
        rule_version TEXT NOT NULL,
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error JSONB
    )
    """,
    "CREATE INDEX ix_media_storage_state ON media_storage (state)",
]

_DOWN = [
    "DROP INDEX ix_media_storage_state",
    "DROP TABLE media_storage",
]


def upgrade() -> None:
    for ddl in _UP:
        op.execute(ddl)


def downgrade() -> None:
    for ddl in _DOWN:
        op.execute(ddl)
