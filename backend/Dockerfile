FROM python:3.11-slim-bookworm

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
