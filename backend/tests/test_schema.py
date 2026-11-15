from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable
from app.db.schema import metadata


def test_ddl_compiles_for_postgresql():
    assert len(metadata.tables) >= 30
    for table in metadata.sorted_tables:
        assert "CREATE TABLE" in str(CreateTable(table).compile(dialect=postgresql.dialect()))
        for index in table.indexes:
            assert "CREATE" in str(CreateIndex(index).compile(dialect=postgresql.dialect()))


def test_answer_keys_are_not_in_question_table():
    assert "correct_option_id" not in metadata.tables["release_questions"].c
    assert "correct_option_id" in metadata.tables["release_answer_keys"].c


def test_release_scoped_question_membership():
    question = metadata.tables["release_questions"]
    assert "release_id" in question.primary_key.columns
    assert "question_id" in question.primary_key.columns
    assert "unit_id" in question.c
