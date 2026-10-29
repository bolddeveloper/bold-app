"""Logical capacity boundaries, including QR bytes; no real Google access."""
import uuid
from django.test import TransactionTestCase, override_settings
from . import test_upload_outbox as base
from .models import MediaUpload, MessageMedia, PhoneImage
from . import test_phone as phone_base
from .upload_outbox import cipher, perform


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_MFA_REQUIRED=False,
    CELERY_TASK_ALWAYS_EAGER=True, AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class UploadCapacityTests(TransactionTestCase):
    root=base.UploadOutboxTests.root
    identity=base.UploadOutboxTests.identity
    as_person=base.UploadOutboxTests.as_person
    open=base.UploadOutboxTests.open
    setUp=base.UploadOutboxTests.setUp
    queue=base.UploadOutboxTests.queue
    make_ready=base.UploadOutboxTests.make_ready
    send=base.UploadOutboxTests.send

    def test_exact_file_budget_counts_ready_and_published_once_and_preserves_idempotence(self):
        token=uuid.uuid4(); content=b'Capacity'
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=len(content)):
            first=self.queue(token,content); self.assertEqual(first.status_code,202,first.data)
            self.assertEqual(self.queue(token,content).status_code,200)
            self.assertEqual(self.queue(content=b'x').status_code,507)
            self.assertTrue(perform(first.data['id']))
            row=MediaUpload.objects.get(); self.assertEqual(self.send(row).status_code,201)
            self.assertEqual(self.queue(content=b'x').status_code,507)
        # Both the outbox and media refer to the same file; it is not charged twice.
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=len(content)+1):
            self.assertEqual(self.queue(content=b'x').status_code,202)
        self.assertEqual(MessageMedia.objects.count(),1)

    def test_cancel_before_remote_id_refunds_bytes_but_keeps_metadata(self):
        first=self.queue(content=b'Capacity'); row=MediaUpload.objects.get()
        self.assertEqual(self.client.post(self.url+str(row.pk)+'/',{'action':'cancel'},format='json').status_code,200)
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=1):
            self.assertEqual(self.queue(content=b'x').status_code,202)
        self.assertEqual(MediaUpload.objects.count(),2)

    def test_trash_or_missing_remote_object_never_automatically_refunds_budget(self):
        from django.utils import timezone
        row=self.make_ready()
        MediaUpload.objects.filter(pk=row.pk).update(state='cancelled',cleaned_at=timezone.now())
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=row.size_bytes):
            self.assertEqual(self.queue(content=b'x').status_code,507)

    def test_legacy_files_count_and_account_budget_is_independent_of_global(self):
        row=self.make_ready(); self.assertEqual(self.send(row).status_code,201)
        # Simulate pre-outbox media, retaining its historical independent UUID.
        MessageMedia.objects.filter(pk=row.pk).update(id=uuid.uuid4())
        MediaUpload.objects.filter(pk=row.pk).delete()
        with override_settings(MESSAGING_STORAGE_ACCOUNT_BYTES=row.size_bytes):
            self.assertEqual(self.queue(content=b'x').status_code,507)
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=row.size_bytes+1):
            self.assertEqual(self.queue(content=b'x').status_code,202)

    def test_metadata_cap_rejects_only_new_intents_and_allows_existing_resolution(self):
        row=self.make_ready()
        with override_settings(MESSAGING_UPLOAD_MAX_RECORDS=1):
            self.assertEqual(self.queue(row.client_id).status_code,200)
            self.assertEqual(self.queue().status_code,507)
            self.assertEqual(self.send(row).status_code,201)
            result=self.client.post(self.url+'discard/',{'client_id':str(row.client_id)},format='json')
            self.assertEqual(result.data['outcome'],'published')
            self.assertEqual(self.client.post(self.url+'discard/',{'client_id':str(uuid.uuid4())},format='json').status_code,507)
        self.assertEqual(MediaUpload.objects.count(),1)

    def test_account_record_cap_includes_empty_stops_and_allows_cancel(self):
        row=self.make_ready()
        with override_settings(MESSAGING_UPLOAD_ACCOUNT_MAX_RECORDS=1):
            response=self.client.post(self.url+'discard/',{'client_id':str(row.client_id)},format='json')
            self.assertEqual(response.data['outcome'],'cancelled')
            self.assertEqual(self.queue().status_code,507)
        self.assertEqual(MediaUpload.objects.count(),1)


@override_settings(MESSAGING_PILOT_ENABLED=False, AUTH_MFA_REQUIRED=False,
    CELERY_TASK_ALWAYS_EAGER=True, AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class PhoneCapacityTests(TransactionTestCase):
    root=phone_base.PhoneTransferTests.root
    identity=phone_base.PhoneTransferTests.identity
    as_person=phone_base.PhoneTransferTests.as_person
    open=phone_base.PhoneTransferTests.open
    setUp=phone_base.PhoneTransferTests.setUp
    create=phone_base.PhoneTransferTests.create
    pair=phone_base.PhoneTransferTests.pair
    picture=phone_base.PhoneTransferTests.picture
    upload=phone_base.PhoneTransferTests.upload
    ready=phone_base.PhoneTransferTests.ready

    def test_qr_uses_the_shared_temporary_budget_and_duplicate_does_not_reserve_twice(self):
        self.ready(); token=uuid.uuid4()
        self.assertEqual(self.upload(token).status_code,201)
        size=PhoneImage.objects.get().size_bytes
        with override_settings(MESSAGING_UPLOAD_QUEUE_BYTES=size):
            self.assertEqual(self.upload(token).status_code,200)
            self.assertEqual(self.upload().status_code,429)
        with override_settings(MESSAGING_UPLOAD_ACCOUNT_BYTES=size):
            self.assertEqual(self.upload().status_code,429)
        self.assertEqual(PhoneImage.objects.count(),1)
        self.assertEqual(self.client.delete(self.url).status_code,204)
        self.ready()
        with override_settings(MESSAGING_UPLOAD_QUEUE_BYTES=size):
            self.assertEqual(self.upload().status_code,201)

    def test_phone_and_encrypted_staging_copies_both_count_until_phone_is_removed(self):
        from boldApp.workspace.models import ImageStorageRoot
        ImageStorageRoot.objects.create(user=self.alice.employee.user_account,subject='synthetic',client_id='synthetic',
            google_email='fixture@example.invalid',folder_id='synthetic_root',folder_name='BOLD APP',active=True)
        self.ready(); self.assertEqual(self.upload().status_code,201)
        size=PhoneImage.objects.get().size_bytes
        url=self.root+self.conversation+'/uploads/'
        file_bytes=b'Capacity'
        limit=size+len(cipher().encrypt(file_bytes))-1
        def queue():
            from django.core.files.uploadedfile import SimpleUploadedFile
            return self.client.post(url,{'client_id':str(uuid.uuid4()),
                'file':SimpleUploadedFile('revision.txt',file_bytes,content_type='text/plain')},format='multipart')
        with override_settings(MESSAGING_UPLOAD_QUEUE_BYTES=limit):
            self.assertEqual(queue().status_code,429)
            self.assertEqual(self.client.delete(self.url).status_code,204)
            self.assertEqual(queue().status_code,202)

    def test_phone_metadata_cannot_bypass_record_limit_and_existing_image_can_be_retried(self):
        self.ready();token=uuid.uuid4()
        self.assertEqual(self.upload(token).status_code,201)
        with override_settings(MESSAGING_UPLOAD_MAX_RECORDS=1):
            self.assertEqual(self.upload(token).status_code,200)
            self.assertEqual(self.upload().status_code,507)
        with override_settings(MESSAGING_UPLOAD_ACCOUNT_MAX_RECORDS=1):
            self.assertEqual(self.upload().status_code,507)
        self.assertEqual(PhoneImage.objects.count(),1)
