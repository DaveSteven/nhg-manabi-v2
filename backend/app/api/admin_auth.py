"""Admin authentication endpoints (ADR-0009). No dev bypass."""
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel

from app.admin_auth import (AdminAuthError, _bearer, login, logout,
                            require_admin)
from app.db.engine import get_engine

router = APIRouter()


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/api/admin/auth/login")
def admin_login(body: LoginBody) -> dict:
    try:
        return login(get_engine(), body.username.strip().lower(), body.password)
    except AdminAuthError:
        # Same response for unknown user, wrong password, locked, inactive.
        raise HTTPException(status_code=401, detail="invalid credentials")


@router.get("/api/admin/auth/me")
def admin_me(admin: dict = Depends(require_admin("viewer"))) -> dict:
    return {"id": str(admin["id"]), "username": admin["username"],
            "display_name": admin["display_name"], "role": admin["role"]}


@router.post("/api/admin/auth/logout", status_code=204)
def admin_logout(authorization: str | None = Header(default=None),
                 admin: dict = Depends(require_admin("viewer"))) -> Response:
    token = _bearer(authorization)
    if token:
        logout(get_engine(), token)
    return Response(status_code=204)
