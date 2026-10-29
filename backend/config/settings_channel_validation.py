"""Ephemeral localhost-only acceptance harness. Never a deployment setting."""
import os
from pathlib import Path
import tempfile
from django.core.exceptions import ImproperlyConfigured
from .settings_test import *  # noqa: F403

_root = Path(os.environ.get("BOLD_CHANNEL_VALIDATION_DIR", "")).resolve()
if _root.parent != Path(tempfile.gettempdir()).resolve() or not _root.name.startswith("bold-channel-validation-") or not _root.is_dir():
    raise ImproperlyConfigured("Start with python -m boldApp.mensajeria.channel_validation; isolated temp directory required")
DATABASES = {"default": {**DATABASES["default"], "NAME": _root / "validation.sqlite3"}}  # noqa: F405
SECRET_KEY = "isolated-local-channel-validation-not-a-deployment-secret"
AUTH_ENCRYPTION_KEY = 'synthetic-local-media-outbox:' + str(_root)
AUTH_MFA_REQUIRED = False  # Fictitious accounts only; production is unchanged.
SEED_DEMO_ACCOUNTS = False
SEED_PRIVILEGED_DEMO_ACCOUNTS = False
GOOGLE_WORKSPACE_CLIENT_ID = ""
GOOGLE_WORKSPACE_CLIENT_SECRET = ""
MESSAGING_PILOT_ENABLED = True
MESSAGING_PILOT_UNIT_IDS = ("11111111-2222-4333-8444-555555555551", "11111111-2222-4333-8444-555555555552")
AUTH_SESSION_COOKIE_NAME = "bold_channel_validation"
CSRF_COOKIE_NAME = "bold_channel_validation_csrf"
CORS_ALLOWED_ORIGINS = ["http://127.0.0.1:5192", "http://localhost:5192"]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
AUTH_PASSWORD_MIN_LENGTH = 12
