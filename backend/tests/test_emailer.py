"""Resend transport: User-Agent header, proxy bypass, error detail (ADR-0011)."""
import io
import urllib.error

import pytest

from app import emailer, env_file


class _Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_send_sets_user_agent_and_bearer(monkeypatch):
    seen = {}

    def fake_open(req, timeout):
        seen.update(dict(req.header_items()))
        return _Resp()

    monkeypatch.setattr(emailer._OPENER, "open", fake_open)
    emailer._send_resend("k", "a@b.test", "c@d.test", "s", "t")
    assert seen["User-agent"].startswith("jlptgo-backend")
    assert seen["Authorization"] == "Bearer k"


def test_http_error_carries_provider_detail(monkeypatch, capsys):
    def boom(req, timeout):
        raise urllib.error.HTTPError(
            req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"name":"x"}'))

    monkeypatch.setattr(emailer._OPENER, "open", boom)
    monkeypatch.setenv("RESEND_API_KEY", "k")
    monkeypatch.setenv("MAIL_FROM", "a@b.test")
    emailer.send_email("c@d.test", "s", "t")  # must not raise
    assert '{"name":"x"}' in capsys.readouterr().err


def test_env_file_does_not_override_real_environment(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("# c\nFOO_T=from_file\nBAR_T='q'\nbad line\n")
    monkeypatch.setenv("FOO_T", "real")
    monkeypatch.delenv("BAR_T", raising=False)
    loaded = env_file.load_env_file(f)
    assert loaded == ["BAR_T"]
    import os
    assert os.environ["FOO_T"] == "real" and os.environ["BAR_T"] == "q"
    monkeypatch.delenv("BAR_T")
