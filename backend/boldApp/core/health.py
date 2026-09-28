import os

from django.db import connection
from django.http import JsonResponse
from redis import Redis


def health(request):
    """Checks the dependencies required to serve authenticated HTTP and WebSockets."""
    checks = {"database": False, "redis": False}

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            checks["database"] = cursor.fetchone() == (1,)
    except Exception:
        pass

    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        checks["redis"] = True
    else:
        try:
            client = Redis.from_url(redis_url, socket_connect_timeout=1, socket_timeout=1)
            checks["redis"] = bool(client.ping())
        except Exception:
            pass

    ready = all(checks.values())
    response = JsonResponse(
        {"status": "ok" if ready else "unavailable", "checks": checks},
        status=200 if ready else 503,
    )
    response["Cache-Control"] = "no-store"
    return response
