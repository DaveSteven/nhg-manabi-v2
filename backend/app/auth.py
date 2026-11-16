"""Minimal user identity boundary for the study/answer domain (M2 Task 03).

Rules enforced here:

- `user_id` is ALWAYS resolved server-side from the Authorization header.
  No endpoint may accept a client-supplied user_id for identity purposes.
- Default mode is fail-closed: without an explicitly configured mechanism,
  every authenticated request gets 401. Production never falls back to a
  permissive default.
- The only mechanism implemented today is the dev/test bearer mode
  (AUTH_MODE=dev_test): the token IS the user's UUID and must be listed in
  DEV_TEST_USER_IDS. It is hard-disabled when APP_ENV=production, so the
  test identity mechanism cannot leak into a production deployment.
- Swapping in a real auth system later means replacing this dependency only;
  endpoints keep consuming `get_current_user_id`.
"""
import os
from uuid import UUID

from fastapi import Header, HTTPException
from fastapi.security.utils import get_authorization_scheme_param


class NotAuthenticated(HTTPException):
    def __init__(self, detail: str = "authentication required") -> None:
        super().__init__(status_code=401, detail=detail)


def get_current_user_id(
    authorization: str | None = Header(default=None),
) -> UUID:
    """FastAPI dependency resolving the caller's identity server-side."""
    mode = os.environ.get("AUTH_MODE")
    if mode == "dev_test":
        if os.environ.get("APP_ENV") == "production":
            # The test identity mechanism must never work in production.
            raise NotAuthenticated("dev_test auth disabled in production")
        scheme, token = get_authorization_scheme_param(authorization)
        if scheme.lower() != "bearer" or not token:
            raise NotAuthenticated("bearer token required")
        allowed = {
            s.strip() for s in
            os.environ.get("DEV_TEST_USER_IDS", "").split(",") if s.strip()
        }
        if token not in allowed:
            raise NotAuthenticated("unknown user token")
        try:
            return UUID(token)
        except ValueError as exc:
            raise NotAuthenticated("user token must be a UUID") from exc
    # No mechanism configured (or unknown mode): fail closed, always.
    raise NotAuthenticated("authentication not configured")
