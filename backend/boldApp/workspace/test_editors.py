from unittest.mock import patch
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount
from .service import MIMES


@override_settings(GOOGLE_WORKSPACE_EDITORS_ENABLED=True)
class EditorTests(TestCase):
    def setUp(self):
        self.user = UserAccount.objects.create_user(email="editor@bold.gt", employee=Employee.objects.create(full_name="Editor"))
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/v2/workspace/files/test_file/editor/"

    def item(self, kind="docs", can_edit=True):
        return {"id": "test_file", "mimeType": MIMES[kind], "version": "10", "capabilities": {"canEdit": can_edit}}

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_editor_read_is_user_scoped_and_does_not_expose_tokens(self, google, metadata):
        metadata.return_value = self.item()
        google.return_value = {"revisionId": "rev", "tabs": []}
        result = self.client.get(self.url)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["kind"], "docs")
        self.assertEqual(google.call_args.args[0], self.user)
        self.assertEqual(google.call_args.kwargs["params"], {"includeTabsContent": "true"})
        self.assertEqual(result["Cache-Control"], "private, no-store")

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_read_only_user_cannot_edit(self, google, metadata):
        metadata.return_value = self.item(can_edit=False)
        self.assertEqual(self.client.post(self.url, {"requests": [{"insertText": {"text": "x"}}]}, format="json").status_code, 403)
        google.assert_not_called()

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_revision_conflicts_never_write(self, google, metadata):
        metadata.return_value = self.item()
        google.return_value = {"revisionId": "remote"}
        result = self.client.post(self.url, {"revision": "old", "requests": [{"insertText": {"text": "x", "location": {"index": 1}}}]}, format="json")
        self.assertEqual(result.status_code, 409)
        self.assertEqual(google.call_count, 1)
        self.assertEqual(google.call_args.args[1], "GET")

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_batch_update_has_revision_precondition_and_audit(self, google, metadata):
        metadata.return_value = self.item("slides")
        google.side_effect = [{"revisionId": "rev"}, {"replies": [{}]}]
        result = self.client.post(self.url, {"revision": "rev", "requests": [{"createSlide": {"objectId": "test_slide"}}]}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(google.call_args.kwargs["api"], "slides")
        self.assertEqual(google.call_args.kwargs["body"]["writeControl"], {"requiredRevisionId": "rev"})
        from boldApp.administrativo.models import SystemAuditEvent
        self.assertEqual(SystemAuditEvent.objects.get().event_type, "workspace.content_updated")

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_invalid_operations_and_payloads_never_reach_google(self, google, metadata):
        metadata.return_value = self.item()
        for operations in ([], [{"deleteSheet": {}}], [{"insertText": {}, "deleteContentRange": {}}], [{"insertText": []}]):
            self.assertEqual(self.client.post(self.url, {"revision": "rev", "requests": operations}, format="json").status_code, 400)
        google.assert_not_called()

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.editors.google")
    def test_sheets_range_size_and_version_checked(self, google, metadata):
        metadata.return_value = self.item("sheets")
        google.return_value = {"sheets": []}
        self.assertEqual(self.client.get(self.url, {"range": "'Hoja 1'!A1:Z100"}).status_code, 200)
        self.assertEqual(self.client.get(self.url, {"range": "'Hoja 1'!A1:ZZ10000"}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {"range": "'Hoja 1'!Z1:A100"}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {"range": "'Hoja 1'!Z100:A1"}).status_code, 400)
        self.assertEqual(self.client.post(self.url, {"version": "old", "requests": [{"updateCells": {}}]}, format="json").status_code, 409)
        self.assertEqual(self.client.post(self.url, {"version": "10", "requests": [{"updateCells": {}}]}, format="json").status_code, 200)

    def test_anonymous_cannot_read_editor(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
