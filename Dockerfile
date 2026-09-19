# ── Backend ────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS backend

WORKDIR /app/backend

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code (data/ excluded via .dockerignore — audit F-C2-01)
COPY backend/ .

# NOTE: no build-time init_db/seed here — the entrypoint initializes the
# data volume at first run (the DB built in this stage was thrown away).


# ── Frontend build ─────────────────────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build


# ── Production image ──────────────────────────────────────────────────────
FROM python:3.12-slim AS production

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ ./backend/

# Copy built frontend — served by the API process itself (audit F-C2-02)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Initialize DB + seed on first run
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

# Audit F-C2-04: run as a non-root user; the data volume must be writable.
RUN useradd --create-home --shell /bin/bash appuser     && mkdir -p /app/backend/data     && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3     CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)"

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
