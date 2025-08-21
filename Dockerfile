FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps (optional): build and cleanup
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose Gunicorn port
EXPOSE 5000

# Persist saves outside container if volume is mounted
RUN mkdir -p /app/saves

# Default command (override in docker-compose if needed)
# Use threaded workers so SSE (long-lived) and API POSTs can coexist
# 1 worker with 16 threads, no timeout for SSE
CMD ["gunicorn", "-w", "1", "--worker-class", "gthread", "--threads", "16", "--timeout", "0", "-b", "0.0.0.0:5000", "wsgi:app"]
