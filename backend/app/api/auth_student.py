"""Student account endpoints (ADR-0011).

- Registration/login/logout, email verification + password reset flows,
  and the /api/me profile. Field-level input problems return 400 with
  {"detail": {"field", "message"}}; every authentication failure is the
  same 401 without stating which factor failed or whether the account
  exists; resend-verification / forgot-password always answer 200 so
  account existence never leaks.
- Identity for /api/me comes from the session bearer token, never from
  the client body.
"""
import os
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from fastapi.security.utils import get_authorization_scheme_param

from app import emailer, student_auth
from app.db.engine import get_engine

router = APIRouter()


class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class TokenIn(BaseModel):
    token: str


class EmailIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str


class MeUpdate(BaseModel):
    display_name: str | None = None
    current_level: str | None = None
    avatar: str | None = None  # sent as null = reset to default avatar


def _base_url() -> str:
    return os.environ.get("APP_BASE_URL", "http://localhost:5173").rstrip("/")


def _input_error(exc: student_auth.StudentInputError) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"field": exc.field, "message": exc.message})


def _auth_error() -> HTTPException:
    return HTTPException(status_code=401, detail="邮箱或密码错误，或账户未验证")


def current_session(
    authorization: str | None = Header(default=None),
) -> dict:
    """Dependency: resolve the caller's student session server-side."""
    scheme, token = get_authorization_scheme_param(authorization)
    session = (student_auth.authenticate_token(get_engine(), token)
               if scheme.lower() == "bearer" else None)
    if session is None:
        raise HTTPException(status_code=401, detail="authentication required")
    return session


@router.post("/api/auth/register")
def register(body: RegisterIn) -> dict:
    try:
        token = student_auth.register(get_engine(), body.email, body.password,
                                      body.display_name)
    except student_auth.StudentInputError as exc:
        raise _input_error(exc) from exc
    subject, text = emailer.verification_email(_base_url(), token)
    emailer.send_email(body.email.strip().lower(), subject, text)
    return {"status": "ok"}


@router.post("/api/auth/login")
def login(body: LoginIn) -> dict:
    try:
        return student_auth.login(get_engine(), body.email, body.password)
    except student_auth.StudentAuthError as exc:
        raise _auth_error() from exc


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)) -> dict:
    scheme, token = get_authorization_scheme_param(authorization)
    student_auth.logout(get_engine(), token if scheme.lower() == "bearer" else "")
    return {"status": "ok"}


@router.post("/api/auth/verify-email")
def verify_email(body: TokenIn) -> dict:
    try:
        return student_auth.verify_email(get_engine(), body.token)
    except student_auth.StudentAuthError as exc:
        raise HTTPException(status_code=400,
                            detail="验证链接无效或已过期") from exc


@router.post("/api/auth/resend-verification")
def resend_verification(body: EmailIn) -> dict:
    token = student_auth.resend_verification(get_engine(), body.email)
    if token is not None:
        subject, text = emailer.verification_email(_base_url(), token)
        emailer.send_email(body.email.strip().lower(), subject, text)
    return {"status": "ok"}


@router.post("/api/auth/forgot-password")
def forgot_password(body: EmailIn) -> dict:
    token = student_auth.forgot_password(get_engine(), body.email)
    if token is not None:
        subject, text = emailer.reset_email(_base_url(), token)
        emailer.send_email(body.email.strip().lower(), subject, text)
    return {"status": "ok"}


@router.post("/api/auth/reset-password")
def reset_password(body: ResetIn) -> dict:
    try:
        student_auth.reset_password(get_engine(), body.token, body.password)
    except student_auth.StudentInputError as exc:
        raise _input_error(exc) from exc
    except student_auth.StudentAuthError as exc:
        raise HTTPException(status_code=400,
                            detail="重置链接无效或已过期") from exc
    return {"status": "ok"}


def _profile_payload(profile: dict) -> dict:
    return {
        "id": str(profile["id"]),
        "email": profile["email"],
        "display_name": profile["display_name"],
        "current_level": profile["current_level"],
        "avatar": profile.get("avatar"),
        "activated": profile.get("activated_at") is not None,
    }


@router.get("/api/me")
def get_me(session: dict = Depends(current_session)) -> dict:
    try:
        profile = student_auth.get_profile(get_engine(), UUID(str(session["id"])))
    except student_auth.StudentAuthError as exc:
        raise HTTPException(status_code=401,
                            detail="authentication required") from exc
    return _profile_payload(profile)


@router.patch("/api/me")
def update_me(body: MeUpdate,
              session: dict = Depends(current_session)) -> dict:
    try:
        profile = student_auth.update_profile(
            get_engine(), UUID(str(session["id"])), body.display_name,
            body.current_level,
            body.avatar if "avatar" in body.model_fields_set
            else student_auth.UNSET)
    except student_auth.StudentInputError as exc:
        raise _input_error(exc) from exc
    except student_auth.StudentAuthError as exc:
        raise HTTPException(status_code=401,
                            detail="authentication required") from exc
    return _profile_payload(profile)
