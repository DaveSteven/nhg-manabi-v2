"""Visit ping: records that the signed-in student was active on a given
Asia/Tokyo day (dashboard visit-active metric). Idempotent, stores no IP,
user-agent or page path."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy import text

from app.auth import get_current_user_id
from app.db.engine import get_engine

router = APIRouter()


@router.post("/api/me/visit", status_code=204)
def record_visit(user_id=Depends(get_current_user_id)) -> Response:
    with get_engine().begin() as conn:
        conn.execute(text(
            "INSERT INTO user_visit_days (user_id, visit_date)"
            " VALUES (:u, (now() AT TIME ZONE 'Asia/Tokyo')::date)"
            " ON CONFLICT DO NOTHING"), {"u": str(user_id)})
    return Response(status_code=204)
