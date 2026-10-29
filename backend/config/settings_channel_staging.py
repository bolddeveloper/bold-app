"""Opt-in localhost PostgreSQL acceptance, with real Google authorization later.

Unlike channel_validation this mode does not emulate Drive. It deliberately
starts without Google credentials/accounts; they must be authorized separately.
No ordinary backend .env database, OAuth client, mail or Redis is used.
"""
import base64
import logging
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

from .settings_test import *  # noqa: F403

_root = Path(os.environ.get("BOLD_CHANNEL_STAGING_DIR", "")).resolve()
_url = os.environ.get("BOLD_TEST_DATABASE_URL", "")
try:
    _database = urlsplit(_url)
    _port = _database.port
    _valid_database = (_database.scheme in {"postgres", "postgresql"}
        and _database.hostname == "127.0.0.1" and _port and 1024 <= _port <= 65535
        and _database.username == "bold_validation_admin" and bool(_database.password)
        and _database.path == "/bold_validation" and not _database.query and not _database.fragment)
except ValueError:
    _valid_database = False
_allowed_parents = {Path(tempfile.gettempdir()).resolve()}
_local_data = os.environ.get('LOCALAPPDATA', '')
if _local_data and Path(_local_data).is_absolute():
    _allowed_parents.add((Path(_local_data) / 'BOLDApp' / 'validation').resolve())
if (_root.parent not in _allowed_parents
        or not re.fullmatch(r"bold-channel-postgres-[a-f0-9]{32}", _root.name)
        or not _root.is_dir() or not _valid_database):
    raise ImproperlyConfigured("Use the isolated PostgreSQL staging preparation script, not a production database.")
_secret_file = (_root / "staging-secret.txt").resolve()
if _secret_file.parent != _root or not _secret_file.is_file():
    raise ImproperlyConfigured("Missing isolated staging secrets; run -Action PrepareStaging first.")
_secrets = _secret_file.read_text(encoding="utf-8").strip()
if not re.fullmatch(r"[A-F0-9]{64}:[A-F0-9]{64}", _secrets):
    raise ImproperlyConfigured("Invalid isolated staging secret format.")
_signing, _encryption = _secrets.split(":")

DATABASES = {"default": dj_database_url.parse(_url, conn_max_age=0)}
DATABASES["default"]["TEST"] = {"NAME": "test_bold_validation"}
SECRET_KEY = _signing
AUTH_ENCRYPTION_KEY = base64.urlsafe_b64encode(bytes.fromhex(_encryption)).decode("ascii")
PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]
SEED_DEMO_ACCOUNTS = False
SEED_PRIVILEGED_DEMO_ACCOUNTS = False
AUTH_MFA_REQUIRED = False  # Only synthetic local identities; connector step-up is NOT bypassed.
AUTH_SESSION_COOKIE_NAME = "bold_channel_staging"
SESSION_COOKIE_NAME = "bold_channel_staging_django"
CSRF_COOKIE_NAME = "bold_channel_staging_csrf"
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
FRONTEND_URL = "http://127.0.0.1:5193"
CORS_ALLOWED_ORIGINS = [FRONTEND_URL, "http://localhost:5193"]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

class _StagingQueryFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, dict) and isinstance(record.args.get("path"), str):
            record.args = {**record.args, "path":record.args["path"].split("?",1)[0]}
        return True

LOGGING = {"version":1,"disable_existing_loggers":False,
    "filters":{"staging_query":{"()":_StagingQueryFilter}},"loggers":{
    # OAuth callback query strings contain a short-lived code; do not log them.
    "django.server":{"level":"WARNING"},"daphne.server":{"level":"WARNING"},"daphne.access":{"level":"WARNING"},
    "django.channels.server":{"level":"WARNING","filters":["staging_query"]}}}
TRUST_CLOUDFLARE_CONNECTING_IP = False
GOOGLE_WORKSPACE_CLIENT_ID = ""
GOOGLE_WORKSPACE_CLIENT_SECRET = ""
GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES = ("drive",)
GOOGLE_WORKSPACE_REDIRECT_URI = FRONTEND_URL + "/api/v2/workspace/oauth/callback/"
GOOGLE_WORKSPACE_COMPANY_DOMAIN = "bold.gt"
GOOGLE_WORKSPACE_EDITORS_ENABLED = False
GOOGLE_CALENDAR_CLIENT_ID = ""
GOOGLE_CALENDAR_CLIENT_SECRET = ""
GOOGLE_CALENDAR_REDIRECT_URI = ""
EMAIL_HOST_USER = ""
EMAIL_HOST_PASSWORD = ""
SHEETS_PILOT_ENABLED = False
SHEETS_ENGINE_URL = ""
SHEETS_ENGINE_TOKEN = ""
MESSAGING_PILOT_ENABLED = True
MESSAGING_PILOT_UNIT_IDS = ("11111111-2222-4333-8444-555555555551", "11111111-2222-4333-8444-555555555552")
# In-memory channel layer/cache/mail/broker come from settings_test. One process
# only: this does not certify a distributed Redis/Celery deployment.
