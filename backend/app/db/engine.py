import os
import threading

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

_engines: dict[str, Engine] = {}
_lock = threading.Lock()


def get_engine() -> Engine:
    """One pooled Engine per DATABASE_URL, reused for the process lifetime.

    Creating an Engine per call (the previous behaviour) gave every request
    its own connection pool that was never disposed, exhausting PostgreSQL's
    connection limit under modest load. Keyed by URL so tests/CLIs that
    point DATABASE_URL elsewhere still get their own engine.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required (see ../.env.example)")
    engine = _engines.get(url)
    if engine is None:
        with _lock:
            engine = _engines.get(url)
            if engine is None:
                engine = create_engine(url, pool_pre_ping=True,
                                       pool_size=5, max_overflow=10)
                _engines[url] = engine
    return engine
