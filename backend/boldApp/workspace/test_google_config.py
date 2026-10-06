"""Configuration and account isolation regressions; no real Google changes."""
import io
import json
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory
from boldApp.core.models import UserAccount, JobRole
from boldApp.autenticacion.services import create_session, encrypt_secret, decrypt_secret
from boldApp.administrativo.models import SystemAuditEvent
from boldApp.calendario.models import CalendarDraft, GoogleCalendarConnection
from boldApp.calendario.tasks import cleanup_calendar_drafts
from .google_config import configuration, SCOPES
from .models import GoogleOAuthConfiguration, GoogleConnection
from .service import google


@override_settings(DEBUG=True, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], GOOGLE_WORKSPACE_CLIENT_ID="original.apps.googleusercontent.com", GOOGLE_WORKSPACE_CLIENT_SECRET="server-secret", GOOGLE_WORKSPACE_REDIRECT_URI="http://localhost:8000/api/v2/workspace/oauth/callback/", AUTH_ENCRYPTION_KEY="")
class GoogleConfigurationTests(TestCase):
    def setUp(self):
        call_command("seed_demo_data", verbosity=0, stdout=io.StringIO())
        self.owner = UserAccount.objects.get(email="luis@bold.gt")
        self.member = UserAccount.objects.get(email="samuel@bold.gt")
        self.clients = {}
        self.sessions = {}
        for user in (self.owner, self.member):
            _, session = create_session(user, APIRequestFactory().get("/"))
            if user.is_superuser:
                session.auth_strength = "password_totp"
                session.mfa_verified_at = timezone.now()
                session.save(update_fields=["auth_strength", "mfa_verified_at"])
            self.sessions[user.pk] = session
            client = APIClient(); client.force_authenticate(user, session)
            client.credentials(HTTP_X_ASSIGNMENT_ID=str(user.employee.position_assignments.get(is_active=True, released_at__isnull=True).id))
            self.clients[user.pk] = client
        self.client = self.clients[self.owner.pk]
        self.url = "/api/v2/google/configuration/"

    def delegate_member(self, recent_mfa=True, direction=True, connector_access=True):
        assignment = self.member.employee.position_assignments.get(is_active=True, released_at__isnull=True)
        role = JobRole.objects.create(title="Asistente técnico", administration_enabled=True)
        assignment.position.job_role = role
        if direction:
            assignment.position.unit = self.owner.employee.position_assignments.get(is_active=True, released_at__isnull=True).position.unit
        assignment.position.save(update_fields=["job_role", "unit"])
        self.member.can_manage_connectors = connector_access
        self.member.save(update_fields=["can_manage_connectors"])
        session = self.sessions[self.member.pk]
        if recent_mfa:
            session.auth_strength = "password_totp"
            session.mfa_verified_at = timezone.now()
            session.save(update_fields=["auth_strength", "mfa_verified_at"])
        return assignment, role

    def test_other_administrators_are_denied_without_individual_connector_access(self):
        self.delegate_member(connector_access=False)
        self.client = self.clients[self.member.pk]
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.upload().status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url + "verify/", {}, format="json").status_code, 403)

    def test_individual_access_revocation_takes_effect_immediately(self):
        self.delegate_member()
        self.client = self.clients[self.member.pk]
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.member.can_manage_connectors = False
        self.member.save(update_fields=["can_manage_connectors"])
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_support_bootstrap_is_individual_audited_and_idempotent(self):
        import importlib
        from django.apps import apps
        from django.db import connection
        bootstrap = importlib.import_module("boldApp.core.migrations.0017_account_connector_delegation").authorize_existing_support
        self.delegate_member(connector_access=False)
        self.member.email = "soporte@bold.gt"
        self.member.save(update_fields=["email"])
        from types import SimpleNamespace
        editor = SimpleNamespace(connection=connection)
        bootstrap(apps, editor)
        bootstrap(apps, editor)
        self.member.refresh_from_db()
        self.assertTrue(self.member.can_manage_connectors)
        self.assertFalse(self.member.is_superuser)
        self.assertFalse(UserAccount.objects.exclude(pk=self.member.pk).filter(can_manage_connectors=True).exists())
        self.assertEqual(SystemAuditEvent.objects.filter(event_type="google.connector_access_provisioned", target_id=self.member.pk).count(), 1)

    def test_delegated_administrator_can_manage_configuration_without_becoming_owner(self):
        assignment, role = self.delegate_member()
        self.client = self.clients[self.member.pk]
        self.assertEqual(self.client.get(self.url).status_code, 200)
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("uploaded-secret", response.content.decode())
        self.assertEqual(self.client.post(self.url + "verify/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        for event_type in ("google.configuration_updated", "google.configuration_removed"):
            self.assertTrue(SystemAuditEvent.objects.filter(event_type=event_type, actor_account=self.member).exists())
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_superuser)
        role.administration_enabled = False
        role.save(update_fields=["administration_enabled"])
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_connectors_require_direction_and_recent_mfa_for_every_mutation(self):
        self.delegate_member(recent_mfa=False)
        self.client = self.clients[self.member.pk]
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.upload().status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url + "verify/", {}, format="json").status_code, 403)
        self.assertFalse(GoogleOAuthConfiguration.objects.exists())
        owner_session = self.sessions[self.owner.pk]
        owner_session.mfa_verified_at = timezone.now() - timedelta(hours=1)
        owner_session.save(update_fields=["mfa_verified_at"])
        self.client = self.clients[self.owner.pk]
        self.assertEqual(self.upload().status_code, 403)

    def test_administrative_role_outside_direction_and_staff_have_no_connector_access(self):
        self.delegate_member(direction=False)
        self.member.is_staff = True
        self.member.save(update_fields=["is_staff"])
        self.client = self.clients[self.member.pk]
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.upload().status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)

    def upload(self, data=None, identity="original.apps.googleusercontent.com"):
        data = data if data is not None else {"web": {"client_id": identity, "client_secret": "uploaded-secret", "project_id": "bold-demo", "redirect_uris": ["http://localhost:8000/api/v2/workspace/oauth/callback/"]}}
        return self.client.put(self.url, {"file": SimpleUploadedFile("google.json", json.dumps(data).encode(), "application/json")}, format="multipart")

    def connect(self, user, scopes=None):
        return GoogleConnection.objects.create(user=user, email=user.email, subject=str(user.pk), client_id="original.apps.googleusercontent.com", scopes=" ".join(scopes or SCOPES["calendar"]), refresh_token_encrypted=encrypt_secret("refresh"), access_token_encrypted=encrypt_secret("token-" + str(user.pk)), expires_at=timezone.now()+timedelta(hours=1))

    def test_owner_uploads_official_json_encrypted_without_returning_secret(self):
        self.connect(self.member)
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        row = GoogleOAuthConfiguration.objects.get()
        self.assertNotEqual(row.client_secret_encrypted, "uploaded-secret")
        self.assertEqual(decrypt_secret(row.client_secret_encrypted), "uploaded-secret")
        self.assertNotIn("uploaded-secret", response.content.decode())
        self.assertTrue(GoogleConnection.objects.filter(user=self.member).exists())
        for method in ("get", "delete"):
            self.assertEqual(getattr(self.clients[self.member.pk], method)(self.url).status_code, 403)
        self.assertEqual(self.clients[self.member.pk].put(self.url, {}, format="multipart").status_code, 403)

    @patch("boldApp.workspace.oauth.requests.get")
    @patch("boldApp.workspace.oauth.requests.post")
    def test_incremental_callback_retains_refresh_and_uses_only_granted_permissions(self, exchange, profile):
        connection = self.connect(self.owner, SCOPES["drive"])
        start = self.client.post("/api/v2/workspace/oauth/start/", {"service": "tasks"}, format="json")
        state = parse_qs(urlparse(start.data["authorization_url"]).query)["state"][0]
        exchange.return_value = Mock(json=lambda: {"access_token": "extended", "scope": " ".join(SCOPES["drive"] | SCOPES["tasks"]), "expires_in": 3600})
        profile.return_value = Mock(json=lambda: {"email": self.owner.email, "email_verified": True, "sub": str(self.owner.pk)})
        response = self.client.get("/api/v2/workspace/oauth/callback/", {"state": state, "code": "test"})
        self.assertContains(response, '"connected"')
        connection.refresh_from_db()
        self.assertEqual(decrypt_secret(connection.refresh_token_encrypted), "refresh")
        result = self.client.get("/api/v2/workspace/connection/").data
        self.assertEqual(result["services"]["tasks"]["status"], "available")
        self.assertEqual(result["services"]["calendar"]["status"], "authorization_required")
        # A configuration replacement invalidates an outstanding OAuth state before exchanging its code.
        start = self.client.post("/api/v2/workspace/oauth/start/", {"service": "calendar"}, format="json")
        state = parse_qs(urlparse(start.data["authorization_url"]).query)["state"][0]
        self.upload(); exchange.reset_mock()
        self.assertContains(self.client.get("/api/v2/workspace/oauth/callback/", {"state": state, "code": "test"}), '"failed"')
        exchange.assert_not_called()

    def test_invalid_json_callback_and_size_leave_configuration_unchanged(self):
        for value in ({"installed": {}}, {"web": {"client_id": "bad"}}, {"web": {"client_id": "x.apps.googleusercontent.com", "client_secret": "secret", "redirect_uris": "http://localhost:8000/api/v2/workspace/oauth/callback/"}}):
            self.assertEqual(self.upload(value).status_code, 400)
        self.assertEqual(self.client.put(self.url, {"file": SimpleUploadedFile("google.json", b"x" * 65537)}, format="multipart").status_code, 400)
        self.assertFalse(GoogleOAuthConfiguration.objects.exists())

    def test_client_change_disconnects_accounts_and_delete_never_restores_env(self):
        self.connect(self.owner); self.connect(self.member)
        self.assertEqual(self.upload(identity="new.apps.googleusercontent.com").status_code, 200)
        self.assertFalse(GoogleConnection.objects.exists())
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.assertFalse(configuration()["configured"])
        self.assertEqual(self.client.post("/api/v2/workspace/oauth/start/", {}).status_code, 400)
        self.assertEqual(self.upload().status_code, 200)
        self.assertTrue(configuration()["configured"])

    @patch("boldApp.workspace.service.requests.request")
    def test_calendar_tasks_contacts_use_only_requesting_accounts_token(self, request):
        granted = set().union(*SCOPES.values())
        self.connect(self.member, granted); self.connect(self.owner, granted)
        response = Mock(status_code=200, content=b"{}"); response.json.return_value = {"items": []}
        request.return_value = response
        routes = [("events/", {"start": "2026-10-01T00:00:00Z", "end": "2026-10-02T00:00:00Z"}), ("task-lists/", {}), ("contacts/", {"q": "samuel"})]
        for user in (self.owner, self.member):
            for path, params in routes:
                request.reset_mock()
                result = self.clients[user.pk].get("/api/v2/calendar/" + path, params)
                self.assertEqual(result.status_code, 200, result.data)
                self.assertTrue(request.called)
                for call in request.call_args_list:
                    self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer token-" + str(user.pk))

    @patch("boldApp.workspace.service.requests.request")
    def test_disabled_api_verification_and_missing_permissions_are_distinct(self, request):
        self.connect(self.owner, SCOPES["calendar"])
        response = Mock(status_code=403, text='{"reason":"SERVICE_DISABLED"}', content=b"{}")
        request.return_value = response
        result = self.client.post(self.url + "verify/", {}, format="json")
        self.assertEqual(result.data["services"]["calendar"]["status"], "api_disabled")
        self.assertEqual(result.data["services"]["tasks"]["status"], "authorization_required")

    def test_unified_oauth_requests_all_supported_services(self):
        result = self.clients[self.member.pk].post("/api/v2/workspace/oauth/start/", {"service": "tasks"}, format="json")
        values = parse_qs(urlparse(result.data["authorization_url"]).query)
        self.assertEqual(values["include_granted_scopes"], ["true"])
        self.assertIn(next(iter(SCOPES["tasks"])), values["scope"][0])
        self.assertEqual(set(values["scope"][0].split()), {"openid", "email"} | set().union(*SCOPES.values()))

    @patch("boldApp.calendario.tasks.google_request")
    def test_legacy_drafts_and_changed_accounts_are_never_cleaned_by_another_token(self, request):
        connection = self.connect(self.member)
        GoogleCalendarConnection.objects.create(email="shared@bold.gt", refresh_token_encrypted="legacy")
        for options in ({}, {"connection": connection, "google_subject": "another-account"}):
            draft = CalendarDraft.objects.create(event_id="draft-"+str(len(options)), owner=self.member, calendar_email="shared@bold.gt", **options)
            CalendarDraft.objects.filter(pk=draft.pk).update(last_seen_at=timezone.now()-timedelta(minutes=5))
        cleanup_calendar_drafts(); request.assert_not_called()
        self.assertEqual(CalendarDraft.objects.count(), 2)
