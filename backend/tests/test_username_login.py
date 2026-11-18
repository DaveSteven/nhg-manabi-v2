"""Username login, optional email, V1 hash upgrade, admin reset, V1 import
(ADR-0029)."""
import hashlib
import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa

from test_admin_dashboard import admin_headers
from test_student_auth import requires_db

PW = "study-hard-88"


def v1_hash(password, salt="a1b2c3d4e5f60718293a4b5c6d7e8f90"):
    """Exactly what JLPT GO 1.0 (Web/nhg-manabi-api) stored."""
    d = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(),
                            120_000).hex()
    return f"pbkdf2_sha256${salt}${d}"


@pytest.fixture(autouse=True)
def _clean(pg_engine):
    def wipe():
        with pg_engine.begin() as c:
            c.execute(sa.text("DELETE FROM admin_audit_logs"))
            c.execute(sa.text("DELETE FROM admin_sessions"))
            c.execute(sa.text("DELETE FROM admin_users"))
            c.execute(sa.text("DELETE FROM auth_email_tokens"))
            c.execute(sa.text("DELETE FROM user_sessions"))
            c.execute(sa.text("DELETE FROM users"))
    wipe()
    yield
    wipe()


@pytest.fixture()
def client(monkeypatch, pg_engine):
    monkeypatch.setenv("DATABASE_URL",
                       pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def add(engine, *, email=None, username=None, pw_hash=None, activated=True,
        uid=None):
    from app.passwords import hash_password
    uid = uid or uuid.uuid4()
    with engine.begin() as c:
        c.execute(sa.text(
            "INSERT INTO users (id, email, username, display_name,"
            " password_hash, activated_at) VALUES (:i, :e, :u, 'x', :h,"
            " CASE WHEN :a THEN now() END)"),
            {"i": uid, "e": email, "u": username, "a": activated,
             "h": pw_hash or hash_password(PW)})
    return uid


def login(client, ident, pw=PW, key="identifier"):
    return client.post("/api/auth/login", json={key: ident, "password": pw})


# ---------------------------------------------------------- hash compat ----

def test_v1_hash_verifies_and_is_flagged_for_rehash():
    from app.passwords import hash_password, needs_rehash, verify_password
    stored = v1_hash("abc123")
    assert verify_password("abc123", stored)
    assert not verify_password("abc124", stored)
    assert needs_rehash(stored)
    assert not needs_rehash(hash_password("abc123"))
    assert not verify_password("x", "pbkdf2_sha256$only-two")  # malformed
    assert not verify_password("x", "")


# ---------------------------------------------------------------- login ----

@requires_db
def test_login_by_username_email_and_legacy_param(client, pg_engine):
    add(pg_engine, email="s@example.com", username="sakura_01")
    r = login(client, "sakura_01")
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "sakura_01"
    assert login(client, "SAKURA_01").status_code == 200       # case-insensitive
    assert login(client, "S@Example.com").status_code == 200
    assert login(client, "s@example.com", key="email").status_code == 200
    assert login(client, "sakura_01", "wrong-pass").status_code == 401
    assert login(client, "nobody").status_code == 401
    assert login(client, "").status_code == 401


@requires_db
def test_email_less_account_logs_in_and_me_payload(client, pg_engine):
    add(pg_engine, username="old_user")
    tok = login(client, "old_user").json()["token"]
    me = client.get("/api/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert me["email"] is None and me["username"] == "old_user"


@requires_db
def test_unverified_or_disabled_username_account_is_refused(client, pg_engine):
    add(pg_engine, username="pending", activated=False)
    assert login(client, "pending").status_code == 401


@requires_db
def test_v1_hash_login_upgrades_to_scrypt(client, pg_engine):
    uid = add(pg_engine, username="v1user", pw_hash=v1_hash("oldpass"))
    assert login(client, "v1user", "wrong").status_code == 401
    assert login(client, "v1user", "oldpass").status_code == 200
    with pg_engine.connect() as c:
        h = c.execute(sa.text("SELECT password_hash FROM users WHERE id=:i"),
                      {"i": uid}).scalar_one()
    assert h.startswith("scrypt$")
    assert login(client, "v1user", "oldpass").status_code == 200


@requires_db
def test_lockout_applies_per_account_across_identifiers(client, pg_engine):
    add(pg_engine, email="l@example.com", username="locky")
    for _ in range(5):
        assert login(client, "locky", "bad-password").status_code == 401
    assert login(client, "l@example.com").status_code == 401   # locked
    assert login(client, "locky").status_code == 401


# ------------------------------------------------------------ DB rules ----

@requires_db
def test_db_constraints(pg_engine):
    add(pg_engine, username="dup_name")
    for bad in ("Upper", "has-dash", "a@b", "", "x" * 65):
        with pytest.raises(sa.exc.IntegrityError):
            add(pg_engine, username=bad)
    with pytest.raises(sa.exc.IntegrityError):
        add(pg_engine, username="dup_name")
    with pytest.raises(sa.exc.IntegrityError):          # no identity at all
        add(pg_engine)


# ---------------------------------------------------------- admin reset ----

@requires_db
def test_admin_reset_password(client, pg_engine):
    uid = add(pg_engine, username="forgot")
    h = admin_headers(client, pg_engine)
    assert client.post(f"/api/admin/users/{uid}/reset-password").status_code == 401
    assert client.post(f"/api/admin/users/{uuid.uuid4()}/reset-password",
                       headers=h).status_code == 404
    old = login(client, "forgot").json()["token"]
    r = client.post(f"/api/admin/users/{uid}/reset-password", headers=h,
                    json={"reason": "用户来电"})
    temp = r.json()["temporary_password"]
    assert r.status_code == 200 and len(temp) >= 8
    assert client.get("/api/me", headers={"Authorization": f"Bearer {old}"}
                      ).status_code == 401                      # sessions revoked
    assert login(client, "forgot").status_code == 401           # old pw dead
    assert login(client, "forgot", temp).status_code == 200
    d = client.get(f"/api/admin/users/{uid}", headers=h).json()
    assert d["user"]["username"] == "forgot" and d["user"]["email"] is None
    assert d["audit"][0]["action"] == "user_password_reset"
    assert temp not in str(d)
    found = client.get("/api/admin/users?q=forgo", headers=h).json()
    assert [i["username"] for i in found["items"]] == ["forgot"]


@requires_db
def test_null_email_user_still_counts_in_dashboard(client, pg_engine, monkeypatch):
    add(pg_engine, username="noemail")
    monkeypatch.setenv("DASHBOARD_EXCLUDE_EMAILS", "x@y.z,@excluded.test")
    from test_admin_dashboard import dash
    assert dash(pg_engine)["metrics"]["registered_users"] == 1


# --------------------------------------------------------------- import ----

def v1row(**kw):
    base = dict(id=str(uuid.uuid4()), username="u1", display_name="U One",
                password_hash=v1_hash("pw123456"), current_level="N3",
                created_at=None, last_active_at=None, email=None,
                activated_at=datetime(2025, 1, 1), disabled_at=None, avatar="fox")
    base.update(kw)
    return base


@requires_db
def test_import_dry_run_then_apply_is_idempotent(client, pg_engine):
    from app.v1_user_import import import_users
    rows = [v1row(username="alice", email="Alice@Example.com"),
            v1row(username="bob"),
            v1row(username="carol", password_hash="", avatar="nope",
                  current_level="N9")]
    dry = import_users(pg_engine, rows, apply=False)
    assert dry["imported"] == 3 and dry["applied"] is False
    with pg_engine.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM users")).scalar_one() == 0

    rep = import_users(pg_engine, rows, apply=True)
    assert rep["imported"] == 3 and rep["no_email"] == 2
    assert rep["no_usable_password"] == 1
    again = import_users(pg_engine, rows, apply=True)
    assert again["imported"] == 0 and again["already_imported"] == 3

    assert login(client, "alice", "pw123456").status_code == 200
    assert login(client, "alice@example.com", "pw123456").status_code == 200
    assert login(client, "carol", "pw123456").status_code == 401  # no hash
    with pg_engine.connect() as c:
        carol = c.execute(sa.text(
            "SELECT current_level, avatar FROM users WHERE username='carol'")
        ).one()
    assert tuple(carol) == ("N5", None)


@requires_db
def test_import_reports_conflicts_and_never_renames(pg_engine):
    from app.v1_user_import import import_users
    add(pg_engine, email="taken@example.com", username="existing")
    rows = [v1row(username="existing", email="e1@example.com"),   # name clash
            v1row(username="BadName-1", email="e2@example.com"),  # invalid
            v1row(username="fresh", email="taken@example.com"),   # email clash
            v1row(username="BadName-2")]                          # unusable
    rep = import_users(pg_engine, rows, apply=True)
    issues = {(d["username"], d["issue"]) for d in rep["degraded"]}
    assert ("existing", "username_conflict_dropped") in issues
    assert ("BadName-1", "invalid_username_dropped") in issues
    assert ("fresh", "email_conflict_dropped") in issues
    assert [s["username"] for s in rep["skipped"]] == ["BadName-2"]
    assert rep["imported"] == 3
    with pg_engine.connect() as c:
        names = {r[0] for r in c.execute(sa.text(
            "SELECT username FROM users WHERE username IS NOT NULL"))}
    assert names == {"existing", "fresh"}
