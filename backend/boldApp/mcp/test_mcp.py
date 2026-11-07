import base64
import hashlib
import json
from datetime import timedelta
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import parse_qs, urlsplit
from unittest import skipUnless
from unittest.mock import patch

import httpx2
from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from django.urls import path
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.test import APIClient
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import token_hash
from boldApp.core.models import Employee, JobRole, OrganizationalUnit, Position, PositionAssignment, UserAccount
from .authentication import validate_authorization
from .catalog import MODULES, operations
from .dispatcher import execute
from .models import McpAccessToken, McpAuthorization, McpClient, McpRefreshToken
from .oauth import BoldOAuthProvider, resource_url


class UploadEchoView(APIView):
    def post(self, request):
        file = request.FILES["file"]
        return Response({"in_memory": isinstance(file.file, BytesIO), "value": file.read().decode()})


@override_settings(
    MCP_ENABLED=True, MCP_PUBLIC_ORIGIN="http://127.0.0.1:8000",
    BOLD_SUPPORT_ENABLED=False,
    DEBUG=True, SECURE_SSL_REDIRECT=False, AUTH_MFA_REQUIRED=False,
    ALLOWED_HOSTS=["testserver", "127.0.0.1"], AUTH_NUM_PROXIES=0,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
            "mcp": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION":"bold-mcp-tests"}},
)
class McpTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        from django.core.cache import caches
        caches['mcp'].clear()
        self.user = UserAccount.objects.create_user(
            email="mcp-prueba@bold.gt", employee=Employee.objects.create(full_name="Prueba MCP"),
        )
        self.assignment = PositionAssignment.objects.create(
            employee=self.user.employee,
            position=Position.objects.create(
                unit=OrganizationalUnit.objects.create(name="Equipo MCP", unit_type="department"),
                job_role=JobRole.objects.create(title="Colaborador"),
            ),
        )
        self.session_raw = "sesion-solo-pruebas"
        self.session = AuthSession.objects.create(
            user_account=self.user, token_hash=token_hash(self.session_raw),
            credentials_version=self.user.credentials_version,
            expires_at=timezone.now() + timedelta(hours=2),
        )
        self.client_row = McpClient.objects.create(id="test-client", metadata={
            "client_id": "test-client", "client_name": "Cliente de pruebas",
            "redirect_uris": ["http://127.0.0.1:9999/callback"],
            "token_endpoint_auth_method": "none",
            "scope": "bold.read bold.write",
            "grant_types": ["authorization_code", "refresh_token"],
        })
        self.grant = McpAuthorization.objects.create(
            request_hash=token_hash("solicitud"),
            client=self.client_row, session=self.session, assignment=self.assignment,
            parameters={}, scopes=["bold.read", "bold.write"],
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        self.raw = "acceso-solo-pruebas"
        self.access = McpAccessToken.objects.create(
            token_hash=token_hash(self.raw), authorization=self.grant,
            expires_at=timezone.now() + timedelta(hours=1),
        )

    def api(self, *, csrf=False):
        client = APIClient(enforce_csrf_checks=csrf)
        client.cookies["bold_session"] = self.session_raw
        return client

    def http(self, method, path, **kwargs):
        from config.asgi import application

        async def send():
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=application), base_url="http://127.0.0.1:8000",
            ) as client:
                return await client.request(method, path, **kwargs)
        return async_to_sync(send)()

    def authorized_tokens(self):
        verifier = "a" * 50
        self.grant.code_hash = token_hash("codigo-pruebas")
        self.grant.parameters = {
            "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode(),
            "redirect_uri": "http://127.0.0.1:9999/callback", "redirect_uri_provided_explicitly": True,
        }
        self.grant.save()
        response = self.http("POST", "/api/v2/mcp/oauth/token", data={
            "grant_type": "authorization_code", "client_id": self.client_row.pk,
            "code": "codigo-pruebas", "code_verifier": verifier,
            "redirect_uri": "http://127.0.0.1:9999/callback", "resource": resource_url(),
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.grant.refresh_from_db()
        return response.json()

    def refresh(self, token, **extra):
        return self.http("POST", "/api/v2/mcp/oauth/token", data={
            "grant_type": "refresh_token", "client_id": self.client_row.pk,
            "refresh_token": token, "resource": resource_url(), **extra,
        })

    def test_catalog_covers_content_modules_and_excludes_credential_flows(self):
        rows = list(operations().values())
        self.assertTrue(set(MODULES) - {"home", "reports"} <= {row.module for row in rows})
        self.assertGreater(len(rows), 100)
        for row in rows:
            self.assertNotIn("/oauth/", row.path)
            self.assertNotIn("/ticket/", row.path)
            self.assertNotIn("/phone-transfers/", row.path)
            self.assertNotIn("/mcp/", row.path)
            self.assertNotIn("/auth/password/", row.path)

    def test_read_runs_existing_views_with_the_account_identity(self):
        result = execute(self.grant, "get_auth_profile")
        self.assertEqual(result["status"], 200)
        self.assertIn(self.user.email, json.dumps(result))
        self.assertNotIn(self.session_raw, json.dumps(result))

    def test_write_and_description_reach_normal_profile_entry_points(self):
        result = execute(self.grant, "patch_auth_profile", data={"biography": "Modificado por MCP"}, write=True)
        self.assertEqual(result["status"], 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.biography, "Modificado por MCP")
        schema = execute(self.grant, "patch_auth_profile", describe=True)
        self.assertEqual(schema["status"], 200)

    def test_read_grant_and_operation_tools_cannot_escalate_to_writes(self):
        self.grant.scopes = ["bold.read"]
        self.grant.save()
        with self.assertRaises(ValidationError):
            execute(self.grant, "patch_auth_profile", data={}, write=True)
        with self.assertRaises(ValidationError):
            execute(self.grant, "patch_auth_profile")
        with self.assertRaises(ValidationError):
            execute(self.grant, "get_auth_profile", headers={"Authorization": "anything"})

    def test_session_revocation_credentials_and_assignments_are_live(self):
        for field, value in [("revoked_at", timezone.now()), ("credentials_version", self.user.credentials_version + 1)]:
            original = getattr(self.session, field)
            setattr(self.session, field, value)
            with self.assertRaises(AuthenticationFailed):
                validate_authorization(self.grant)
            setattr(self.session, field, original)
        self.assignment.is_active = False
        with self.assertRaises(AuthenticationFailed):
            validate_authorization(self.grant)

    def test_invalid_resource_and_path_are_rejected(self):
        with self.assertRaises(ValidationError):
            execute(self.grant, "get_tasks_pk", path_parameters={"pk": "../auth/profile"})
        with self.assertRaises(ValidationError):
            execute(self.grant, "get_auth_password")

    def test_discovery_401_pkce_and_code_replay(self):
        response = self.http("POST", "/api/v2/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        self.assertEqual(response.status_code, 401, response.text)
        self.assertIn("/.well-known/oauth-protected-resource/api/v2/mcp", response.headers["www-authenticate"])
        metadata = self.http("GET", "/.well-known/oauth-authorization-server/api/v2/mcp/oauth", headers={"Origin": "https://client.example"})
        self.assertEqual(metadata.status_code, 200, metadata.text)
        self.assertEqual(metadata.headers['cache-control'], 'no-store')
        self.assertEqual(metadata.headers['referrer-policy'], 'no-referrer')
        self.assertEqual(metadata.headers.get("access-control-allow-origin"), "*")
        self.assertEqual(metadata.json()["grant_types_supported"], ["authorization_code", "refresh_token"])
        verifier = "a" * 50
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        response = self.http("GET", "/api/v2/mcp/oauth/authorize", params={
            "client_id": self.client_row.pk, "response_type": "code",
            "redirect_uri": "http://127.0.0.1:9999/callback", "code_challenge": challenge,
            "code_challenge_method": "S256", "resource": resource_url(),
            "scope": "bold.read bold.write", "state": "vinculo-usuario",
        })
        self.assertIn(response.status_code, (302, 303), response.text)
        location = response.headers["location"]
        self.assertIn("/api/v2/mcp/consent/", location)
        response = self.api().post(
            location, {"decision": "allow", "assignment": str(self.assignment.pk), "write": "yes"},
        )
        self.assertEqual(response.status_code, 302, response.content)
        code = parse_qs(urlsplit(response["Location"]).query)["code"][0]
        payload = {
            "grant_type": "authorization_code", "client_id": self.client_row.pk,
            "code": code, "code_verifier": "b" * 50,
            "redirect_uri": "http://127.0.0.1:9999/callback", "resource": resource_url(),
        }
        bad = self.http("POST", "/api/v2/mcp/oauth/token", data=payload)
        self.assertEqual(bad.status_code, 400, bad.text)
        payload["code_verifier"] = verifier
        success = self.http("POST", "/api/v2/mcp/oauth/token", data=payload)
        self.assertEqual(success.status_code, 200, success.text)
        self.assertNotIn(success.json()["access_token"], list(McpAccessToken.objects.values_list("token_hash", flat=True)))
        replay = self.http("POST", "/api/v2/mcp/oauth/token", data=payload)
        self.assertEqual(replay.status_code, 400, replay.text)

    def test_refresh_survives_browser_cutoff_with_hashes_and_fixed_lifetime(self):
        before = timezone.now()
        tokens = self.authorized_tokens()
        self.assertEqual(self.grant.source_session_id, self.session.pk)
        self.assertNotEqual(self.grant.session_id, self.session.pk)
        connection_expiry = self.grant.session.expires_at
        self.assertGreaterEqual(self.grant.session.expires_at, before + timedelta(days=30))
        self.assertLessEqual(self.grant.session.expires_at, timezone.now() + timedelta(days=30))
        self.assertEqual(self.grant.session.mfa_verified_at, self.session.mfa_verified_at)
        self.assertEqual(self.grant.session.credentials_version, self.session.credentials_version)
        self.assertLessEqual(tokens["expires_in"], 3600)
        self.assertEqual(McpRefreshToken.objects.get().token_hash, token_hash(tokens["refresh_token"]))
        self.assertNotEqual(McpRefreshToken.objects.get().token_hash, tokens["refresh_token"])
        self.session.expires_at = timezone.now() - timedelta(seconds=1)
        self.session.idle_expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save()
        expired_browser = self.api().get("/api/v2/auth/session/")
        self.assertFalse(expired_browser.data["authenticated"])
        self.session.refresh_from_db()
        self.assertEqual(self.session.revocation_reason, "expired")
        self.assertIsNotNone(self.session.revoked_at)
        McpAccessToken.objects.filter(token_hash=token_hash(tokens["access_token"])).update(expires_at=timezone.now())
        renewed = self.refresh(tokens["refresh_token"])
        self.assertEqual(renewed.status_code, 200, renewed.text)
        self.assertEqual(renewed.headers["cache-control"], "no-store")
        fresh = renewed.json()
        self.assertNotEqual(fresh["refresh_token"], tokens["refresh_token"])
        self.assertNotEqual(fresh["access_token"], tokens["access_token"])
        self.grant.refresh_from_db()
        self.assertEqual(self.grant.session.expires_at, connection_expiry)
        self.assertEqual(self.session.expires_at, AuthSession.objects.get(pk=self.session.pk).expires_at)
        result = self.http("POST", "/api/v2/mcp", headers={
            "Authorization": "Bearer " + fresh["access_token"], "Accept": "application/json, text/event-stream",
        }, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                 "params": {"name": "bold_read", "arguments": {"operation": "get_auth_profile"}}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn(self.user.email, result.text)
        self.assertFalse(result.json()["result"].get("isError", False))

    def test_refresh_replay_revokes_the_entire_connection(self):
        tokens = self.authorized_tokens()
        renewed = self.refresh(tokens["refresh_token"])
        self.assertEqual(renewed.status_code, 200, renewed.text)
        self.assertEqual(self.refresh(tokens["refresh_token"]).json()["error"], "invalid_grant")
        self.grant.refresh_from_db()
        self.assertIsNotNone(self.grant.revoked_at)
        self.assertEqual(self.refresh(renewed.json()["refresh_token"]).json()["error"], "invalid_grant")
        denied = self.http("POST", "/api/v2/mcp", headers={"Authorization": "Bearer " + renewed.json()["access_token"]})
        self.assertEqual(denied.status_code, 401)

    def test_refresh_cannot_change_client_or_scopes(self):
        tokens = self.authorized_tokens()
        McpClient.objects.create(id="otro-cliente", metadata={**self.client_row.metadata, "client_id": "otro-cliente"})
        denied = self.refresh(tokens["refresh_token"], client_id="otro-cliente")
        self.assertEqual(denied.json()["error"], "invalid_grant")
        for scope in ("bold.read", "bold.read bold.write otros.permisos"):
            denied = self.refresh(tokens["refresh_token"], scope=scope)
            self.assertEqual(denied.json()["error"], "invalid_scope")
        self.assertIsNone(McpRefreshToken.objects.get().consumed_at)
        self.assertEqual(self.refresh(tokens["refresh_token"]).status_code, 200)

    def test_refresh_and_access_keep_revocation_account_assignment_and_mfa_checks(self):
        tokens = self.authorized_tokens()
        changes = [
            (self.session, "revoked_at", timezone.now()),
            (self.grant.session, "revoked_at", timezone.now()),
            (self.user, "credentials_version", self.user.credentials_version + 1),
            (self.user, "is_active", False),
            (self.user, "must_change_password", True),
            (self.assignment, "is_active", False),
            (self.grant.session, "expires_at", timezone.now() - timedelta(seconds=1)),
        ]
        for row, field, value in changes:
            with self.subTest(field=field, model=type(row).__name__):
                original = getattr(row, field)
                setattr(row, field, value)
                row.save(update_fields=[field])
                self.assertEqual(self.refresh(tokens["refresh_token"]).json()["error"], "invalid_grant")
                denied = self.http("POST", "/api/v2/mcp", headers={"Authorization": "Bearer " + tokens["access_token"]})
                self.assertEqual(denied.status_code, 401)
                setattr(row, field, original)
                row.save(update_fields=[field])
        with self.settings(AUTH_MFA_REQUIRED=True):
            self.assertEqual(self.refresh(tokens["refresh_token"]).json()["error"], "invalid_grant")

    def test_refresh_revocation_endpoint_revokes_access_too(self):
        tokens = self.authorized_tokens()
        revoked = self.http("POST", "/api/v2/mcp/oauth/revoke", data={
            "client_id": self.client_row.pk,
            "token": tokens["refresh_token"], "token_type_hint": "refresh_token",
        })
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertEqual(self.refresh(tokens["refresh_token"]).json()["error"], "invalid_grant")
        self.grant.refresh_from_db()
        self.assertIsNotNone(self.grant.revoked_at)

    def test_code_only_clients_preserve_one_hour_session_bound_access(self):
        self.client_row.metadata["grant_types"] = ["authorization_code"]
        self.client_row.save()
        tokens = self.authorized_tokens()
        self.assertFalse(tokens.get("refresh_token"))
        self.assertIsNone(self.grant.source_session_id)
        self.assertEqual(self.grant.session_id, self.session.pk)
        self.assertEqual(McpRefreshToken.objects.count(), 0)

    def test_read_only_refresh_cannot_gain_writes(self):
        self.grant.scopes = ["bold.read"]
        tokens = self.authorized_tokens()
        denied = self.refresh(tokens["refresh_token"], scope="bold.read bold.write")
        self.assertEqual(denied.json()["error"], "invalid_scope")
        renewed = self.refresh(tokens["refresh_token"])
        self.assertEqual(renewed.status_code, 200, renewed.text)
        self.assertEqual(renewed.json()["scope"], "bold.read")
        with self.assertRaises(ValidationError):
            execute(self.grant, "patch_auth_profile", data={"biography": "No autorizado"}, write=True)

    @skipUnless(connection.vendor == "postgresql", "Row locking requires PostgreSQL")
    def test_concurrent_refresh_is_single_use_and_replay_revokes_the_family(self):
        from mcp.server.auth.provider import TokenError

        tokens = self.authorized_tokens()
        provider = BoldOAuthProvider()
        client = async_to_sync(provider.get_client)(self.client_row.pk)
        refresh = async_to_sync(provider.load_refresh_token)(client, tokens["refresh_token"])
        barrier = Barrier(2)

        def exchange():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    provider.exchange_refresh_token.__wrapped__(provider, client, refresh, refresh.scopes)
                    return "issued"
                except TokenError as error:
                    return error.error
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: exchange(), range(2)))
        self.assertCountEqual(results, ["issued", "invalid_grant"])
        self.assertEqual(McpRefreshToken.objects.count(), 2)
        self.grant.refresh_from_db()
        self.assertIsNotNone(self.grant.revoked_at)

    def test_mcp_initialize_list_and_call_use_real_protocol(self):
        headers = {"Authorization": "Bearer " + self.raw, "Accept": "application/json, text/event-stream"}
        init = self.http("POST", "/api/v2/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "prueba", "version": "1"}},
        })
        self.assertEqual(init.status_code, 200, init.text)
        self.assertEqual(init.json()["result"]["serverInfo"]["name"], "BOLD")
        listed = self.http("POST", "/api/v2/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual({row["name"] for row in listed.json()["result"]["tools"]}, {"bold_context", "bold_catalog", "bold_read", "bold_write"})
        call = self.http("POST", "/api/v2/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "bold_read", "arguments": {"operation": "get_auth_profile"}},
        })
        self.assertEqual(call.status_code, 200, call.text)
        self.assertFalse(call.json()["result"].get("isError", False), call.text)
        self.assertIn(self.user.email, call.text)
        self.session.revoked_at = timezone.now()
        self.session.save()
        denied = self.http("POST", "/api/v2/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 4, "method": "tools/list"})
        self.assertEqual(denied.status_code, 401)

    def test_consent_requires_csrf_and_connection_revocation_is_account_scoped(self):
        McpAuthorization.objects.create(
            request_hash=token_hash("pendiente"), client=self.client_row,
            parameters={}, scopes=["bold.read"], expires_at=timezone.now() + timedelta(minutes=10),
        )
        path = "/api/v2/mcp/consent/?request=pendiente"
        self.assertEqual(self.api(csrf=True).post(path, {"decision": "allow"}).status_code, 403)
        self.assertEqual(self.api().get(path).status_code, 200)
        revoked = self.api().delete("/api/v2/mcp/connections/" + str(self.grant.pk) + "/")
        self.assertEqual(revoked.status_code, 204)
        self.grant.refresh_from_db()
        self.assertIsNotNone(self.grant.revoked_at)

    @override_settings(MCP_PUBLIC_ORIGIN='https://bold.example', ALLOWED_HOSTS=['bold.example'],
                       CSRF_TRUSTED_ORIGINS=['https://bold.example'])
    def test_https_consent_form_preserves_origin_and_requires_a_valid_csrf_submission(self):
        pending = McpAuthorization.objects.create(request_hash=token_hash('browser-consent'),
            client=self.client_row, parameters={'redirect_uri':'http://127.0.0.1:9999/callback','state':'test'},
            scopes=['bold.read','bold.write'], expires_at=timezone.now()+timedelta(minutes=10))
        path = '/api/v2/mcp/consent/?request=browser-consent'
        client = self.api(csrf=True)
        page = client.get(path, secure=True, HTTP_HOST='bold.example')
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page['Referrer-Policy'], 'same-origin')
        form = {'decision':'allow','assignment':str(self.assignment.pk),
                'csrfmiddlewaretoken':page.cookies['csrftoken'].value}
        denied = client.post(path, form, secure=True, HTTP_HOST='bold.example', HTTP_ORIGIN='null')
        self.assertEqual(denied.status_code, 403)
        pending.refresh_from_db()
        self.assertIsNone(pending.code_hash)
        allowed = client.post(path, form, secure=True, HTTP_HOST='bold.example', HTTP_ORIGIN='https://bold.example')
        self.assertEqual(allowed.status_code, 302, allowed.content)
        pending.refresh_from_db()
        self.assertTrue(pending.code_hash)
        self.assertEqual(pending.scopes, ['bold.read'])

    def test_administrative_permissions_and_other_account_are_preserved(self):
        denied = execute(self.grant, "get_administration_dashboard")
        self.assertEqual(denied["status"], 403)
        other = UserAccount.objects.create_user(
            email="mcp-otra@bold.gt", employee=Employee.objects.create(full_name="Otra cuenta"),
        )
        client = APIClient()
        client.force_authenticate(other)
        denied = client.delete("/api/v2/mcp/connections/" + str(self.grant.pk) + "/")
        self.assertEqual(denied.status_code, 404)
        self.session.user_account = other
        with self.assertRaises(AuthenticationFailed):
            validate_authorization(self.grant)

    def test_registration_and_resource_binding(self):
        response = self.http("POST", "/api/v2/mcp/oauth/register", json={
            "client_name": "Cliente remoto",
            "redirect_uris": ["http://127.0.0.1:4444/callback"],
            "token_endpoint_auth_method": "none", "scope": "bold.read bold.write",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        })
        self.assertEqual(response.status_code, 201, response.text)
        invalid = self.http("POST", "/api/v2/mcp/oauth/register", json={
            "redirect_uris": ["http://example.com/callback"], "token_endpoint_auth_method": "none",
        })
        self.assertEqual(invalid.status_code, 400, invalid.text)
        invalid = self.http("GET", "/api/v2/mcp/oauth/authorize", params={
            "client_id": self.client_row.pk, "response_type": "code", "code_challenge": "a" * 43,
            "code_challenge_method": "S256", "resource": "https://otra.example/mcp",
            "scope": "bold.read",
        })
        self.assertEqual(invalid.status_code, 302, invalid.text)
        self.assertIn("invalid_target", invalid.headers["location"])
        self.assertNotIn("access_token", invalid.headers["location"])

    def test_random_invalid_tokens_share_the_client_rate_limit(self):
        response = None
        with patch("boldApp.mcp.asgi.timezone.now", return_value=timezone.now()):
            for index in range(121):
                response = self.http("POST", "/api/v2/mcp", headers={"Authorization": "Bearer invalido-" + str(index)})
        self.assertEqual(response.status_code, 429, response.text)

    def test_oauth_rejects_oversized_registration_before_parsing_or_persisting(self):
        before = McpClient.objects.count()
        response = self.http('POST', '/api/v2/mcp/oauth/register',
            content=b' '*32769, headers={'Content-Type':'application/json'})
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(McpClient.objects.count(), before)

    @override_settings(DEBUG=False, MCP_PUBLIC_ORIGIN='https://bold.example')
    def test_production_requires_shared_mcp_limits(self):
        from django.core.checks import run_checks
        self.assertIn('bold_mcp.E002', [error.id for error in run_checks()])

    def test_tool_calls_and_oauth_have_independent_rate_limits(self):
        from .asgi import within_rate_limit

        rpc = {"path": "/api/v2/mcp"}
        oauth = {"path": "/.well-known/oauth-protected-resource/api/v2/mcp"}
        with patch("boldApp.mcp.asgi.timezone.now", return_value=timezone.now()):
            for _ in range(120):
                self.assertTrue(async_to_sync(within_rate_limit)(rpc, "127.0.0.1"))
            self.assertFalse(async_to_sync(within_rate_limit)(rpc, "127.0.0.1"))
            for _ in range(30):
                self.assertTrue(async_to_sync(within_rate_limit)(oauth, "127.0.0.1"))
            self.assertFalse(async_to_sync(within_rate_limit)(oauth, "127.0.0.1"))

    def test_uploads_use_the_normal_memory_only_handler(self):
        urls = type("UploadUrls", (), {"urlpatterns": [path("api/v2/upload-test/", UploadEchoView.as_view())]})
        try:
            with override_settings(ROOT_URLCONF=urls):
                operations.cache_clear()
                response = execute(self.grant, "post_upload_test", write=True, files=[{
                    "field": "file", "name": "prueba.txt", "base64": base64.b64encode(b"en memoria").decode(),
                    "content_type": "text/plain",
                }])
                self.assertEqual(response["status"], 200)
                self.assertEqual(response["data"], {"in_memory": True, "value": "en memoria"})
                with self.assertRaises(ValidationError):
                    execute(self.grant, "post_upload_test", write=True, files=[{
                        "field": "file", "name": "prueba.txt", "base64": "invalido!",
                    }])
        finally:
            operations.cache_clear()
