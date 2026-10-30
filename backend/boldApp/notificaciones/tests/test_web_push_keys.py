import base64
import io
import os
from pathlib import Path
import tempfile
from cryptography.hazmat.primitives import serialization
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase


class WebPushKeyGenerationTests(SimpleTestCase):
    def test_keypair_is_compatible_persistent_private_and_never_overwritten_or_printed(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "private.env"
            output = io.StringIO()
            call_command("generate_web_push_keys", output=str(destination), stdout=output)
            before = destination.read_bytes()
            config = dict(line.split("=", 1) for line in before.decode().splitlines())
            self.assertTrue(config["WEB_PUSH_PRIVATE_KEY"] not in output.getvalue(), "Private material must not be printed")
            private = serialization.load_der_private_key(base64.urlsafe_b64decode(config["WEB_PUSH_PRIVATE_KEY"]), None)
            public = base64.urlsafe_b64decode(config["WEB_PUSH_PUBLIC_KEY"] + "=")
            self.assertEqual(private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint), public)
            if os.name == "posix": self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(CommandError): call_command("generate_web_push_keys", output=str(destination), stdout=io.StringIO())
            self.assertEqual(destination.read_bytes(), before)

    def test_contact_rejects_environment_file_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "private.env"
            with self.assertRaises(CommandError):
                call_command("generate_web_push_keys", output=str(destination), subject="mailto:a@bold.gt\nOTHER=value", stdout=io.StringIO())
            self.assertFalse(destination.exists())
