from fastapi import FastAPI

from app.api.content import router as content_router
from app.api.practice import router as practice_router

app = FastAPI(title="JLPT GO 2.0 API", version="0.1.0")
app.include_router(content_router)
app.include_router(practice_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Process liveness only; NOT a database readiness check."""
    return {"status": "ok", "service": "nhg-manabi-v2"}
