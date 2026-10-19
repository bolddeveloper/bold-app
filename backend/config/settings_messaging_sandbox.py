"""Opt-in LOCAL synthetic chat sandbox. Never use for a public deployment."""
from .settings_test import *  # noqa: F403
from pathlib import Path

# Deliberately fixed and ignored by Git. Never inherit DATABASE_URL or OAuth,
# Redis, mail and worker services from a developer/production environment.
DATABASES = {"default": {**DATABASES["default"], "NAME": Path(__file__).resolve().parent.parent / "db.messaging-sandbox.sqlite3"}}  # noqa: F405
AUTH_MFA_REQUIRED = False  # Synthetic accounts only, not a production policy.
AUTH_SESSION_COOKIE_NAME = "bold_chat_sandbox"
CSRF_COOKIE_NAME = "bold_chat_sandbox_csrf"
CORS_ALLOWED_ORIGINS = ["http://127.0.0.1:5186", "http://localhost:5186"]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
AUTH_PASSWORD_MIN_LENGTH = 12
