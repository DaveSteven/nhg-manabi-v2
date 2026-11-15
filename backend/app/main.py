from fastapi import FastAPI

app = FastAPI(title="JLPT GO 2.0 API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """Process liveness only; NOT a database readiness check."""
    return {"status": "ok", "service": "nhg-manabi-v2"}
