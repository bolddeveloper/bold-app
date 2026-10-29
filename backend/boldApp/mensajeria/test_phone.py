import io
import secrets
import uuid
from types import SimpleNamespace
from unittest.mock import patch
from datetime import timedelta

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from boldApp.autenticacion.models import AuthSession
from . import tests as chat_tests
from .models import PhoneTransfer, PhoneImage, DirectMessage, DepartmentChannel, ChannelAccessRule
from .phone_views import cleanup_phone_transfers


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-phone-staging-tests-only')
class PhoneTransferTests(TransactionTestCase):
    identity = chat_tests.DirectChatTests.identity
    as_person = chat_tests.DirectChatTests.as_person
    open = chat_tests.DirectChatTests.open
    root = chat_tests.DirectChatTests.root

    def setUp(self):
        from boldApp.core.models import Permission
        for resource,action in (('channel','read'),('message','create')):
            Permission.objects.get_or_create(code=f'slack.{resource}.{action}',defaults={
                'module_code':'slack','resource':resource,'action':action,'risk_level':'low'})
        chat_tests.DirectChatTests.setUp(self)
        self.session = AuthSession.objects.create(user_account=self.alice.employee.user_account,
            token_hash=secrets.token_hex(32), credentials_version=self.alice.employee.user_account.credentials_version,
            expires_at=timezone.now() + timedelta(hours=1))
        self.client.force_authenticate(self.alice.employee.user_account, token=self.session)
        self.conversation = self.open()
        self.base = "/api/v2/messaging/phone-transfers/"
        self.mobile = APIClient()
        self.device = secrets.token_urlsafe(32)

    def create(self, **target):
        result = self.client.post(self.base, target or {"conversation_id":self.conversation}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.url = self.base + result.data["id"] + "/"
        self.claim = result.data["claim_token"]
        return result.data

    def pair(self):
        self.mobile.credentials(HTTP_AUTHORIZATION="Bearer " + self.claim)
        result = self.mobile.post(self.url + "claim/", {"device_token":self.device}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.mobile.credentials(HTTP_AUTHORIZATION="Bearer " + self.device)
        return result.data["pairing_code"]

    def picture(self):
        stream = io.BytesIO(); Image.new("RGB", (60,40), "red").save(stream, "PNG")
        return SimpleUploadedFile("photo.png", stream.getvalue(), content_type="image/png")

    def upload(self, client_id=None):
        return self.mobile.post(self.url + "mobile/", {"file": self.picture(), "client_id":str(client_id or uuid.uuid4())}, format="multipart")

    def ready(self):
        self.create(); code = self.pair()
        self.assertEqual(self.client.post(self.url + "approve/", {"pairing_code":code}, format="json").status_code, 200)

    def test_approval_draft_only_download_idempotence_and_seal(self):
        self.create(); code = self.pair()
        self.assertEqual(self.upload().status_code, 403)
        self.assertEqual(self.client.post(self.url + "approve/", {"pairing_code":"wrong"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url + "approve/", {"pairing_code":code}, format="json").status_code, 200)
        retry = uuid.uuid4()
        first = self.upload(retry); self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(self.upload(retry).status_code, 200)
        self.assertEqual(PhoneImage.objects.count(), 1)
        self.assertEqual(DirectMessage.objects.count(), 0)
        path = self.url + "images/" + first.data["id"] + "/"
        result = self.client.get(path)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result["Cache-Control"], "private, no-store")
        with Image.open(io.BytesIO(result.content)) as image:
            self.assertEqual(image.format, "WEBP"); self.assertFalse(image.getexif())
        self.assertIn(self.mobile.get(path).status_code, (401,403))
        self.assertEqual(self.client.post(self.url + "seal/", {}, format="json").status_code, 200)
        self.assertEqual(self.upload().status_code, 409)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertEqual(PhoneImage.objects.count(), 0)

    def test_only_one_phone_can_claim_and_no_raw_secrets_stored(self):
        self.create(); self.pair()
        self.mobile.credentials(HTTP_AUTHORIZATION="Bearer " + self.claim)
        self.assertEqual(self.mobile.post(self.url + "claim/", {"device_token":secrets.token_urlsafe(32)}, format="json").status_code, 409)
        row = PhoneTransfer.objects.get()
        self.assertNotEqual(row.claim_hash, self.claim); self.assertNotEqual(row.device_hash, self.device)
        self.assertNotIn("claim_token", self.client.get(self.url).data)

    def test_replacement_expiry_cleanup_and_ownership(self):
        self.ready(); self.upload(); old = self.url
        self.assertEqual(self.as_person(self.eve).get(old).status_code, 404)
        self.create()
        self.assertEqual(self.client.get(old).status_code, 404)
        self.assertEqual(PhoneImage.objects.count(), 0)
        self.pair()
        PhoneTransfer.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.mobile.get(self.url+"mobile/").status_code, 404)
        cleanup_phone_transfers(); self.assertFalse(PhoneTransfer.objects.exists())

    def test_revocation_password_and_assignment_close_mobile_capability(self):
        self.ready()
        self.session.revoked_at = timezone.now(); self.session.save()
        self.assertEqual(self.upload().status_code, 404)
        self.session.revoked_at = None; self.session.save()
        self.alice.is_active = False; self.alice.save()
        self.assertEqual(self.upload().status_code, 404)

    def test_pilot_and_limits(self):
        self.ready()
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=()):
            self.assertEqual(self.upload().status_code, 404)
        for _ in range(10): self.assertEqual(self.upload().status_code, 201)
        self.assertEqual(self.upload().status_code, 400)

    def test_owner_can_cancel_after_leaving_pilot_without_read_access(self):
        self.ready()
        with override_settings(MESSAGING_PILOT_ENABLED=True, MESSAGING_PILOT_UNIT_IDS=()):
            self.assertEqual(self.client.get(self.url).status_code,403)
            self.assertEqual(self.client.delete(self.url).status_code,204)
        self.assertFalse(PhoneTransfer.objects.exists())

    def test_private_channel_revocation_and_archiving(self):
        channel = DepartmentChannel.objects.create(unit=self.unit, creator=self.alice, name="Private", visibility="private")
        rule = ChannelAccessRule.objects.create(channel=channel, employee=self.alice.employee, access="write")
        self.create(channel_id=str(channel.pk)); code = self.pair()
        self.assertEqual(self.client.post(self.url+"approve/", {"pairing_code":code}, format="json").status_code, 200)
        self.assertEqual(self.upload().status_code, 201)
        rule.access="read"; rule.save()
        self.assertEqual(self.upload().status_code, 403)
        rule.access="write"; rule.save(); channel.archived_at=timezone.now(); channel.save()
        self.assertEqual(self.upload().status_code, 403)

    def test_invalid_target_and_non_image(self):
        self.assertEqual(self.client.post(self.base, [], format="json").status_code,400)
        self.assertEqual(self.client.post(self.base, {"conversation_id":"bad"}, format="json").status_code,400)
        self.create()
        self.mobile.credentials(HTTP_AUTHORIZATION="Bearer " + self.claim)
        self.assertEqual(self.mobile.post(self.url+"claim/", [], format="json").status_code,400)
        self.ready()
        bad = SimpleUploadedFile("x.svg", b"<svg/>", content_type="image/svg+xml")
        result = self.mobile.post(self.url+"mobile/", {"file":bad,"client_id":str(uuid.uuid4())}, format="multipart")
        self.assertEqual(result.status_code,400); self.assertEqual(PhoneImage.objects.count(),0)

    def test_queue_capacity_is_bound_to_the_link(self):
        self.create(conversation_id=self.conversation, max_images=1)
        code=self.pair()
        self.client.post(self.url+"approve/", {"pairing_code":code}, format="json")
        self.assertEqual(self.upload().status_code,201)
        self.assertEqual(self.upload().status_code,400)

    def test_phone_pixels_reach_private_drive_only_on_explicit_send(self):
        from boldApp.workspace.models import ImageStorageRoot
        from .models import MessageMedia
        from .channel_validation import LocalDrive
        self.ready()
        image_id=self.upload().data["id"]
        self.client.post(self.url+"seal/", {}, format="json")
        pixels=self.client.get(self.url+"images/"+image_id+"/").content
        self.assertEqual(DirectMessage.objects.count(),0)
        self.assertEqual(MessageMedia.objects.count(),0)
        ImageStorageRoot.objects.create(user=self.alice.employee.user_account, subject="fixture", client_id="fixture",
            google_email="fixture@bold.gt",folder_id="fixture_root",folder_name="BOLD APP",active=True)
        drive=LocalDrive()
        from .upload_outbox import perform
        nonce=str(uuid.uuid4());base=self.root+self.conversation+'/'
        with patch("boldApp.mensajeria.upload_provider.storage_user",return_value=self.alice.employee.user_account), \
                patch("boldApp.mensajeria.upload_provider.google",side_effect=drive.google):
            queued=self.client.post(base+'uploads/',{'client_id':nonce,'file':SimpleUploadedFile('phone.webp',pixels,content_type='image/webp')},format='multipart')
            self.assertEqual(queued.status_code,202,queued.data)
            self.assertFalse(drive.files,'preparing does not synchronously upload or publish')
            self.assertTrue(perform(queued.data['id']))
            self.assertEqual(DirectMessage.objects.count(),0)
            result=self.client.post(base+'messages/',{'body':'Desde teléfono','client_id':nonce,'upload_id':queued.data['id']},format='json')
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(MessageMedia.objects.count(),1)
        self.assertEqual(sum(bool(row['content']) for row in drive.files.values()),1)
        remote=next(row for row in drive.files.values() if row['content'])
        self.assertNotIn("permissions",remote["metadata"])
        message_id=result.data["message"]["id"]
        with patch("boldApp.workspace.image_storage.storage_user",return_value=self.alice.employee.user_account), \
                patch("boldApp.workspace.service.google",return_value=SimpleNamespace(content=remote["content"])):
            recipient=self.as_person(self.bob).get(self.root+self.conversation+"/messages/"+message_id+"/media/")
        self.assertEqual(recipient.status_code,200)
        self.assertEqual(self.as_person(self.eve).get(self.root+self.conversation+"/messages/"+message_id+"/media/").status_code,404)
