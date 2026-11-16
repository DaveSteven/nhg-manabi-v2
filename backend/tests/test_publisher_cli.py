"""CLI wiring: every subcommand must at least dispatch (regression for the
confirm-rights NameError found during the first real-content release)."""
import os

import pytest

from conftest import EXAM_ID
from test_practice_sessions import requires_db


@requires_db
def test_confirm_rights_subcommand_dispatches(pg_engine, staged_and_published,
                                              monkeypatch, capsys):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    from app import publisher_cli
    rc = publisher_cli.main(["confirm-rights", EXAM_ID, "--reviewer", "legal",
                             "--notes", "test"])
    assert rc == 0
    assert '"decision": "rights_confirmed"' in capsys.readouterr().out


def test_cli_module_imports_all_commands():
    from app import publisher_cli
    assert callable(publisher_cli.confirm_rights)
