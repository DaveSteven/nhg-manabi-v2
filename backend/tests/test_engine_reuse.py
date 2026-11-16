"""get_engine() must reuse one pooled Engine per DATABASE_URL.

Regression: it used to create a fresh Engine (and pool) on every call, so
each API request leaked connections until Postgres answered 'too many
clients already' (found importing/serving the full N1-N5 set).
"""
from sqlalchemy import text

from test_practice_sessions import requires_db


@requires_db
def test_get_engine_is_cached_per_url(pg_engine, monkeypatch):
    url = pg_engine.url.render_as_string(hide_password=False)
    monkeypatch.setenv("DATABASE_URL", url)
    from app.db.engine import get_engine
    assert get_engine() is get_engine()
    monkeypatch.setenv("DATABASE_URL", url + "?application_name=other")
    other = get_engine()
    monkeypatch.setenv("DATABASE_URL", url)
    assert other is not get_engine(), "different URL => different engine"


@requires_db
def test_many_calls_do_not_grow_server_connections(pg_engine, monkeypatch):
    url = pg_engine.url.render_as_string(hide_password=False) + "?application_name=engine-reuse-test"
    monkeypatch.setenv("DATABASE_URL", url)
    from app.db.engine import get_engine
    for _ in range(60):
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    with pg_engine.connect() as conn:
        n = conn.execute(text(
            "SELECT count(*) FROM pg_stat_activity"
            " WHERE application_name = 'engine-reuse-test'")).scalar()
    assert n <= 5, f"connections leaked: {n}"
