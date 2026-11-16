"""Student accounts and sessions (ADR-0011): register → verify → login,
lockout, email flows, /api/me, and integration with the study-domain
identity boundary (get_current_user_id resolves real session tokens)."""
import os
import uuid as uuid_mod
from datetime import datetime, timedelta, timezone

import pytest

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; requires migrated PostgreSQL",
)

EMAIL = "student@example.com"
PASSWORD = "study-hard-88"


@pytest.fixture(autouse=True)
def _clean_users(pg_engine):
    from sqlalchemy import text

    def wipe():
        with pg_engine.begin() as conn:
            conn.execute(text("DELETE FROM auth_email_tokens"))
            conn.execute(text("DELETE FROM user_sessions"))
            conn.execute(text("DELETE FROM users"))
    wipe()
    yield
    wipe()


@pytest.fixture()
def client(monkeypatch, pg_engine):
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def captured_mail(monkeypatch):
    """Capture outbound mail; returns list of (to, subject, text)."""
    sent = []

    def fake_send(to, subject, text):
        sent.append((to, subject, text))

    monkeypatch.setattr("app.api.auth_student.emailer.send_email", fake_send)
    return sent


def register(engine, email=EMAIL, password=PASSWORD, display_name=None):
    from app.student_auth import register
    return register(engine, email, password, display_name)


def activate(engine, token=None):
    from app.student_auth import verify_email
    token = token or register(engine)
    return verify_email(engine, token)


def login(client, email=EMAIL, password=PASSWORD):
    return client.post("/api/auth/login",
                       json={"email": email, "password": password})


# --------------------------------------------------------- registration ----

@pytest.mark.usefixtures("pg_engine")
class TestRegister:
    def test_field_errors(self, pg_engine):
        from app.student_auth import StudentInputError, register
        with pytest.raises(StudentInputError) as e:
            register(pg_engine, "not-an-email", PASSWORD)
        assert e.value.field == "email"
        with pytest.raises(StudentInputError) as e:
            register(pg_engine, EMAIL, "short")
        assert e.value.field == "password"

    def test_duplicate_email_is_rejected(self, pg_engine):
        from app.student_auth import StudentInputError
        register(pg_engine)
        with pytest.raises(StudentInputError) as e:
            register(pg_engine, EMAIL.upper(), PASSWORD)
        assert e.value.field == "email"

    def test_api_register_sends_verification_mail_and_login_is_refused_before_activation(
            self, client, captured_mail):
        resp = client.post("/api/auth/register", json={
            "email": EMAIL, "password": PASSWORD, "display_name": "小明"})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        to, subject, text = captured_mail[0]
        assert to == EMAIL and "验证" in subject
        token = text.rsplit("token=", 1)[1].split()[0]
        # unverified accounts cannot log in — uniform 401
        assert login(client).status_code == 401
        # unknown account: same 401, no existence leak
        assert login(client, email="who@else.io").status_code == 401
        # activating the captured link unlocks login
        v = client.post("/api/auth/verify-email", json={"token": token})
        assert v.json() == {"status": "ok"}
        resp = login(client)
        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["email"] == EMAIL
        assert body["user"]["display_name"] == "小明"
        assert body["user"]["current_level"] == "N5"
        assert len(body["token"]) >= 32

    def test_duplicate_email_api_error_is_field_level(self, client, pg_engine):
        register(pg_engine)
        resp = client.post("/api/auth/register",
                           json={"email": EMAIL, "password": PASSWORD})
        assert resp.status_code == 400
        assert resp.json()["detail"]["field"] == "email"


# ------------------------------------------------------------ verify ----

def test_verify_email_replay_is_idempotent(client, pg_engine):
    token = register(pg_engine)
    assert client.post("/api/auth/verify-email",
                       json={"token": token}).json() == {"status": "ok"}
    assert client.post("/api/auth/verify-email",
                       json={"token": token}).json() == {"status": "already"}
    assert client.post("/api/auth/verify-email",
                       json={"token": "nope"}).status_code == 400


def test_verify_email_rejects_expired_token(client, pg_engine):
    from sqlalchemy import text
    token = register(pg_engine)
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    with pg_engine.begin() as conn:
        conn.execute(text("UPDATE auth_email_tokens SET expires_at = :e"),
                     {"e": past})
    assert client.post("/api/auth/verify-email",
                       json={"token": token}).status_code == 400


def test_resend_verification_has_cooldown_and_uniform_response(
        client, pg_engine, captured_mail):
    register(pg_engine)
    for _ in range(2):
        resp = client.post("/api/auth/resend-verification",
                           json={"email": "ghost@nowhere.io"})
        assert resp.status_code == 200  # unknown account: same response
    assert len(captured_mail) == 0
    from sqlalchemy import text as sa_text
    stale = datetime.now(timezone.utc) - timedelta(seconds=61)
    with pg_engine.begin() as conn:
        conn.execute(sa_text(
            "UPDATE auth_email_tokens SET created_at = :c"
            " WHERE purpose = 'verify'"), {"c": stale})
    assert client.post("/api/auth/resend-verification",
                       json={"email": EMAIL}).status_code == 200
    assert client.post("/api/auth/resend-verification",
                       json={"email": EMAIL}).status_code == 200
    assert len(captured_mail) == 1  # 60s cooldown suppressed the second


# --------------------------------------------------------------- lockout ----

def test_lockout_after_five_failures_blocks_correct_password(
        client, pg_engine):
    activate(pg_engine)
    for _ in range(5):
        assert login(client, password="wrong-password").status_code == 401
    assert login(client).status_code == 401  # correct password still refused
    # unknown email: uniform 401 without touching counters
    assert login(client, email="nobody@x.io").status_code == 401


# ------------------------------------------------------- password reset ----

def test_reset_password_burns_token_revokes_sessions(
        client, pg_engine, captured_mail):
    activate(pg_engine)
    old_token = login(client).json()["token"]
    assert client.get("/api/me", headers={
        "Authorization": f"Bearer {old_token}"}).status_code == 200
    resp = client.post("/api/auth/forgot-password", json={"email": EMAIL})
    assert resp.status_code == 200
    ghost = client.post("/api/auth/forgot-password",
                        json={"email": "ghost@nowhere.io"})
    assert ghost.status_code == 200  # uniform response, no mail
    reset_token = client.post("/api/auth/reset-password", json={
        "token": "bad", "password": "new-pass-99"})
    assert reset_token.status_code == 400
    weak = client.post("/api/auth/reset-password", json={
        "token": "bad", "password": "x"})
    assert weak.status_code == 400
    to, subject, mail_text = captured_mail[0]
    assert to == EMAIL
    token = mail_text.rsplit("token=", 1)[1].split()[0]
    assert client.post("/api/auth/reset-password", json={
        "token": token, "password": "new-pass-99"}).status_code == 200
    # old session revoked, old password dead, new password live
    assert client.get("/api/me", headers={
        "Authorization": f"Bearer {old_token}"}).status_code == 401
    assert login(client, password=PASSWORD).status_code == 401
    assert login(client, password="new-pass-99").status_code == 200


# --------------------------------------------------------- sessions / me ----

def test_session_authenticates_until_logout(client, pg_engine):
    activate(pg_engine)
    token = login(client).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL
    patched = client.patch("/api/me", json={"current_level": "N2"},
                           headers=headers)
    assert patched.status_code == 200
    assert patched.json()["current_level"] == "N2"
    bad = client.patch("/api/me", json={"current_level": "N0"}, headers=headers)
    assert bad.status_code == 400
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/me", headers=headers).status_code == 401
    assert client.get("/api/me").status_code == 401


def test_get_current_user_id_resolves_real_session_without_dev_mode(
        client, pg_engine, monkeypatch):
    """ADR-0006 swap point: a real session token authenticates the study
    domain with no AUTH_MODE configured; an unknown token stays 401."""
    activate(pg_engine)
    token = login(client).json()["token"]
    monkeypatch.setenv(
        "DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    from app.auth import get_current_user_id, NotAuthenticated
    uid = get_current_user_id(authorization=f"Bearer {token}")
    assert isinstance(uid, uuid_mod.UUID)
    with pytest.raises(NotAuthenticated):
        get_current_user_id(authorization="Bearer not-a-session")
    with pytest.raises(NotAuthenticated):
        get_current_user_id(authorization=None)


@pytest.mark.usefixtures("pg_engine")
def test_unauthenticated_stays_fail_closed(monkeypatch):
    from app.auth import NotAuthenticated, get_current_user_id
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    # a non-session token with no AUTH_MODE must fail closed (no DB hit
    # resolves it) — the engine fixture already points DATABASE_URL at the
    # isolated test DB
    with pytest.raises(NotAuthenticated):
        get_current_user_id(authorization="Bearer whatever")


# --------------------------------------------------------------- avatar ----

def _auth_headers(client, pg_engine):
    activate(pg_engine)
    token = login(client).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_new_account_has_default_avatar_and_login_returns_it(client, pg_engine):
    activate(pg_engine)
    body = login(client).json()
    assert body["user"]["avatar"] is None
    headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.get("/api/me", headers=headers).json()["avatar"] is None


def test_avatar_set_keep_and_reset(client, pg_engine):
    headers = _auth_headers(client, pg_engine)
    r = client.patch("/api/me", json={"avatar": "fox"}, headers=headers)
    assert r.status_code == 200 and r.json()["avatar"] == "fox"
    # a patch that does not mention avatar keeps it
    r = client.patch("/api/me", json={"display_name": "Newname"}, headers=headers)
    assert r.json()["avatar"] == "fox" and r.json()["display_name"] == "Newname"
    assert client.get("/api/me", headers=headers).json()["avatar"] == "fox"
    # explicit null resets to the default
    r = client.patch("/api/me", json={"avatar": None}, headers=headers)
    assert r.status_code == 200 and r.json()["avatar"] is None


def test_avatar_and_nickname_saved_together(client, pg_engine):
    headers = _auth_headers(client, pg_engine)
    r = client.patch("/api/me", json={"avatar": "koi", "display_name": "  A B "},
                     headers=headers)
    assert r.json()["avatar"] == "koi" and r.json()["display_name"] == "A B"


def test_unknown_avatar_is_a_field_level_400_and_changes_nothing(client, pg_engine):
    headers = _auth_headers(client, pg_engine)
    client.patch("/api/me", json={"avatar": "owl"}, headers=headers)
    r = client.patch("/api/me", json={"avatar": "../etc/passwd",
                                      "display_name": "Hacker"}, headers=headers)
    assert r.status_code == 400
    assert r.json()["detail"]["field"] == "avatar"
    me = client.get("/api/me", headers=headers).json()
    assert me["avatar"] == "owl" and me["display_name"] != "Hacker"


def test_avatar_patch_requires_session(client):
    assert client.patch("/api/me", json={"avatar": "fox"}).status_code == 401
