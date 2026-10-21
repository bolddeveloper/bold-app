"""A local Drive acceptance client must never request unrelated Google access."""
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit
import uuid

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import Employee, UserAccount


@override_settings(GOOGLE_WORKSPACE_CLIENT_ID="isolated-test.apps.googleusercontent.com",
    GOOGLE_WORKSPACE_CLIENT_SECRET="synthetic-only", GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES=None)
class OAuthScopeLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        account=UserAccount.objects.create_user(email="oauth-scope-test@bold.gt",employee=Employee.objects.create(full_name="OAuth test"))
        session=AuthSession.objects.create(user_account=account,token_hash=uuid.uuid4().hex,
            credentials_version=account.credentials_version,expires_at=timezone.now()+timedelta(hours=1))
        self.client=APIClient()
        self.client.force_authenticate(account,token=session)

    def start(self,service="all"):
        return self.client.post("/api/v2/workspace/oauth/start/",{"service":service},format="json")

    def query(self,result):
        self.assertEqual(result.status_code,200,result.data)
        return parse_qs(urlsplit(result.data["authorization_url"]).query)

    def test_existing_production_consent_is_unchanged_without_restrictions(self):
        query=self.query(self.start())
        scopes=set(query["scope"][0].split())
        self.assertIn("https://www.googleapis.com/auth/gmail.readonly",scopes)
        self.assertIn("https://www.googleapis.com/auth/calendar.events",scopes)
        self.assertNotIn("https://www.googleapis.com/auth/meetings.space.created",scopes)
        self.assertEqual(query["include_granted_scopes"],["true"])

    @override_settings(GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES=("drive",))
    def test_staging_all_and_drive_request_only_drive_and_identity(self):
        for service in ("all","drive"):
            query=self.query(self.start(service))
            self.assertEqual(set(query["scope"][0].split()),{"openid","email","https://www.googleapis.com/auth/drive"})
            self.assertEqual(query["include_granted_scopes"],["false"])

    @override_settings(GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES=("drive",))
    def test_unrelated_services_are_rejected_before_an_authorization_url(self):
        for service in ("gmail","calendar","contacts","meet","docs","tasks"):
            with self.subTest(service=service):
                response=self.start(service)
                self.assertEqual(response.status_code,400,response.data)
                self.assertNotIn("authorization_url",response.data)

    def test_empty_unknown_or_string_allowlists_cannot_fall_back_to_full_consent(self):
        for allowed in ((),("unknown",),"drive",("drive",None)):
            with self.subTest(allowed=allowed),self.settings(GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES=allowed):
                self.assertEqual(self.start().status_code,400)

    @override_settings(GOOGLE_WORKSPACE_OAUTH_ALLOWED_SERVICES=("drive","calendar","meet"))
    def test_explicit_selection_is_narrow_and_all_keeps_meet_opt_in(self):
        drive=self.query(self.start("drive"))
        self.assertEqual(set(drive["scope"][0].split()),{"openid","email","https://www.googleapis.com/auth/drive"})
        all_services=self.query(self.start())
        self.assertNotIn("https://www.googleapis.com/auth/meetings.space.created",all_services["scope"][0])
        meet=self.query(self.start("meet"))
        self.assertEqual(set(meet["scope"][0].split()),{"openid","email","https://www.googleapis.com/auth/meetings.space.created"})
