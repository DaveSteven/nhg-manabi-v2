"""Standardise three Chinese question-type names (user decision 2026-11-24).

文脉规定 → 语境填空, 造语 → 词语构成, 用法 → 词语用法. Display text only:
ids, Canonical content and release hashes are unchanged. The publisher
inserts question_types with ON CONFLICT DO NOTHING, so a later import never
reverts these.
"""
from alembic import op

revision = "0021_question_type_labels_zh"
down_revision = "0020_supplementary_exams"
branch_labels = None
depends_on = None

RENAMES = {
    "vocabulary_context": ("文脉规定", "语境填空"),
    "vocabulary_word_formation": ("造语", "词语构成"),
    "vocabulary_usage": ("用法", "词语用法"),
}


def _apply(index_from: int, index_to: int) -> None:
    for type_id, names in RENAMES.items():
        op.execute(
            f"UPDATE question_types SET label_zh = '{names[index_to]}'"
            f" WHERE id = '{type_id}' AND label_zh = '{names[index_from]}'")


def upgrade() -> None:
    _apply(0, 1)


def downgrade() -> None:
    _apply(1, 0)
