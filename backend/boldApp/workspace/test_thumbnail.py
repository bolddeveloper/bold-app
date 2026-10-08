from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.exceptions import NotFound, ValidationError

from .service import thumbnail


class ThumbnailTests(SimpleTestCase):
    @patch("boldApp.workspace.service.requests.get")
    @patch("boldApp.workspace.service.access_token", return_value="private-token")
    @patch("boldApp.workspace.service.metadata")
    def test_private_thumbnail_uses_account_credentials(self, metadata, token, get):
        metadata.return_value = {"thumbnailLink": "https://lh3.googleusercontent.com/preview"}
        get.return_value = Mock(is_redirect=False, content=b"image", headers={"Content-Type": "image/jpeg"})
        self.assertEqual(thumbnail("user", "file").content, b"image")
        metadata.assert_called_once_with("user", "file")
        self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "Bearer private-token"})
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    @patch("boldApp.workspace.service.requests.get")
    @patch("boldApp.workspace.service.access_token", return_value="private-token")
    @patch("boldApp.workspace.service.metadata")
    def test_redirect_cannot_send_credentials_outside_google(self, metadata, token, get):
        metadata.return_value = {"thumbnailLink": "https://lh3.googleusercontent.com/preview"}
        get.return_value = Mock(is_redirect=True, headers={"Location": "https://example.com/steal"})
        with self.assertRaises(ValidationError):
            thumbnail("user", "file")
        self.assertEqual(get.call_count, 1)

    @patch("boldApp.workspace.service.requests.get")
    @patch("boldApp.workspace.service.metadata", return_value={})
    def test_missing_thumbnail_does_not_fetch_content(self, metadata, get):
        with self.assertRaises(NotFound):
            thumbnail("user", "file")
        get.assert_not_called()
