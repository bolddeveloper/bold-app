"""Fail-closed settings checks; never open a database or contact Google."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid


class ChannelStagingSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="bold-channel-postgres-" + uuid.uuid4().hex)
        # The production guard accepts an exact UUID suffix, not arbitrary temp names.
        self.root = Path(self.directory.name).with_name("bold-channel-postgres-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(self.root.rmdir)
        self.secret = self.root / "staging-secret.txt"
        self.secret.write_text("A" * 64 + ":" + "B" * 64, encoding="utf-8")
        self.addCleanup(self.secret.unlink, missing_ok=True)
        self.addCleanup(self.directory.cleanup)
        self.env = dict(os.environ,
            BOLD_CHANNEL_STAGING_DIR=str(self.root),
            BOLD_TEST_DATABASE_URL="postgresql://bold_validation_admin:synthetic@127.0.0.1:55432/bold_validation",
            DATABASE_URL="postgresql://production.invalid/real",
            SECRET_KEY="inherited-production-key", AUTH_ENCRYPTION_KEY="inherited-encryption-key",
            GOOGLE_WORKSPACE_CLIENT_ID="inherited-client", GOOGLE_WORKSPACE_CLIENT_SECRET="inherited-secret",
            GOOGLE_WORKSPACE_REDIRECT_URI="https://production.invalid/callback/",
            GOOGLE_CALENDAR_CLIENT_SECRET="inherited-calendar-secret", EMAIL_HOST_PASSWORD="inherited-mail-secret")

    def load(self, env=None):
        code = """
import json
import logging
from config import settings_channel_staging as s
record=logging.LogRecord('django.channels.server',logging.WARNING,'',0,'HTTP %(path)s',
 ({'path':'/api/v2/workspace/oauth/callback/?code=synthetic-code&state=synthetic-state'},),None)
s._StagingQueryFilter().filter(record)
print(json.dumps({
 'database':s.DATABASES['default']['NAME'], 'host':s.DATABASES['default']['HOST'],
 'signing_is_local':s.SECRET_KEY=='A'*64, 'encryption_is_local':s.AUTH_ENCRYPTION_KEY!='inherited-encryption-key',
 'google_blank':not(s.GOOGLE_WORKSPACE_CLIENT_ID or s.GOOGLE_WORKSPACE_CLIENT_SECRET or s.GOOGLE_CALENDAR_CLIENT_SECRET),
 'mail_blank':not s.EMAIL_HOST_PASSWORD, 'callback':s.GOOGLE_WORKSPACE_REDIRECT_URI,
 'seed':s.SEED_DEMO_ACCOUNTS or s.SEED_PRIVILEGED_DEMO_ACCOUNTS,
 'cookie':s.AUTH_SESSION_COOKIE_NAME, 'hashers':s.PASSWORD_HASHERS,
 'mail':s.EMAIL_BACKEND, 'channels':s.CHANNEL_LAYERS['default']['BACKEND'],
 'broker':s.CELERY_BROKER_URL, 'pilot':s.MESSAGING_PILOT_ENABLED,
 'sheets_disabled':not s.SHEETS_ENGINE_URL and not s.SHEETS_ENGINE_TOKEN,
 'hosts':s.ALLOWED_HOSTS, 'allowed_google_services':s.GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES,
 'callback_query_redacted':record.getMessage()=='HTTP /api/v2/workspace/oauth/callback/'
}))
"""
        return subprocess.run([sys.executable,"-c",code], cwd=Path(__file__).resolve().parents[1],
            env=env or self.env, text=True, capture_output=True, timeout=15)

    def reject(self, **updates):
        result = self.load(dict(self.env, **updates))
        self.assertNotEqual(result.returncode,0)
        self.assertIn("ImproperlyConfigured",result.stderr)
        self.assertNotIn("inherited-production-key",result.stderr)
        self.assertNotIn("inherited-secret",result.stderr)
        self.assertNotIn("postgresql://",result.stderr)

    def test_valid_settings_isolate_secrets_services_cookies_and_pilot(self):
        result=self.load()
        self.assertEqual(result.returncode,0,result.stderr)
        data=json.loads(result.stdout)
        self.assertEqual(data['database'],'bold_validation')
        self.assertEqual(data['host'],'127.0.0.1')
        for key in ('signing_is_local','encryption_is_local','google_blank','mail_blank','pilot','sheets_disabled','callback_query_redacted'):
            self.assertTrue(data[key],key)
        self.assertFalse(data['seed'])
        self.assertEqual(data['callback'],'http://127.0.0.1:5193/api/v2/workspace/oauth/callback/')
        self.assertEqual(data['cookie'],'bold_channel_staging')
        self.assertEqual(data['hashers'],['django.contrib.auth.hashers.PBKDF2PasswordHasher'])
        self.assertEqual(data['mail'],'django.core.mail.backends.locmem.EmailBackend')
        self.assertEqual(data['channels'],'channels.layers.InMemoryChannelLayer')
        self.assertEqual(data['broker'],'memory://')
        self.assertEqual(data['hosts'],['localhost','127.0.0.1'])
        self.assertEqual(data['allowed_google_services'],['drive'])

    def test_remote_database_is_rejected(self):
        self.reject(BOLD_TEST_DATABASE_URL=self.env['BOLD_TEST_DATABASE_URL'].replace('127.0.0.1','production.invalid'))

    def test_other_database_name_is_rejected(self):
        self.reject(BOLD_TEST_DATABASE_URL=self.env['BOLD_TEST_DATABASE_URL'].replace('/bold_validation','/bold_app'))

    def test_other_user_or_database_options_are_rejected(self):
        for url in (self.env['BOLD_TEST_DATABASE_URL'].replace('bold_validation_admin','postgres'),
                self.env['BOLD_TEST_DATABASE_URL']+'?options=unsafe'):
            with self.subTest(url=url): self.reject(BOLD_TEST_DATABASE_URL=url)

    def test_missing_url_is_rejected_without_inheriting_database_url(self):
        self.reject(BOLD_TEST_DATABASE_URL='')

    def test_unknown_directory_is_rejected(self):
        self.reject(BOLD_CHANNEL_STAGING_DIR=self.directory.name)

    def test_persistent_private_profile_has_an_exact_parent_and_same_database_guards(self):
        with tempfile.TemporaryDirectory() as local_data:
            base=Path(local_data)/'BOLDApp'/'validation'
            root=base/('bold-channel-postgres-'+uuid.uuid4().hex)
            root.mkdir(parents=True)
            (root/'staging-secret.txt').write_text('A'*64+':'+'B'*64,encoding='utf-8')
            env=dict(self.env,LOCALAPPDATA=local_data,BOLD_CHANNEL_STAGING_DIR=str(root))
            self.assertEqual(self.load(env).returncode,0)
            wrong=dict(env,BOLD_TEST_DATABASE_URL=env['BOLD_TEST_DATABASE_URL'].replace('/bold_validation','/production'))
            self.assertNotEqual(self.load(wrong).returncode,0)
            wrong=dict(env,LOCALAPPDATA=str(Path(local_data)/'different-user'))
            self.assertNotEqual(self.load(wrong).returncode,0)

    def test_missing_or_malformed_secret_is_rejected(self):
        self.secret.unlink()
        self.reject()
        self.secret.write_text('not-a-valid-key',encoding='utf-8')
        self.reject()

    def test_invalid_port_is_rejected(self):
        self.reject(BOLD_TEST_DATABASE_URL=self.env['BOLD_TEST_DATABASE_URL'].replace(':55432/',':invalid/'))


if __name__=='__main__':
    unittest.main()
