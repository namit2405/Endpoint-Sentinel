FROM node:22-alpine AS frontend-build

WORKDIR /src/frontend
COPY frontend/src/frontend/package.json frontend/src/frontend/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate && pnpm install --frozen-lockfile
COPY frontend/src/frontend/ ./
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN ./node_modules/.bin/vite build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

WORKDIR /app/Backend
COPY Backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY Backend/ ./
COPY --from=frontend-build /src/frontend/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/endpoint-sentinel.conf
COPY docker/entrypoint.sh /usr/local/bin/endpoint-sentinel-entrypoint
RUN chmod +x /usr/local/bin/endpoint-sentinel-entrypoint \
    && mkdir -p /app/Backend/staticfiles /app/Backend/Reports

EXPOSE 8001 5174
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import socket; socket.create_connection(('127.0.0.1', 5174), 3).close()"

ENTRYPOINT ["/usr/local/bin/endpoint-sentinel-entrypoint"]
