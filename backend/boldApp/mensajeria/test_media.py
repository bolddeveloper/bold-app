import io
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.exceptions import ValidationError
from boldApp.workspace.models import ImageStorageRoot
from .models import DirectMessage, MessageMedia
from . import tests as chat_tests
from .media import prepare, MAX_BYTES
from .test_staged_fixtures import staged_message, fake_attach


@override_settings(MESSAGING_PILOT_ENABLED=False)
class ChatMediaTests(TestCase):
    root = chat_tests.DirectChatTests.root
    setUp = chat_tests.DirectChatTests.setUp
    identity = chat_tests.DirectChatTests.identity
    as_person = chat_tests.DirectChatTests.as_person
    open = chat_tests.DirectChatTests.open

    def picture(self, color="red"):
        output = io.BytesIO()
        Image.new("RGB", (100, 60), color).save(output, "PNG")
        return SimpleUploadedFile("captura.png", output.getvalue(), content_type="image/png")

    def upload(self, conversation, client_id=None, file=None, body="", client=None):
        return staged_message(self,client or self.client,f'{self.root}{conversation}/',client_id or uuid.uuid4(),file or self.picture(),body)

    def drive(self):
        return ImageStorageRoot.objects.create(user=self.alice.employee.user_account,
            subject="fixture", client_id="fixture", google_email="fixture@bold.gt",
            folder_id="corporate_fixture_root", folder_name="BOLD APP", active=True)

    def fake_store(self, row, message):
        return fake_attach(self,row,message)

    def test_image_is_decoded_normalized_bounded_and_metadata_is_not_forwarded(self):
        result = prepare(self.picture())
        self.assertEqual((result["kind"], result["mime_type"], result["width"], result["height"]), ("image", "image/webp", 100, 60))
        with Image.open(io.BytesIO(result["content"])) as image:
            self.assertFalse(image.getexif())
        for bad in [SimpleUploadedFile("x.png", b"not image", content_type="image/png"),
                    SimpleUploadedFile("x.svg", b"<svg/>", content_type="image/svg+xml"),
                    SimpleUploadedFile("x.webm", b"<script/>", content_type="audio/webm")]:
            with self.assertRaises(ValidationError): prepare(bad)
        huge = self.picture(); huge.size = MAX_BYTES + 1
        with self.assertRaises(ValidationError): prepare(huge)

    @patch("boldApp.mensajeria.upload_outbox.attach")
    def test_media_only_send_retry_privacy_and_text_edit(self, store):
        store.side_effect = self.fake_store
        conversation = self.open(); token = uuid.uuid4()
        first = self.upload(conversation, token)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["message"]["media"]["kind"], "image")
        self.assertNotIn("drive_id", str(first.data))
        self.assertNotIn("private_fixture_file", str(first.data))
        retry = self.upload(conversation, token)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(store.call_count, 1)
        self.assertEqual(DirectMessage.objects.count(), 1)
        self.assertEqual(self.upload(conversation, token, self.picture("blue")).status_code, 409)
        message = first.data["message"]["id"]
        edited = self.client.patch(f"{self.root}{conversation}/messages/{message}/", {"body": "Descripción", "version": 1}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["message"]["media"]["kind"], "image")
        self.assertEqual(self.as_person(self.bob).patch(f"{self.root}{conversation}/messages/{message}/", {"body":"Otra", "version":2}, format="json").status_code, 403)
        self.assertEqual(self.client.get(self.root).data["results"][0]["preview"], "Descripción")

    @patch("boldApp.mensajeria.upload_outbox.attach")
    def test_audio_formats_preview_and_private_download(self, store):
        store.side_effect = self.fake_store
        conversation = self.open()
        payload = b"\x1aE\xdf\xa3webm" + b"voice fixture" * 10
        result = self.upload(conversation, file=SimpleUploadedFile("nota.webm", payload, content_type="audio/webm;codecs=opus"))
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(self.client.get(self.root).data["results"][0]["preview"], "Nota de voz")
        path = f'{self.root}{conversation}/messages/{result.data["message"]["id"]}/media/'
        with patch("boldApp.workspace.image_storage.storage_user", return_value=self.alice.employee.user_account), patch("boldApp.workspace.service.google", return_value=SimpleNamespace(content=payload)) as remote:
            peer = self.as_person(self.bob).get(path)
            self.assertEqual(peer.status_code, 200)
            self.assertEqual(peer.content, payload)
            self.assertIn("no-store", peer["Cache-Control"])
            self.assertEqual(peer["X-Content-Type-Options"], "nosniff")
            remote.reset_mock()
            for person in [self.eve, self.owner]:
                self.assertEqual(self.as_person(person).get(path).status_code, 404)
            remote.assert_not_called()
        with patch("boldApp.workspace.image_storage.storage_user", return_value=self.alice.employee.user_account), patch("boldApp.workspace.service.google", return_value=SimpleNamespace(content=b"tampered")):
            self.assertEqual(self.client.get(path).status_code, 400)

    def test_drive_failure_rolls_back_message_and_no_root_is_actionable(self):
        self.auto_storage=False
        conversation = self.open()
        response = self.upload(conversation)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("Drive", str(response.data))
        self.assertEqual(DirectMessage.objects.count(), 0)
        self.drive()
        with patch("boldApp.mensajeria.upload_outbox.attach", side_effect=ValidationError("Drive temporalmente no disponible")):
            self.assertEqual(self.upload(conversation).status_code, 400)
        self.assertEqual(DirectMessage.objects.count(), 0)

    def test_publication_consumes_ready_media_without_provider_calls(self):
        conversation = self.open()
        with patch('boldApp.mensajeria.upload_provider.google',side_effect=AssertionError('publication cannot call Google')):
            result=self.upload(conversation)
        self.assertEqual(result.status_code,201,result.data)
        from .models import MediaUpload
        self.assertEqual(MediaUpload.objects.get().state,'attached')

    def test_invalid_mentions_preserve_the_private_ready_file_without_publishing(self):
        from .models import MediaUpload,SearchDocument
        body=' '.join(f'@person{i}@bold.gt' for i in range(21))
        result=self.upload(self.open(),body=body)
        self.assertEqual(result.status_code,400,result.data)
        self.assertFalse(DirectMessage.objects.exists());self.assertFalse(MessageMedia.objects.exists())
        self.assertFalse(SearchDocument.objects.exists());self.assertEqual(MediaUpload.objects.get().state,'ready')

    @patch("boldApp.mensajeria.upload_outbox.attach")
    def test_pilot_and_membership_reject_upload_before_drive(self, store):
        conversation = self.open()
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=[]):
            self.assertEqual(self.upload(conversation).status_code, 403)
        self.assertEqual(self.upload(conversation, client=self.as_person(self.eve)).status_code, 404)
        store.assert_not_called()

    @override_settings(AUTH_MFA_REQUIRED=False)
    @patch("boldApp.mensajeria.upload_outbox.attach")
    def test_real_cookie_multipart_csrf_and_stream_limit(self, store):
        from datetime import timedelta
        from django.conf import settings
        from django.utils import timezone
        from rest_framework.test import APIClient
        from boldApp.autenticacion.models import AuthSession
        from boldApp.autenticacion.services import token_hash
        store.side_effect = self.fake_store
        conversation = self.open(); raw = uuid.uuid4().hex
        AuthSession.objects.create(user_account=self.alice.employee.user_account, token_hash=token_hash(raw), credentials_version=1, expires_at=timezone.now()+timedelta(hours=1))
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[settings.AUTH_SESSION_COOKIE_NAME] = raw
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk))
        self.assertEqual(self.upload(conversation,client=client).status_code,403)
        csrf = "a" * 32
        client.cookies[settings.CSRF_COOKIE_NAME] = csrf
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(self.alice.pk),HTTP_X_CSRFTOKEN=csrf)
        good = self.upload(conversation,client=client)
        self.assertEqual(good.status_code,201,good.data)
        oversize = SimpleUploadedFile("large.png",b"x"*(MAX_BYTES+1),content_type="image/png")
        response = self.upload(conversation,client=client,file=oversize)
        self.assertEqual(response.status_code,400,response.data)
        self.assertEqual(store.call_count,1)
