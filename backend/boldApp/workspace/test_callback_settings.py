"""Deployment defaults, isolated from developer .env and external services."""
import os
import subprocess
import sys
from pathlib import Path
from django.test import SimpleTestCase


class CallbackSettingsTests(SimpleTestCase):
    def callback(self, debug, explicit="", frontend="https://boldapp.boldapp-93b.workers.dev/"):
        environment = dict(os.environ, DJANGO_DEBUG=debug, FRONTEND_URL=frontend,
                           GOOGLE_WORKSPACE_REDIRECT_URI=explicit, DATABASE_URL="sqlite:///:memory:")
        return subprocess.check_output(
            [sys.executable, "-c", "from config.settings import GOOGLE_WORKSPACE_REDIRECT_URI; print(GOOGLE_WORKSPACE_REDIRECT_URI)"],
            cwd=Path(__file__).resolve().parents[2], env=environment, text=True,
        ).strip()

    def test_production_uses_public_frontend_origin(self):
        self.assertEqual(self.callback("false"), "https://boldapp.boldapp-93b.workers.dev/api/v2/workspace/oauth/callback/")

    def test_development_preserves_local_callback(self):
        self.assertEqual(self.callback("true"), "http://localhost:8000/api/v2/workspace/oauth/callback/")

    def test_explicit_callback_takes_precedence(self):
        self.assertEqual(self.callback("false", "https://api.example.com/api/v2/workspace/oauth/callback/"),
                         "https://api.example.com/api/v2/workspace/oauth/callback/")
