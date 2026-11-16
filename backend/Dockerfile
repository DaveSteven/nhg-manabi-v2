FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv/backend
COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
RUN pip install .
# uvicorn without --reload; migrations run in the separate `migrate` service.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
