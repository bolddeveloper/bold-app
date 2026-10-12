"""Opt-in PostgreSQL validation, restricted to an explicitly isolated database.

Use BOLD_TEST_DATABASE_URL, never DATABASE_URL or the deployed database. Docker
validation hosts are named bold-validation-*. No external cache/mail/channels.
"""
import os
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

from .settings_test import *  # noqa: F403

_url = os.environ.get("BOLD_TEST_DATABASE_URL", "")
_parts = urlsplit(_url)
if (_parts.scheme not in {"postgres", "postgresql"} or _parts.path != "/bold_validation"
        or not (_parts.hostname in {"localhost", "127.0.0.1"} or (_parts.hostname or "").startswith("bold-validation-"))):
    raise ImproperlyConfigured("Use an isolated bold_validation PostgreSQL database via BOLD_TEST_DATABASE_URL")
DATABASES = {"default": dj_database_url.parse(_url, conn_max_age=0)}
DATABASES["default"]["TEST"] = {"NAME": "test_bold_validation"}
