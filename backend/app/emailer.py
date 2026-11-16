"""Transactional email via the Resend HTTP API (ADR-0011).

Production requires RESEND_API_KEY + MAIL_FROM (+ APP_BASE_URL for
links). Without RESEND_API_KEY (local development) the mail body is
appended to .local/dev-email.log so verification/reset links stay
testable; nothing raises on provider failure — registration and login
never depend on mail delivery succeeding.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

_API = "https://api.resend.com/emails"
_LOCAL_LOG = Path(".local/dev-email.log")


def _send_resend(api_key: str, mail_from: str, to: str, subject: str,
                 text: str) -> None:
    body = json.dumps({"from": mail_from, "to": [to], "subject": subject,
                       "text": text}).encode("utf-8")
    req = urllib.request.Request(
        _API, data=body, method="POST",
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"resend status {resp.status}")


def _log_dev(to: str, subject: str, text: str) -> None:
    _LOCAL_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _LOCAL_LOG.open("a", encoding="utf-8") as fh:
        fh.write(f"--- to={to} subject={subject}\n{text}\n")


def send_email(to: str, subject: str, text: str) -> None:
    """Best-effort send: logs instead of raising when no provider is
    configured or the provider fails."""
    api_key = os.environ.get("RESEND_API_KEY")
    mail_from = os.environ.get("MAIL_FROM")
    if not api_key or not mail_from:
        print(f"[emailer] dev mail to {to}: {subject}\n{text}", file=sys.stderr)
        try:
            _log_dev(to, subject, text)
        except OSError:
            pass
        return
    try:
        _send_resend(api_key, mail_from, to, subject, text)
    except Exception as exc:  # noqa: BLE001 — mail must never break auth
        print(f"[emailer] send failed ({exc}): {subject} -> {to}",
              file=sys.stderr)


def verification_email(app_base_url: str, token: str) -> tuple[str, str]:
    subject = "JLPT GO 邮箱验证"
    link = f"{app_base_url}/verify-email?token={token}"
    text = ("欢迎注册 JLPT GO！请打开以下链接完成邮箱验证（24 小时内有效）：\n\n"
            f"{link}\n\n如果这不是你本人的操作，请忽略本邮件。")
    return subject, text


def reset_email(app_base_url: str, token: str) -> tuple[str, str]:
    subject = "JLPT GO 重置密码"
    link = f"{app_base_url}/reset-password?token={token}"
    text = ("你（或有人）申请了重置 JLPT GO 账户密码。请打开以下链接设置新密码"
            "（1 小时内有效）：\n\n"
            f"{link}\n\n如果这不是你本人的操作，请忽略本邮件，账户不会受影响。")
    return subject, text
