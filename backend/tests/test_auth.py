"""M2 Task 03 tests: minimal user identity boundary (app/auth.py)."""
import os
from uuid import uuid4

import pytest

USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


def resolve(monkeypatch, header=None, **env):
    from app.auth import get_current_user_id
    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    return get_current_user_id(authorization=header)


def test_fail_closed_without_configured_mechanism(monkeypatch):
    with pytest.raises(Exception) as exc:
        resolve(monkeypatch, header=f"Bearer {USER_A}",
                AUTH_MODE=None, APP_ENV=None)
    assert getattr(exc.value, "status_code", None) == 401


def test_dev_test_mode_resolves_listed_uuid(monkeypatch):
    uid = resolve(monkeypatch, header=f"Bearer {USER_A}",
                  AUTH_MODE="dev_test", APP_ENV="development",
                  DEV_TEST_USER_IDS=f"{USER_A},{USER_B}")
    assert str(uid) == USER_A


def test_dev_test_mode_rejects_unlisted_token(monkeypatch):
    stranger = str(uuid4())
    with pytest.raises(Exception) as exc:
        resolve(monkeypatch, header=f"Bearer {stranger}",
                AUTH_MODE="dev_test", APP_ENV=None,
                DEV_TEST_USER_IDS=f"{USER_A},{USER_B}")
    assert getattr(exc.value, "status_code", None) == 401


def test_dev_test_mode_rejects_missing_or_malformed_header(monkeypatch):
    for header in (None, "Basic abc", f"bearer-not-a-uuid"):
        with pytest.raises(Exception) as exc:
            resolve(monkeypatch, header=header, AUTH_MODE="dev_test",
                    APP_ENV=None, DEV_TEST_USER_IDS=USER_A)
        assert getattr(exc.value, "status_code", None) == 401


def test_dev_test_mode_hard_disabled_in_production(monkeypatch):
    with pytest.raises(Exception) as exc:
        resolve(monkeypatch, header=f"Bearer {USER_A}",
                AUTH_MODE="dev_test", APP_ENV="production",
                DEV_TEST_USER_IDS=USER_A)
    assert getattr(exc.value, "status_code", None) == 401


def test_practice_endpoint_requires_auth(monkeypatch):
    """Endpoint-level: no auth configured -> 401 before any DB access."""
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.delenv("AUTH_MODE", raising=False)
    client = TestClient(app)
    resp = client.post("/api/practice/sessions", json={
        "feedback_mode": "immediate", "units": []})
    assert resp.status_code == 401
