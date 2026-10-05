from datetime import timedelta
from unittest.mock import patch, Mock
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount
from boldApp.autenticacion.models import AuthSession
from boldApp.autenticacion.services import encrypt_secret
from .models import GoogleConnection
from .google_config import configuration


@override_settings(GOOGLE_WORKSPACE_CLIENT_ID="test", GOOGLE_WORKSPACE_CLIENT_SECRET="test", AUTH_ENCRYPTION_KEY="", DEBUG=True)
class WorkspaceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.users = [UserAccount.objects.create_user(email=f"drive{i}@bold.gt", employee=Employee.objects.create(full_name=f"Drive {i}")) for i in range(2)]
        self.client = APIClient()
        self.client.force_authenticate(self.users[0])
        self.root = "/api/v2/workspace/"

    def test_connection_is_individual_and_never_returns_tokens(self):
        GoogleConnection.objects.create(user=self.users[0], email="drive0@bold.gt", subject="first", refresh_token_encrypted=encrypt_secret("private"))
        result = self.client.get(self.root + "connection/").data
        self.assertTrue(result["connected"])
        self.assertNotIn("private", str(result))
        self.client.force_authenticate(self.users[1])
        self.assertFalse(self.client.get(self.root + "connection/").data["connected"])
        self.client.delete(self.root + "connection/")
        self.assertEqual(GoogleConnection.objects.count(), 1)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.root + "files/").status_code, [401, 403])

    @patch("boldApp.workspace.views.google")
    def test_search_is_escaped_and_pagination_scoped(self, google):
        google.return_value = {"files": [], "nextPageToken": "next"}
        result = self.client.get(self.root + "files/", {"search": "' or trashed=true", "parent": "folder_1", "page": "next"})
        self.assertEqual(result.status_code, 200)
        query = google.call_args.kwargs["params"]["q"]
        self.assertIn("\\' or trashed=true", query)
        self.assertIn("'folder_1' in parents", query)
        self.assertEqual(google.call_args.args[0], self.users[0])

    @patch("boldApp.workspace.views.metadata")
    @patch("boldApp.workspace.views.google")
    def test_google_capabilities_block_mutation(self, google, metadata):
        metadata.return_value = {"capabilities": {"canTrash": False, "canRename": False}}
        result = self.client.patch(self.root + "files/file_1/", {"trashed": True}, format="json")
        self.assertEqual(result.status_code, 403)
        google.assert_not_called()

    @patch("boldApp.workspace.views.metadata")
    @patch("boldApp.workspace.views.google")
    def test_trash_is_recoverable_and_audited(self, google, metadata):
        metadata.return_value = {"capabilities": {"canTrash": True}}
        google.return_value = {"id": "file_1", "trashed": True}
        result = self.client.patch(self.root + "files/file_1/", {"trashed": True}, format="json")
        self.assertEqual(result.status_code, 200)
        from boldApp.administrativo.models import SystemAuditEvent
        self.assertEqual(SystemAuditEvent.objects.get().metadata["google_file_id"], "file_1")

    @patch("boldApp.workspace.views.google")
    def test_creating_each_google_file_type(self, google):
        google.return_value = {"id": "new_1"}
        for kind in ["docs", "sheets", "slides", "folder"]:
            self.assertEqual(self.client.post(self.root + "files/", {"type": kind, "name": "Demo"}, format="json").status_code, 201)
        self.assertEqual(self.client.post(self.root + "files/", {"type": "invalid"}, format="json").status_code, 400)

    def test_failed_oauth_state_creates_no_connection(self):
        result = self.client.get(self.root + "oauth/callback/?state=invalid&code=test")
        self.assertEqual(result.status_code, 200)
        self.assertFalse(GoogleConnection.objects.exists())

    @patch("boldApp.workspace.service.requests.request")
    def test_api_uses_only_this_users_token(self, request):
        for index, user in enumerate(self.users):
            GoogleConnection.objects.create(user=user, email=user.email, subject=str(index), refresh_token_encrypted=encrypt_secret("refresh"), access_token_encrypted=encrypt_secret(f"token_{index}"), expires_at=timezone.now() + timedelta(hours=1))
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = {"files": []}
        request.return_value = response
        from .service import google
        google(self.users[1], "GET", "/files")
        self.assertEqual(request.call_args.kwargs["headers"]["Authorization"], "Bearer token_1")

    @patch("boldApp.workspace.oauth.requests.post")
    def test_oauth_callback_cannot_be_replayed(self, exchange):
        from django.core import signing
        session = AuthSession.objects.create(user_account=self.users[0], token_hash="test-token", credentials_version=self.users[0].credentials_version, expires_at=timezone.now() + timedelta(hours=1))
        cache.set("bold-workspace-oauth:nonce", str(session.pk), timeout=600)
        state = signing.dumps({"session": str(session.pk), "nonce": "nonce", "origin": "http://localhost:5174", "version": configuration()["version"]}, salt="bold-workspace")
        self.client.get(self.root + "oauth/callback/", {"state": state, "error": "access_denied"})
        self.client.get(self.root + "oauth/callback/", {"state": state, "code": "unexpected"})
        exchange.assert_not_called()

    @override_settings(GOOGLE_WORKSPACE_DEMO_EMAIL="samueloyy@gmail.com")
    @patch("boldApp.workspace.oauth.requests.get")
    @patch("boldApp.workspace.oauth.requests.post")
    def test_personal_demo_account_connects_to_company_bold_user(self, exchange, identity):
        from urllib.parse import parse_qs, urlparse
        from boldApp.autenticacion.services import decrypt_secret
        session = AuthSession.objects.create(user_account=self.users[0], token_hash="demo-session", credentials_version=self.users[0].credentials_version, expires_at=timezone.now() + timedelta(hours=1))
        self.client.force_authenticate(self.users[0], token=session)
        token = Mock()
        token.json.return_value = {"access_token": "access", "refresh_token": "refresh", "scope": "openid email https://www.googleapis.com/auth/drive", "expires_in": 3600}
        exchange.return_value = token
        profile = Mock()
        profile.json.return_value = {"email": "samueloyy@gmail.com", "email_verified": True, "sub": "samuel"}
        identity.return_value = profile

        def callback():
            start = self.client.post(self.root + "oauth/start/")
            self.assertEqual(start.status_code, 200)
            query = parse_qs(urlparse(start.data["authorization_url"]).query)
            self.assertEqual(query["login_hint"], ["samueloyy@gmail.com"])
            return self.client.get(self.root + "oauth/callback/", {"state": query["state"][0], "code": "demo"})

        self.assertContains(callback(), '"connected"')
        connection = GoogleConnection.objects.get(user=self.users[0])
        self.assertEqual(connection.email, "samueloyy@gmail.com")
        self.assertEqual(decrypt_secret(connection.refresh_token_encrypted), "refresh")
        self.assertNotEqual(connection.refresh_token_encrypted, "refresh")
        profile.json.return_value["email"] = "other@gmail.com"
        self.assertContains(callback(), '"wrong_account"')
        connection.refresh_from_db()
        self.assertEqual(connection.email, "samueloyy@gmail.com")
        with override_settings(DEBUG=False):
            profile.json.return_value["email"] = "samueloyy@gmail.com"
            from django.core import signing
            cache.set("bold-workspace-oauth:production", str(session.pk), timeout=600)
            state = signing.dumps({"session": str(session.pk), "nonce": "production", "version": configuration()["version"]}, salt="bold-workspace")
            result = self.client.get(self.root + "oauth/callback/", {"state": state, "code": "demo"})
            self.assertContains(result, '"wrong_account"')
            self.assertEqual(self.client.get(self.root + "connection/").data["demo_email"], "")

    @patch("boldApp.workspace.service.access_token", return_value="upload-token")
    @patch("boldApp.workspace.service.requests.Session.send")
    def test_upload_sends_google_multipart_related(self, send, access):
        from .service import google
        response = Mock(status_code=200, content=b"{}")
        response.json.return_value = {"id": "uploaded"}
        send.return_value = response
        result = google(self.users[0], "POST", "/files", api="upload", params={"uploadType": "multipart"}, files={"metadata": (None, '{"name":"demo.txt"}', "application/json"), "file": ("demo.txt", b"hello", "text/plain")})
        prepared = send.call_args.args[0]
        self.assertTrue(prepared.headers["Content-Type"].startswith("multipart/related; boundary="))
        self.assertIn(b'hello', prepared.body)
        self.assertIn(b'application/json', prepared.body)
        self.assertEqual(prepared.headers["Authorization"], "Bearer upload-token")
        self.assertEqual(result, {"id": "uploaded"})

    @patch("boldApp.workspace.views.google")
    def test_filters_and_recent_storage_order_are_validated(self, google):
        google.return_value = {"files": []}
        self.assertEqual(self.client.get(self.root + "files/", {"view": "recent", "owner": "me", "after": "2026-01-01"}).status_code, 200)
        params = google.call_args.kwargs["params"]
        self.assertEqual(params["orderBy"], "viewedByMeTime desc")
        self.assertIn("'me' in owners", params["q"])
        self.assertIn("2026-01-01T00:00:00Z", params["q"])
        self.client.get(self.root + "files/", {"view": "storage"})
        self.assertEqual(google.call_args.kwargs["params"]["orderBy"], "quotaBytesUsed desc")
        for values in [{"view": "unknown"}, {"order": "malicious"}, {"after": "2026-99-99"}, {"owner": "' or trashed=true"}]:
            google.reset_mock()
            self.assertEqual(self.client.get(self.root + "files/", values).status_code, 400)
            google.assert_not_called()

    @patch("boldApp.workspace.views.metadata")
    @patch("boldApp.workspace.views.google")
    def test_move_updates_parents_and_denies_no_capability(self, google, metadata):
        metadata.return_value = {"id": "file", "parents": ["old_folder"], "capabilities": {"canMoveItemWithinDrive": True}}
        google.return_value = {"id": "file", "parents": ["root"]}
        self.assertEqual(self.client.post(self.root + "files/file/move/", {"parent": "root"}).status_code, 200)
        self.assertEqual(google.call_args.kwargs["params"]["removeParents"], "old_folder")
        self.assertEqual(google.call_args.kwargs["params"]["addParents"], "root")
        self.assertEqual(google.call_args.args[0], self.users[0])
        google.reset_mock()
        metadata.return_value["capabilities"] = {}
        self.assertEqual(self.client.post(self.root + "files/file/move/", {"parent": "root"}).status_code, 403)
        google.assert_not_called()

    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.views.metadata")
    @patch("boldApp.workspace.views.google")
    def test_folder_cannot_move_into_descendant(self, google, metadata, capability):
        from .service import MIMES
        metadata.side_effect = [{"id": "parent", "mimeType": MIMES["folder"], "capabilities": {"canMoveItemWithinDrive": True}}, {"id": "parent", "parents": ["root"]}]
        capability.return_value = {"id": "child", "mimeType": MIMES["folder"], "parents": ["parent"]}
        self.assertEqual(self.client.post(self.root + "files/parent/move/", {"parent": "child"}).status_code, 400)
        google.assert_not_called()

    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.views.google")
    def test_permissions_update_and_remove_require_google_share_capability(self, google, capability):
        capability.return_value = {"id": "file"}
        google.return_value = {"id": "permission", "role": "reader"}
        endpoint = self.root + "files/file/permissions/permission/"
        self.assertEqual(self.client.patch(endpoint, {"role": "writer"}).status_code, 200)
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        capability.assert_called_with(self.users[0], "file", "canShare")
        google.reset_mock()
        self.assertEqual(self.client.patch(endpoint, {"role": "owner"}).status_code, 400)
        google.assert_not_called()
        from rest_framework.exceptions import PermissionDenied
        capability.side_effect = PermissionDenied()
        self.assertEqual(self.client.delete(endpoint).status_code, 403)
        google.assert_not_called()

    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.views.google")
    def test_preview_limit_type_and_private_headers(self, google, capability):
        capability.return_value = {"mimeType": "application/pdf", "size": "100"}
        google.return_value = Mock(content=b"%PDF-demo")
        endpoint = self.root + "files/file/preview/"
        result = self.client.get(endpoint)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Cache-Control"], "private, no-store")
        self.assertEqual(result["X-Content-Type-Options"], "nosniff")
        google.reset_mock()
        for item in [{"mimeType": "image/svg+xml"}, {"mimeType": "text/html"}, {"mimeType": "application/pdf", "size": str(21 * 1024 * 1024)}]:
            capability.return_value = item
            self.assertEqual(self.client.get(endpoint).status_code, 400)
        google.assert_not_called()

    @patch("boldApp.workspace.views.google")
    def test_native_files_are_created_directly_in_the_selected_folder(self, google):
        google.return_value = {"id": "created"}
        for kind in ["docs", "sheets", "slides"]:
            with self.subTest(kind=kind):
                result = self.client.post(self.root + "files/", {"type": kind, "name": "Demo", "parent": "chosen_folder"}, format="json")
                self.assertEqual(result.status_code, 201)
                self.assertEqual(google.call_args.kwargs["body"]["parents"], ["chosen_folder"])
                self.assertEqual(google.call_args.args[0], self.users[0])

    @patch("boldApp.workspace.views.google")
    def test_upload_size_validation_and_folder_color(self, google):
        from django.core.files.uploadedfile import SimpleUploadedFile
        google.return_value = {"id": "uploaded"}
        result = self.client.post(self.root + "upload/", {"file": SimpleUploadedFile("demo.txt", b"demo"), "parent": "folder"}, format="multipart")
        self.assertEqual(result.status_code, 201)
        self.assertIn('"folder"', google.call_args.kwargs["files"]["metadata"][1])
        google.reset_mock()
        self.assertEqual(self.client.post(self.root + "upload/", {}).status_code, 400)
        google.assert_not_called()
        with patch("boldApp.workspace.views.metadata", return_value={"mimeType": "application/vnd.google-apps.folder"}):
            self.assertEqual(self.client.patch(self.root + "files/folder/", {"folderColorRgb": "#4285f4"}).status_code, 200)
            google.reset_mock()
            self.assertEqual(self.client.patch(self.root + "files/folder/", {"folderColorRgb": "red"}).status_code, 400)
            google.assert_not_called()

    @patch("boldApp.workspace.views.google")
    def test_invalid_parent_does_not_make_a_google_request(self, google):
        self.assertEqual(self.client.post(self.root + "files/", {"type": "folder", "parent": {"id": "invalid"}}, format="json").status_code, 400)
        google.assert_not_called()

    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.views.google")
    def test_binary_download_avoids_drf_renderer_format_collision(self, google, capability):
        from .service import MIMES
        response = Mock(content=b"downloaded", headers={"Content-Type": "application/pdf"})
        google.return_value = response
        endpoint = self.root + "files/file/download/"
        for kind, extension in [("docs", "pdf"), ("docs", "docx"), ("sheets", "xlsx"), ("slides", "pptx")]:
            capability.return_value = {"mimeType": MIMES[kind]}
            result = self.client.get(endpoint, {"export_format": extension})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.content, b"downloaded")
            self.assertEqual(result["Cache-Control"], "private, no-store")
            self.assertTrue(google.call_args.args[2].endswith("/export"))
        capability.return_value = {"mimeType": "image/png"}
        self.assertEqual(self.client.get(endpoint, {"export_format": "pdf"}).status_code, 200)
        self.assertEqual(google.call_args.kwargs["params"]["alt"], "media")
