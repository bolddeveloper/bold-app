FROM node:22-bookworm-slim AS codex-runtime
ARG CODEX_VERSION=0.166.0-alpha.6
RUN npm install --global --ignore-scripts "@openai/codex@${CODEX_VERSION}" \
    && find /usr/local/lib/node_modules/@openai -type f -path '*/vendor/*/bin/codex' -exec install -m 755 '{}' /codex \; \
    && /codex --version

FROM python:3.11-slim-bookworm AS backend-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --gid 10001 boldapp \
    && useradd --uid 10001 --gid boldapp --no-create-home --shell /usr/sbin/nologin boldapp

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

COPY --chown=boldapp:boldapp . .

RUN DJANGO_DEBUG=true SECRET_KEY=container-build-only python manage.py collectstatic --noinput

USER boldapp

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "scripts/container_healthcheck.py"]

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]

FROM backend-base AS support
USER root
COPY --from=codex-runtime /codex /usr/local/bin/codex
RUN mkdir -p /var/lib/bold-support/codex \
    && chown -R boldapp:boldapp /var/lib/bold-support \
    && chmod 700 /var/lib/bold-support/codex
ENV CODEX_HOME=/var/lib/bold-support/codex
USER boldapp
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["python", "scripts/support_healthcheck.py"]
CMD ["python", "manage.py", "run_support_bot"]

FROM backend-base AS backend
