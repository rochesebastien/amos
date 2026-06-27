# syntax=docker/dockerfile:1

# ----------------------------------------------------------------------------
# Stage 1 — build the React/Vite frontend into static assets
# ----------------------------------------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /app/frontend

# Install deps first (better layer caching). .npmrc carries legacy-peer-deps,
# required by @shadcn/react on this React 18 project.
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 2 — FastAPI backend that also serves the built frontend
# ----------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    CHEVELUAI_DB=/data/cheveluai.db \
    CHEVELUAI_STATIC=/app/static

WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Built frontend from stage 1, served by FastAPI (see app/main.py)
COPY --from=frontend /app/frontend/dist /app/static

# SQLite lives on a persistent volume so data survives redeploys
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
