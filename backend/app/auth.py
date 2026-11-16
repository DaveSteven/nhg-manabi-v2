"""User identity boundary for the study/answer domain.

Rules enforced here (ADR-0006 boundary, ADR-0011 implementation):

- `user_id` is ALWAYS resolved server-side from the Authorization header.
  No endpoint may accept a client-supplied user_id for identity purposes.
- A bearer token is first matched against real student sessions
  (user_sessions, ADR-0011). On no match, the dev/test bearer mode
  (AUTH_MODE=dev_test) may resolve the token as a listed UUID — hard-
  disabled in production. Anything unresolved is a uniform 401.
- Swapping auth systems means replacing this dependency only; endpoints
  keep consuming `get_current_user_id`.
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
    scheme, token = get_authorization_scheme_param(authorization)
    if scheme.lower() == "bearer" and token:
        from app.db.engine import get_engine
        from app.student_auth import authenticate_token

        session = authenticate_token(get_engine(), token)
        if session is not None:
            return UUID(str(session["id"]))
    mode = os.environ.get("AUTH_MODE")
    if mode == "dev_test":
        if os.environ.get("APP_ENV") == "production":
            # The test identity mechanism must never work in production.
            raise NotAuthenticated("dev_test auth disabled in production")
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
    # No session and no configured mechanism: fail closed, always.
    raise NotAuthenticated("authentication required")
