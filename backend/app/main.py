from fastapi import FastAPI

from app import env_file
from app.api.admin_auth import router as admin_auth_router
from app.api.visits import router as visits_router
from app.api.admin_dashboard import router as admin_dashboard_router
from app.api.admin_exams import router as admin_exams_router
from app.api.auth_student import router as auth_student_router
from app.api.content import router as content_router
from app.api.media import router as media_router
from app.api.mock_exam import router as mock_exam_router
from app.api.practice import router as practice_router
from app.api.learning import router as learning_router
from app.api.topic_practice import router as topic_practice_router

app = FastAPI(title="JLPT GO 2.0 API", version="0.1.0")

# backend/.env (mail keys etc.) loads before anything reads the environment;
# surface a clear notice when mail would silently fall back to the dev log.
env_file.load_env_file()
env_file.warn_if_mail_unconfigured()

app.include_router(admin_auth_router)
app.include_router(admin_exams_router)
app.include_router(admin_dashboard_router)
app.include_router(visits_router)
app.include_router(auth_student_router)
app.include_router(content_router)
app.include_router(media_router)
app.include_router(mock_exam_router)
app.include_router(practice_router)
app.include_router(topic_practice_router)
app.include_router(learning_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Process liveness only; NOT a database readiness check."""
    return {"status": "ok", "service": "nhg-manabi-v2"}
