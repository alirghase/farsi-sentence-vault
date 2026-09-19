# Slim runtime; the service is I/O-bound on the Gemini API, not CPU-bound.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so layer caching survives source edits.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# core/ is shared with the seed generator — the service and the offline tooling
# use identical prompts, taxonomy, and validation.
COPY core/ ./core/
COPY backend/ ./backend/

# Run as a non-root user.
RUN useradd --create-home --uid 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Cloud Run injects PORT; default for local runs.
ENV PORT=8080
EXPOSE 8080

# Single worker: Cloud Run scales by instance, not by in-process workers, and
# the free-tier Gemini pacer is per-process state.
CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --workers 1
