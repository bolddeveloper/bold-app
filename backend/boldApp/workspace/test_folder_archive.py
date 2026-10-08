from io import BytesIO
from unittest.mock import Mock, patch
from zipfile import ZipFile
from django.test import SimpleTestCase
from rest_framework.exceptions import PermissionDenied
from .folder_archive import folder_archive
from .service import MIMES


class FolderArchiveTests(SimpleTestCase):
    root = {"id": "root", "name": "Equipo", "mimeType": MIMES["folder"]}

    @patch("boldApp.workspace.folder_archive.google")
    def test_paginated_tree_exports_documents_preserves_empty_folders_and_safe_unique_names(self, google):
        def item(identity, name, mime="text/plain"):
            return {"id": identity, "name": name, "mimeType": mime, "capabilities": {"canDownload": True}}
        google.side_effect = [
            {"files": [item("empty", "Vacía", MIMES["folder"]), item("one", "../hola.txt"), item("two", "../hola.txt")], "nextPageToken": "second"},
            Mock(content=b"one"), Mock(content=b"two"),
            {"files": [item("doc", "Documento", MIMES["docs"])]}, Mock(content=b"office"), {"files": []},
        ]
        with folder_archive("user", self.root) as stream, ZipFile(stream) as archive:
            self.assertEqual(archive.namelist(), ["Equipo/", "Equipo/Vacía/", "Equipo/_hola.txt", "Equipo/_hola (2).txt", "Equipo/Documento.docx"])
            self.assertEqual(archive.read("Equipo/Documento.docx"), b"office")
        self.assertEqual(google.call_args_list[3].kwargs["params"]["pageToken"], "second")
        self.assertTrue(all(call.args[0] == "user" for call in google.call_args_list))

    @patch("boldApp.workspace.folder_archive.google")
    def test_restricted_child_aborts_without_a_partial_archive(self, google):
        google.return_value = {"files": [{"id": "private", "name": "Privado", "mimeType": "text/plain", "capabilities": {"canDownload": False}}]}
        with self.assertRaises(PermissionDenied):
            folder_archive("user", self.root)
        self.assertEqual(google.call_count, 1)

    @patch("boldApp.workspace.folder_archive.google")
    def test_large_file_metadata_does_not_impose_an_archive_limit(self, google):
        google.side_effect = [{"files": [{"id": "large", "name": "Video", "mimeType": "video/mp4", "size": str(101 * 1024 * 1024), "capabilities": {"canDownload": True}}]}, Mock(content=b"video")]
        with folder_archive("user", self.root) as stream, ZipFile(stream) as archive:
            self.assertEqual(archive.read("Equipo/Video"), b"video")

    @patch("boldApp.workspace.views.require_capability")
    @patch("boldApp.workspace.folder_archive.google")
    def test_download_endpoint_returns_private_zip(self, google, capability):
        from rest_framework.test import APIRequestFactory, force_authenticate
        from .views import DownloadView
        capability.return_value = self.root
        google.return_value = {"files": []}
        request = APIRequestFactory().get("/api/v2/workspace/files/root/download/")
        force_authenticate(request, user=Mock(is_authenticated=True))
        response = DownloadView.as_view()(request, identity="root")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")
        self.assertIn("Equipo.zip", response["Content-Disposition"])
        self.assertEqual(response["Cache-Control"], "private, no-store")
        with ZipFile(BytesIO(b"".join(response.streaming_content))) as archive:
            self.assertEqual(archive.namelist(), ["Equipo/"])
        response.close()
