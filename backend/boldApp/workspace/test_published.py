from unittest.mock import patch
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.exceptions import PermissionDenied, ValidationError
from boldApp.core.models import Employee, UserAccount
from .models import GoogleConnection, PublishedView
from .service import MIMES, GoogleUnavailable
from .published import published_url


class PublishedTests(TestCase):
    def setUp(self):
        self.user = UserAccount.objects.create_user(email="viewer@bold.gt", employee=Employee.objects.create(full_name="Viewer"))
        self.connection = GoogleConnection.objects.create(user=self.user, email="viewer@gmail.com", subject="google_a", refresh_token_encrypted="unused")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = "/api/v2/workspace/files/test_file/published-view/"
        self.link = "https://docs.google.com/document/d/e/published_id/pub"

    def test_urls_and_iframe_never_keep_html_or_tokens(self):
        self.assertEqual(published_url(f'<iframe src="{self.link}?access_token=secret"></iframe><script>alert(1)</script>', "docs"), self.link + "?embedded=true")
        for value in ["http://docs.google.com/document/d/e/x/pub", "https://docs.google.com.evil.com/document/d/e/x/pub", "https://evil@docs.google.com/document/d/e/x/pub", "https://docs.google.com/document/d/x/edit", "javascript:alert(1)", "https://docs.google.com/spreadsheets/d/e/x/pubhtml", self.link + "#token", "<iframe src='x'></iframe><iframe src='y'></iframe>"]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                published_url(value, "docs")
        self.assertEqual(published_url("https://docs.google.com/spreadsheets/d/e/x/pub", "sheets"), "https://docs.google.com/spreadsheets/d/e/x/pubhtml")
        self.assertEqual(published_url("https://docs.google.com/presentation/d/e/x/pub?start=false", "slides"), "https://docs.google.com/presentation/d/e/x/embed?start=false")

    @patch("boldApp.workspace.published.metadata")
    @patch("boldApp.workspace.published.google")
    def test_publication_discovery_and_pagination(self, google, metadata):
        metadata.return_value = {"mimeType": MIMES["docs"]}
        google.side_effect = [{"nextPageToken": "next", "revisions": []}, {"revisions": [{"published": True, "publishedLink": self.link}]}]
        result = self.client.get(self.url)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["verified"])
        self.assertEqual(result.data["state"], "published")
        self.assertEqual(google.call_args.kwargs["params"]["pageToken"], "next")
        self.assertEqual(google.call_args.args[0], self.user)

    @patch("boldApp.workspace.published.metadata")
    @patch("boldApp.workspace.published.google")
    def test_manual_association_is_private_unverified_and_removable(self, google, metadata):
        metadata.return_value = {"mimeType": MIMES["docs"]}
        google.return_value = {"revisions": []}
        result = self.client.put(self.url, {"url": self.link}, format="json")
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.data["verified"])
        self.assertEqual(result.data["state"], "unknown")
        self.assertEqual(result.data["source"], "manual")
        other = UserAccount.objects.create_user(email="other@bold.gt", employee=Employee.objects.create(full_name="Other"))
        GoogleConnection.objects.create(user=other, email="other@gmail.com", subject="google_a", refresh_token_encrypted="unused")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(self.url).data["associated_url"], "")
        self.client.force_authenticate(self.user)
        self.connection.subject = "google_b"
        self.connection.save()
        self.assertEqual(self.client.get(self.url).data["associated_url"], "")
        self.connection.subject = "google_a"
        self.connection.save()
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(PublishedView.objects.exists())
        self.assertTrue(all(call.args[1] == "GET" for call in google.call_args_list))

    @patch("boldApp.workspace.published.metadata")
    @patch("boldApp.workspace.published.google")
    def test_unpublished_never_loads_stale_association_and_errors_are_unknown(self, google, metadata):
        metadata.return_value = {"mimeType": MIMES["docs"]}
        PublishedView.objects.create(user=self.user, google_subject="google_a", file_id="test_file", embed_url=self.link)
        google.return_value = {"revisions": [{"published": False}]}
        result = self.client.get(self.url)
        self.assertEqual(result.data["state"], "unpublished")
        self.assertEqual(result.data["embed_url"], "")
        for exception in [PermissionDenied(), GoogleUnavailable()]:
            google.side_effect = exception
            self.assertEqual(self.client.get(self.url).data["state"], "unknown")

    @patch("boldApp.workspace.published.metadata")
    @patch("boldApp.workspace.published.google")
    def test_original_access_is_required_for_every_operation(self, google, metadata):
        metadata.side_effect = PermissionDenied()
        for operation in [lambda: self.client.get(self.url), lambda: self.client.put(self.url, {"url": self.link}, format="json"), lambda: self.client.delete(self.url)]:
            self.assertEqual(operation().status_code, 403)
        google.assert_not_called()
        self.assertFalse(PublishedView.objects.exists())

    @override_settings(GOOGLE_WORKSPACE_EDITORS_ENABLED=False)
    @patch("boldApp.workspace.editors.google")
    def test_disabled_editor_does_not_write(self, google):
        self.assertEqual(self.client.post("/api/v2/workspace/files/test_file/editor/", {"requests": [{"insertText": {"text": "blocked"}}]}, format="json").status_code, 403)
        google.assert_not_called()
        self.assertFalse(self.client.get("/api/v2/workspace/connection/").data["editors_enabled"])
