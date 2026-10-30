"""Owned localhost browser acceptance. No production database, mail or Google.

Prepared by prepare_multitasking_acceptance.py in a dedicated LocalAppData root.
One ASGI process and an in-memory channel layer: not a distributed load test.
"""
import json
import os
from pathlib import Path
import re
from django.core.exceptions import ImproperlyConfigured
from .settings_test import *  # noqa: F403

_root = Path(os.environ.get("BOLD_MULTITASKING_ACCEPTANCE_DIR", "")).resolve()
_parent = (Path(os.environ.get("LOCALAPPDATA", "")) / "BOLDApp" / "validation").resolve()
if _root.parent != _parent or not re.fullmatch(r"pwa-multitasking-[a-f0-9]{32}", _root.name) or not _root.is_dir():
    raise ImproperlyConfigured("Prepare the isolated multitasking browser profile first.")
_keys = json.loads((_root / "private-settings.json").read_text(encoding="utf-8"))
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": str(_root / "acceptance.sqlite3"), "OPTIONS": {"timeout": 20}}}
SECRET_KEY, AUTH_ENCRYPTION_KEY = _keys["signing"], _keys["encryption"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]
AUTH_SESSION_COOKIE_NAME = "bold_multitasking_acceptance"
AUTH_SESSION_IDLE_SECONDS = 0
AUTH_MFA_REQUIRED = False
# These three synthetic accounts deliberately log out/in many times in the
# acceptance flow. Keep throttling enabled with a test-only rate; production
# account/IP limits and their own regression tests are unchanged.
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {  # noqa: F405
    **REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "auth_login_ip": "120/min", "auth_login_account": "60/min",  # noqa: F405
}}
SEED_DEMO_ACCOUNTS = SEED_PRIVILEGED_DEMO_ACCOUNTS = False
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
FRONTEND_URL = "http://127.0.0.1:5195"
CORS_ALLOWED_ORIGINS = [FRONTEND_URL, "http://localhost:5195"]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
SECURE_SSL_REDIRECT = SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = False
TRUST_CLOUDFLARE_CONNECTING_IP = False
WEB_PUSH_ENABLED = True
WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY = _keys["push_public"], _keys["push_private"]
WEB_PUSH_SUBJECT = "mailto:soporte@bold.gt"
CELERY_TASK_ALWAYS_EAGER = True  # No provider delivery without an explicit test drain.
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}, "presence": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
EMAIL_HOST_USER = EMAIL_HOST_PASSWORD = ""
GOOGLE_WORKSPACE_CLIENT_ID = GOOGLE_WORKSPACE_CLIENT_SECRET = GOOGLE_WORKSPACE_REDIRECT_URI = ""
GOOGLE_CALENDAR_CLIENT_ID = GOOGLE_CALENDAR_CLIENT_SECRET = GOOGLE_CALENDAR_REDIRECT_URI = ""
GOOGLE_WORKSPACE_EDITORS_ENABLED = False
SHEETS_ENGINE_URL = SHEETS_ENGINE_TOKEN = ""
SHEETS_PILOT_ENABLED = True
SHEETS_PILOT_UNIT_IDS = ()
MESSAGING_PILOT_ENABLED = True
MESSAGING_PILOT_UNIT_IDS = ("10000000-0000-4000-8000-000000000001",)
LOGGING = {"version": 1, "disable_existing_loggers": False,
    "loggers": {"django.server": {"level": "WARNING"}, "daphne.server": {"level": "WARNING"},
        "daphne.access": {"level": "WARNING"}, "django.channels.server": {"level": "WARNING"}}}
