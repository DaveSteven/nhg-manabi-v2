"""Admin identity (ADR-0009): separate tables, scrypt passwords, opaque
hashed session tokens, lockout, role gating, isolation from student auth.

Runs against the isolated test database (conftest.py).
"""
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from test_practice_sessions import requires_db

PW = "correct horse battery"


@pytest.fixture(autouse=True)
def clean_admin(pg_engine):
    def wipe():
        with pg_engine.begin() as conn:
            conn.execute(text("DELETE FROM admin_sessions"))
            conn.execute(text("DELETE FROM admin_users"))
    wipe()
    yield
    wipe()


def _client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    from app.admin_auth import require_admin
    from app.main import app
    # Role-gated probe routes (the real admin endpoints arrive in later slices).
    probe = FastAPI()
    probe.include_router(app.router)
    for role in ("viewer", "reviewer", "publisher"):
        probe.add_api_route(
            f"/t/{role}", lambda a=Depends(require_admin(role)): {"id": str(a["id"])},
            methods=["GET"])
    return TestClient(probe)


def _mk(pg_engine, username="alice", role="reviewer", password=PW):
    from app.admin_auth import create_admin
    return create_admin(pg_engine, username, password, role,
                        display_name=username.title())


def _login(client, username="alice", password=PW):
    return client.post("/api/admin/auth/login",
                       json={"username": username, "password": password})


# ------------------------------------------------------------ passwords ----

def test_password_hash_roundtrip_and_salting():
    from app.admin_auth import hash_password, verify_password
    a, b = hash_password(PW), hash_password(PW)
    assert a != b, "per-hash random salt"
    assert a.startswith("scrypt$") and PW not in a
    assert verify_password(PW, a) and not verify_password("wrong password!!", a)
    assert not verify_password(PW, "garbage")


# -------------------------------------------------------- create / schema ----

@requires_db
def test_create_admin_validates_and_normalises(pg_engine):
    from app.admin_auth import AdminError, create_admin
    with pytest.raises(AdminError):
        create_admin(pg_engine, "alice", "short", "reviewer")           # weak pw
    with pytest.raises(AdminError):
        create_admin(pg_engine, "alice", PW, "superuser")               # bad role
    with pytest.raises(AdminError):
        create_admin(pg_engine, "Al ice!", PW, "viewer")                # bad name
    row = _mk(pg_engine, "alice", "viewer")
    assert row["role"] == "viewer" and "password_hash" not in row
    with pytest.raises(AdminError):
        _mk(pg_engine, "alice", "viewer")                               # duplicate
    with pg_engine.connect() as conn:
        stored = conn.execute(text(
            "SELECT password_hash FROM admin_users")).scalar()
    assert stored.startswith("scrypt$") and PW not in stored


@requires_db
def test_db_constraints_reject_bad_rows(pg_engine):
    import uuid
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with pg_engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO admin_users (id, username, display_name,"
                " password_hash, role) VALUES (:i, 'bob', 'Bob', 'x', 'root')"),
                {"i": uuid.uuid4()})


# ------------------------------------------------------------------ login ----

@requires_db
def test_login_issues_token_and_stores_only_its_hash(monkeypatch, pg_engine):
    _mk(pg_engine)
    c = _client(monkeypatch, pg_engine)
    r = _login(c)
    assert r.status_code == 200, r.text
    body = r.json()
    token = body["token"]
    assert len(token) >= 40 and body["admin"]["username"] == "alice"
    assert "password" not in r.text and "password_hash" not in r.text
    with pg_engine.connect() as conn:
        hashes = conn.execute(text("SELECT token_hash FROM admin_sessions")).scalars().all()
    assert hashes == [hashlib.sha256(token.encode()).hexdigest()]
    assert token not in hashes[0]


@requires_db
def test_failed_logins_are_indistinguishable(monkeypatch, pg_engine):
    _mk(pg_engine)
    c = _client(monkeypatch, pg_engine)
    wrong = _login(c, password="wrong password!!")
    unknown = _login(c, username="nobody")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


@requires_db
def test_lockout_after_repeated_failures(monkeypatch, pg_engine):
    from app.admin_auth import login, AdminAuthError
    _mk(pg_engine)
    t0 = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
    for _ in range(5):
        with pytest.raises(AdminAuthError):
            login(pg_engine, "alice", "wrong password!!", now=t0)
    # Correct password is still refused while locked ...
    with pytest.raises(AdminAuthError):
        login(pg_engine, "alice", PW, now=t0 + timedelta(minutes=5))
    # ... and works again once the lock has expired (counter resets).
    out = login(pg_engine, "alice", PW, now=t0 + timedelta(minutes=16))
    assert out["token"]


@requires_db
def test_inactive_admin_cannot_login(monkeypatch, pg_engine):
    from app.admin_auth import set_active
    _mk(pg_engine)
    set_active(pg_engine, "alice", False)
    assert _login(_client(monkeypatch, pg_engine)).status_code == 401


# --------------------------------------------------------------- sessions ----

@requires_db
def test_token_authenticates_until_logout(monkeypatch, pg_engine):
    _mk(pg_engine)
    c = _client(monkeypatch, pg_engine)
    h = {"Authorization": "Bearer " + _login(c).json()["token"]}
    assert c.get("/api/admin/auth/me", headers=h).json()["username"] == "alice"
    assert c.post("/api/admin/auth/logout", headers=h).status_code == 204
    assert c.get("/api/admin/auth/me", headers=h).status_code == 401


@requires_db
def test_expired_token_rejected(monkeypatch, pg_engine):
    from app.admin_auth import login, authenticate_token
    _mk(pg_engine)
    t0 = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
    token = login(pg_engine, "alice", PW, now=t0)["token"]
    assert authenticate_token(pg_engine, token, now=t0 + timedelta(hours=11))
    assert authenticate_token(pg_engine, token, now=t0 + timedelta(hours=13)) is None


@requires_db
def test_deactivate_and_password_reset_revoke_sessions(monkeypatch, pg_engine):
    from app.admin_auth import (authenticate_token, login, reset_password,
                                set_active)
    _mk(pg_engine)
    t = login(pg_engine, "alice", PW)["token"]
    reset_password(pg_engine, "alice", "another long passphrase")
    assert authenticate_token(pg_engine, t) is None
    t2 = login(pg_engine, "alice", "another long passphrase")["token"]
    assert authenticate_token(pg_engine, t2)
    set_active(pg_engine, "alice", False)
    assert authenticate_token(pg_engine, t2) is None


# ------------------------------------------------------------------ roles ----

@requires_db
def test_role_hierarchy_and_status_codes(monkeypatch, pg_engine):
    for name, role in (("v", "viewer"), ("r", "reviewer"), ("p", "publisher")):
        _mk(pg_engine, name * 3, role)
    c = _client(monkeypatch, pg_engine)
    tok = {role: {"Authorization": "Bearer " + _login(c, name * 3).json()["token"]}
           for name, role in (("v", "viewer"), ("r", "reviewer"), ("p", "publisher"))}
    expect = {  # (token role, route role) -> status
        ("viewer", "viewer"): 200, ("viewer", "reviewer"): 403,
        ("viewer", "publisher"): 403, ("reviewer", "viewer"): 200,
        ("reviewer", "reviewer"): 200, ("reviewer", "publisher"): 403,
        ("publisher", "viewer"): 200, ("publisher", "reviewer"): 200,
        ("publisher", "publisher"): 200}
    for (have, need), status in expect.items():
        assert c.get(f"/t/{need}", headers=tok[have]).status_code == status, (have, need)
    assert c.get("/t/viewer").status_code == 401            # no token
    assert c.get("/t/viewer", headers={"Authorization": "Bearer nope"}).status_code == 401


# -------------------------------------------------------------- isolation ----

@requires_db
def test_student_and_admin_identities_do_not_cross(monkeypatch, pg_engine):
    student = "11111111-1111-4111-8111-111111111111"
    monkeypatch.setenv("AUTH_MODE", "dev_test")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_TEST_USER_IDS", student)
    _mk(pg_engine)
    c = _client(monkeypatch, pg_engine)
    # dev_test student token is NOT an admin credential (no bypass).
    assert c.get("/api/admin/auth/me",
                 headers={"Authorization": f"Bearer {student}"}).status_code == 401
    assert c.get("/t/viewer",
                 headers={"Authorization": f"Bearer {student}"}).status_code == 401
    # An admin session token is NOT a student identity.
    admin_tok = _login(c).json()["token"]
    assert c.get("/api/practice/sessions/current",
                 headers={"Authorization": f"Bearer {admin_tok}"}).status_code == 401


# -------------------------------------------------------------------- CLI ----

@requires_db
def test_cli_create_admin_prompts_for_password(monkeypatch, pg_engine, capsys):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    import getpass
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": PW)
    from app import admin_cli
    rc = admin_cli.main(["create-admin", "carol", "--role", "reviewer",
                         "--display-name", "Carol"])
    out = capsys.readouterr()
    assert rc == 0 and "carol" in out.out
    assert PW not in out.out and PW not in out.err
    with pg_engine.connect() as conn:
        assert conn.execute(text(
            "SELECT role FROM admin_users WHERE username='carol'")).scalar() == "reviewer"
