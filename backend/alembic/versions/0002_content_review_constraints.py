"""Content review workflow hardening: status CHECKs + review idempotency key.

Revision ID: 0002_review_constraints
Revises: 0001_initial_schema

- Enumerate allowed review_status values on release_answer_keys,
  release_explanations and content_reviews, including the new
  'agent_verified' (local Agent validation with valid content-hash evidence).
- Constrain content_reviews.reviewer_type.
- Unique review identity (record_type, canonical_id, content_hash,
  reviewer_type, reviewer_id) so replaying an Agent batch is idempotent at
  the DB level.

These are additive DB-level hardening; the SQLAlchemy Core metadata is not
extended (test_migration_parity guards migration 0001 as shipped).
"""
from alembic import op

revision = "0002_review_constraints"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None

_AK_STATUS = "('unverified','agent_checked','agent_verified','human_reviewed','disputed')"
_EXPL_STATUS = "('missing','unverified','agent_checked','agent_verified','human_reviewed','disputed','not_checked')"
_CR_REVIEWER = "('agent','human','system')"
_CR_STATUS = "('unverified','agent_checked','agent_verified','human_reviewed','disputed','needs_review','blocked','not_checked')"

_UP = [
    f"ALTER TABLE release_answer_keys ADD CONSTRAINT ck_ak_review_status CHECK (review_status IN {_AK_STATUS})",
    f"ALTER TABLE release_explanations ADD CONSTRAINT ck_expl_review_status CHECK (review_status IN {_EXPL_STATUS})",
    f"ALTER TABLE content_reviews ADD CONSTRAINT ck_cr_reviewer_type CHECK (reviewer_type IN {_CR_REVIEWER})",
    f"ALTER TABLE content_reviews ADD CONSTRAINT ck_cr_review_status CHECK (review_status IN {_CR_STATUS})",
    "ALTER TABLE content_reviews ADD CONSTRAINT uq_content_review_identity UNIQUE (record_type, canonical_id, content_hash, reviewer_type, reviewer_id)",
]

_DOWN = [
    "ALTER TABLE content_reviews DROP CONSTRAINT uq_content_review_identity",
    "ALTER TABLE content_reviews DROP CONSTRAINT ck_cr_review_status",
    "ALTER TABLE content_reviews DROP CONSTRAINT ck_cr_reviewer_type",
    "ALTER TABLE release_explanations DROP CONSTRAINT ck_expl_review_status",
    "ALTER TABLE release_answer_keys DROP CONSTRAINT ck_ak_review_status",
]


def upgrade() -> None:
    for ddl in _UP:
        op.execute(ddl)


def downgrade() -> None:
    for ddl in _DOWN:
        op.execute(ddl)
