import base64
import hashlib
import json
from datetime import timedelta
from io import BytesIO
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import httpx2
from asgiref.sync import async_to_sync
from django.core.cache import cache
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
from .models import McpAccessToken, McpAuthorization, McpClient
from .oauth import resource_url


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
        self.assertEqual(metadata.json()["grant_types_supported"], ["authorization_code"])
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
            "grant_types": ["authorization_code"], "response_types": ["code"],
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
