"""Load backend/.env on startup (ADR-0011 mail config).

uvicorn does not read .env files by itself, and the documented dev start
command only sources ../.env (database) — so RESEND_API_KEY / MAIL_FROM /
APP_BASE_URL placed in backend/.env were silently ignored and
verification/reset mail fell back to backend/.local/dev-email.log.

Values are only set when the variable is not already present in the real
environment, so explicit shell exports and CI keep precedence. Malformed
lines are skipped, never fatal.
"""
import os
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env_file(path: Path | None = None) -> list[str]:
    path = path or ENV_FILE
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    loaded: list[str] = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        loaded.append(key)
    return loaded


def warn_if_mail_unconfigured() -> None:
    if not os.environ.get("RESEND_API_KEY"):
        print(
            "[config] RESEND_API_KEY 未配置：注册验证/找回密码邮件不会真实发送，"
            "链接将写入 backend/.local/dev-email.log（仅限本地开发）。",
            file=sys.stderr,
        )

