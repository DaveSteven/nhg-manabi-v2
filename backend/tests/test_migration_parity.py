"""Guard against drift between SQLAlchemy metadata and migration 0001 DDL.

The initial migration stores static DDL on purpose; if the metadata is edited
without a new Alembic revision, this test fails.
"""
import importlib.util
import re
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.db.schema import metadata

_migration_path = Path(__file__).parent.parent / "alembic" / "versions" / "0001_initial_schema.py"
_spec = importlib.util.spec_from_file_location("migration_0001", _migration_path)
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)
_DDL = _migration._DDL
_TABLES = _migration._TABLES


def _normalize(ddl: str) -> str:
    return re.sub(r"\s+", " ", ddl).strip()


def _expected_ddl_set() -> set[str]:
    statements: set[str] = set()
    for table in metadata.sorted_tables:
        statements.add(_normalize(str(CreateTable(table).compile(dialect=postgresql.dialect()))))
        for index in table.indexes:
            statements.add(_normalize(str(CreateIndex(index).compile(dialect=postgresql.dialect()))))
    return statements


def test_migration_matches_metadata():
    assert set(_TABLES) == set(metadata.tables.keys()), (
        "migration table list differs from metadata tables"
    )
    expected = _expected_ddl_set()
    actual = {_normalize(d) for d in _DDL}
    assert actual == expected, (
        "migration 0001 DDL drift:\n"
        f"only in metadata: {sorted(expected - actual)}\n"
        f"only in migration: {sorted(actual - expected)}"
    )


def test_table_count_is_32():
    assert len(metadata.tables) == 32
    assert len(_TABLES) == 32
