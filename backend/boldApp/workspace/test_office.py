from unittest.mock import Mock, patch
from contextlib import contextmanager
import json
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from boldApp.core.models import Employee, UserAccount
from .office import office_kind, LIMIT, EXPORTS
from .models import OfficeWorkspace, GoogleConnection
from .service import MIMES


@override_settings(GOOGLE_WORKSPACE_EDITORS_ENABLED=True)
class OfficeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = UserAccount.objects.create_user(email="office@bold.gt", employee=Employee.objects.create(full_name="Office"))
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/v2/workspace/files/original/open-office/"
        self.editor = "/api/v2/workspace/files/original/editor/"
        self.original = {"id": "original", "name": "Prueba.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "version": "5", "md5Checksum": "checksum", "size": "5", "capabilities": {"canCopy": True, "canDownload": True, "canEdit": True}}
        self.native = {"id": "working", "mimeType": MIMES["docs"], "trashed": True}

    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    def test_open_selects_original_without_creating_any_copy(self, google, metadata):
        for kind, extension, mime in [("docs", "docx", self.original["mimeType"]), ("sheets", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), ("slides", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")]:
            metadata.return_value = dict(self.original, name="test." + extension, mimeType=mime)
            result = self.client.post(self.url, {})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.data["id"], "original")
            self.assertEqual(result.data["editorKind"], kind)
        google.assert_not_called()

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.office.google")
    @patch("boldApp.workspace.editors.google")
    def test_first_read_converts_only_temporary_file_and_trashes_it(self, editor_google, office_google, metadata):
        metadata.return_value = self.original
        office_google.side_effect = [Mock(content=b"bytes"), self.native, {}, {}]
        editor_google.return_value = {"revisionId": "rev", "tabs": []}
        result = self.client.get(self.editor)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["file"]["id"], "original")
        self.assertEqual(result.data["source_checksum"], "checksum")
        self.assertEqual(editor_google.call_args.args[2], "/documents/working")
        self.assertEqual(office_google.call_args.kwargs["body"], {"trashed": True})
        self.assertEqual(OfficeWorkspace.objects.get(user=self.user).working_id, "working")

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    @patch("boldApp.workspace.editors.google")
    def test_save_updates_original_id_and_keeps_conversion_in_trash(self, editor_google, office_google, office_metadata, editor_metadata):
        session = OfficeWorkspace.objects.create(user=self.user, google_subject="", source_id="original", working_id="working", checksum="checksum")
        editor_metadata.return_value = self.original
        office_metadata.side_effect = [self.native, self.original]
        updated = dict(self.original, md5Checksum="saved_checksum")
        office_google.side_effect = [{}, Mock(content=b"saved office"), Mock(json=lambda: self.original, headers={"ETag": "original_etag"}), updated, {}]
        editor_google.side_effect = [{"revisionId": "rev"}, {"replies": []}]
        result = self.client.post(self.editor, {"revision": "rev", "source_checksum": "checksum", "requests": [{"insertText": {"text": "saved", "location": {"index": 1}}}]}, format="json")
        self.assertEqual(result.status_code, 200)
        upload = office_google.call_args_list[-2]
        self.assertEqual(upload.args[1:3], ("PATCH", "/files/original"))
        self.assertEqual(upload.kwargs["api"], "upload")
        self.assertEqual(upload.kwargs["extra_headers"], {"If-Match": "original_etag"})
        self.assertEqual(office_google.call_args.kwargs["body"], {"trashed": True})
        session.refresh_from_db()
        self.assertEqual(session.checksum, "saved_checksum")

    @patch("boldApp.workspace.editors.metadata")
    @patch("boldApp.workspace.office.google")
    def test_external_changes_and_read_only_originals_never_write(self, google, metadata):
        metadata.return_value = dict(self.original, md5Checksum="changed_elsewhere")
        self.assertEqual(self.client.post(self.editor, {"source_checksum": "checksum"}, format="json").status_code, 409)
        metadata.return_value = dict(self.original, capabilities={"canEdit": False})
        self.assertEqual(self.client.post(self.editor, {"source_checksum": "checksum"}, format="json").status_code, 403)
        google.assert_not_called()

    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    def test_invalid_types_permissions_and_size_are_rejected_without_conversion(self, google, metadata):
        for item, status in [(dict(self.original, size=str(LIMIT + 1)), 400), (dict(self.original, mimeType="application/pdf"), 400), (dict(self.original, trashed=True), 400), (dict(self.original, capabilities={"canCopy": False}), 403)]:
            metadata.return_value = item
            self.assertEqual(self.client.post(self.url, {}).status_code, status)
        google.assert_not_called()

    @patch("boldApp.workspace.office.office_workspace")
    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    def test_legacy_converts_once_and_reuses_even_after_original_changes(self, google, metadata, workspace):
        for kind, legacy, modern, mime in [("docs", "doc", "docx", "application/msword"), ("sheets", "xls", "xlsx", "application/vnd.ms-excel"), ("slides", "ppt", "pptx", "application/vnd.ms-powerpoint")]:
            source = dict(self.original, name="Prueba." + legacy, mimeType=mime, parents=["folder"])
            converted = dict(self.original, id="converted", name="Prueba." + modern, mimeType=EXPORTS[kind])
            @contextmanager
            def working(*args, **kwargs):
                self.assertTrue(kwargs["allow_legacy"])
                yield None, self.native, kind
            workspace.side_effect = working
            metadata.side_effect = [source, dict(source, md5Checksum="changed"), converted]
            google.side_effect = [{"files": []}, Mock(content=b"modern bytes"), converted, {"files": [converted]}]
            first = self.client.post(self.url, {})
            second = self.client.post(self.url, {})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(first.data["id"], second.data["id"])
            creates = [call for call in google.call_args_list if call.args[1] == "POST"]
            self.assertEqual(len(creates), 1)
            info = json.loads(creates[0].kwargs["files"]["metadata"][1])
            self.assertEqual(info["parents"], ["folder"])
            self.assertEqual(info["name"], "Prueba." + modern)
            google.reset_mock()
            workspace.reset_mock()

    @patch("boldApp.workspace.office.office_workspace")
    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    def test_trashed_conversion_is_not_duplicated(self, google, metadata, workspace):
        metadata.side_effect = [dict(self.original, name="Prueba.doc", mimeType="application/msword"), dict(self.original, id="converted", trashed=True)]
        google.return_value = {"files": [{"id": "converted"}]}
        self.assertEqual(self.client.post(self.url, {}).status_code, 409)
        workspace.assert_not_called()
        self.assertEqual(google.call_count, 1)

    @patch("boldApp.workspace.office.metadata")
    @patch("boldApp.workspace.office.google")
    def test_conversion_lookup_is_scoped_to_google_account(self, google, metadata):
        connection = GoogleConnection.objects.create(user=self.user, email="test@gmail.com", subject="account-one")
        source = dict(self.original, name="Prueba.doc", mimeType="application/msword")
        converted = dict(self.original, id="converted")
        google.return_value = {"files": [converted]}
        metadata.side_effect = [source, converted, source, converted]
        self.assertEqual(self.client.post(self.url, {}).status_code, 200)
        connection.subject = "account-two"
        connection.save(update_fields=["subject"])
        self.assertEqual(self.client.post(self.url, {}).status_code, 200)
        self.assertNotEqual(google.call_args_list[0].kwargs["params"]["q"], google.call_args_list[1].kwargs["params"]["q"])

    @override_settings(GOOGLE_WORKSPACE_EDITORS_ENABLED=False)
    @patch("boldApp.workspace.office.google")
    def test_disabled_editors_block_office_open(self, google):
        self.assertEqual(self.client.post(self.url, {}).status_code, 403)
        google.assert_not_called()

    def test_extension_fallback_only_for_unknown_office_mime(self):
        self.assertEqual(office_kind({"name": "test.DOCX", "mimeType": "application/octet-stream"}), "docs")
        self.assertIsNone(office_kind({"name": "fake.docx", "mimeType": "application/pdf"}))

    @patch("boldApp.workspace.office.office_workspace")
    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.views.google")
    def test_drive_download_keeps_original_and_editor_pdf_exports_temporary(self, google, capability, workspace):
        capability.return_value = self.original
        google.return_value = Mock(content=b"original", headers={"Content-Type": self.original["mimeType"]})
        url = "/api/v2/workspace/files/original/download/"
        self.assertEqual(self.client.get(url).content, b"original")
        self.assertEqual(google.call_args.args[2], "/files/original")
        workspace.assert_not_called()
        @contextmanager
        def working(*args):
            yield None, self.native, "docs"
        workspace.side_effect = working
        google.return_value = Mock(content=b"%PDF", headers={"Content-Type": "application/pdf"})
        result = self.client.get(url, {"editor_export": "true", "export_format": "pdf"})
        self.assertEqual(result.content, b"%PDF")
        self.assertEqual(result["Content-Type"], "application/pdf")
        self.assertEqual(google.call_args.args[2], "/files/working/export")
        self.assertEqual(self.client.get(url, {"editor_export": "true", "export_format": "xlsx"}).status_code, 400)
