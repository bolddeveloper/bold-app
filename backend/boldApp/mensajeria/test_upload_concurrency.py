"""Row locks/quotas require PostgreSQL; SQLite must not certify concurrency."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from django.db import connection, close_old_connections, connections
from django.test import TransactionTestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from . import test_upload_outbox as base
from .models import MediaUpload, DirectMessage, MessageMedia
from .upload_outbox import cipher, perform


@skipUnless(connection.vendor=='postgresql','Requires isolated PostgreSQL row locks')
@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class UploadConcurrencyTests(TransactionTestCase):
    root=base.UploadOutboxTests.root
    identity=base.UploadOutboxTests.identity
    as_person=base.UploadOutboxTests.as_person
    open=base.UploadOutboxTests.open
    setUp=base.UploadOutboxTests.setUp
    queue=base.UploadOutboxTests.queue
    make_ready=base.UploadOutboxTests.make_ready
    send=base.UploadOutboxTests.send

    def parallel(self,*actions):
        barrier=Barrier(len(actions),timeout=10)
        def run(action):
            close_old_connections()
            try:
                barrier.wait();return action()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(actions)) as executor:
            futures=[executor.submit(run,action) for action in actions]
            return [future.result(timeout=30) for future in futures]

    def client_for_thread(self):
        client=self.as_person(self.alice)
        client.force_authenticate(self.alice.employee.user_account,token=self.session)
        return client

    def queued(self,token):
        return self.client_for_thread().post(self.url,{'client_id':str(token),
            'file':SimpleUploadedFile('revision.txt',b'Documento privado de prueba',content_type='text/plain')},format='multipart').status_code

    def test_same_request_reserves_exactly_one_row_without_network(self):
        token=uuid.uuid4()
        self.assertEqual(sorted(self.parallel(lambda:self.queued(token),lambda:self.queued(token))),[200,202])
        self.assertEqual(MediaUpload.objects.count(),1);self.assertEqual(self.drive.calls,[])

    def test_concurrent_reservations_cannot_exceed_the_ciphertext_budget(self):
        capacity=len(cipher().encrypt(b'Documento privado de prueba'))
        with override_settings(MESSAGING_UPLOAD_QUEUE_BYTES=capacity):
            result=self.parallel(lambda:self.queued(uuid.uuid4()),lambda:self.queued(uuid.uuid4()))
        self.assertEqual(sorted(result),[202,429]);self.assertEqual(MediaUpload.objects.count(),1)

    def test_two_workers_and_two_publications_do_not_duplicate_file_or_message(self):
        response=self.queue();identity=response.data['id']
        self.assertEqual(sorted(self.parallel(lambda:perform(identity),lambda:perform(identity))),[False,True])
        row=MediaUpload.objects.get(pk=identity)
        files=[item for item in self.drive.files.values() if item['metadata']['mimeType']=='text/plain']
        self.assertEqual(len(files),1)
        def publish():
            return self.client_for_thread().post(f'{self.root}{self.conversation}/messages/',{
                'client_id':str(row.client_id),'upload_id':str(row.pk),'body':'Concurrencia'},format='json').status_code
        self.assertEqual(sorted(self.parallel(publish,publish)),[200,201])
        self.assertEqual(DirectMessage.objects.count(),1);self.assertEqual(MessageMedia.objects.count(),1)
        self.assertTrue(all(not atomic for _,_,atomic in self.drive.calls))

    def test_cancel_and_publication_are_mutually_exclusive(self):
        row=self.make_ready()
        def publish():
            return self.client_for_thread().post(f'{self.root}{self.conversation}/messages/',{
                'client_id':str(row.client_id),'upload_id':str(row.pk),'body':''},format='json').status_code
        def cancel():
            return self.client_for_thread().post(self.url+str(row.pk)+'/',{'action':'cancel'},format='json').status_code
        result=self.parallel(publish,cancel);row.refresh_from_db()
        self.assertEqual(result.count(409),1)
        self.assertEqual(row.state,'attached' if result[0]==201 else 'cancelled')
        self.assertEqual(DirectMessage.objects.count(),int(row.state=='attached'))

    def test_nonce_discard_fences_a_concurrent_enqueue_without_duplicate_or_fk_deadlock(self):
        nonce=uuid.uuid4()
        def discard():return self.client_for_thread().post(self.url+'discard/',{'client_id':str(nonce)},format='json').status_code
        result=self.parallel(lambda:self.queued(nonce),discard)
        self.assertIn(result[0],(200,202));self.assertEqual(result[1],200)
        row=MediaUpload.objects.get();self.assertEqual(row.state,'cancelled');self.assertFalse(perform(row.pk))
        self.assertEqual(self.drive.calls,[]);self.assertEqual(row.cipher_bytes,0)

    def test_nonce_discard_and_publication_have_one_serialized_outcome(self):
        row=self.make_ready()
        def publish():return self.client_for_thread().post(f'{self.root}{self.conversation}/messages/',
            {'client_id':str(row.client_id),'upload_id':str(row.pk),'body':'Carrera con descarte'},format='json').status_code
        def discard():return self.client_for_thread().post(self.url+'discard/',{'client_id':str(row.client_id)},format='json').data['outcome']
        result=self.parallel(publish,discard);row.refresh_from_db()
        self.assertIn(tuple(result),((201,'published'),(409,'cancelled')))
        self.assertEqual(row.state,'attached' if result[0]==201 else 'cancelled')
        self.assertEqual(DirectMessage.objects.count(),int(result[0]==201))

    def test_text_forward_discard_and_late_publication_are_serialized(self):
        nonce=uuid.uuid4()
        def publish():return self.client_for_thread().post(f'{self.root}{self.conversation}/messages/',
            {'client_id':str(nonce),'body':'Reenvío de texto'},format='json').status_code
        def discard():return self.client_for_thread().post(self.url+'discard/',{'client_id':str(nonce)},format='json').data['outcome']
        result=self.parallel(publish,discard)
        self.assertIn(tuple(result),((201,'published'),(409,'cancelled')))
        self.assertEqual(DirectMessage.objects.count(),int(result[0]==201))

    def test_global_managed_budget_serializes_different_accounts_and_containers(self):
        import secrets
        from datetime import timedelta
        from django.utils import timezone
        from boldApp.autenticacion.models import AuthSession
        bob=self.as_person(self.bob)
        session=AuthSession.objects.create(user_account=self.bob.employee.user_account,
            token_hash=secrets.token_hex(32),credentials_version=self.bob.employee.user_account.credentials_version,
            expires_at=timezone.now()+timedelta(hours=1))
        bob.force_authenticate(self.bob.employee.user_account,token=session)
        response=bob.post(self.root,{'employee_id':str(self.eve.employee_id)},format='json')
        self.assertEqual(response.status_code,201,response.data)
        url=self.root+response.data['id']+'/uploads/'
        def queue_bob():
            client=self.as_person(self.bob);client.force_authenticate(self.bob.employee.user_account,token=session)
            return client.post(url,{'client_id':str(uuid.uuid4()),'file':SimpleUploadedFile(
                'revision.txt',b'Documento privado de prueba',content_type='text/plain')},format='multipart').status_code
        with override_settings(MESSAGING_STORAGE_TOTAL_BYTES=len(b'Documento privado de prueba')):
            self.assertEqual(sorted(self.parallel(lambda:self.queued(uuid.uuid4()),queue_bob)),[202,507])
        self.assertEqual(MediaUpload.objects.count(),1);self.assertEqual(self.drive.calls,[])

    def phone_fixture(self):
        import io,secrets
        from datetime import timedelta
        from django.utils import timezone
        from PIL import Image
        from .models import PhoneTransfer
        from .phone_views import digest
        token=secrets.token_urlsafe(32)
        # Different container from the outbox request: exercise the GLOBAL lock.
        other=self.open(self.eve)
        row=PhoneTransfer.objects.create(account=self.alice.employee.user_account,session=self.session,
            assignment=self.alice,conversation_id=other,claim_hash=digest('synthetic-claim'),
            device_hash=digest(token),approved=True,expires_at=timezone.now()+timedelta(minutes=5))
        stream=io.BytesIO();Image.new('RGB',(60,40),'red').save(stream,'PNG')
        return row,token,stream.getvalue()

    def phone_upload(self,row,token,pixels):
        from rest_framework.test import APIClient
        client=APIClient();client.credentials(HTTP_AUTHORIZATION='Bearer '+token)
        return client.post(f'/api/v2/messaging/phone-transfers/{row.pk}/mobile/',{
            'client_id':str(uuid.uuid4()),'file':SimpleUploadedFile('photo.png',pixels,content_type='image/png')},format='multipart').status_code

    def test_phone_and_outbox_cannot_overbook_shared_temporary_bytes(self):
        from .models import PhoneImage
        from .media import prepare
        row,token,pixels=self.phone_fixture()
        phone_bytes=prepare(SimpleUploadedFile('photo.png',pixels,content_type='image/png'))['size_bytes']
        staged_bytes=len(cipher().encrypt(b'Documento privado de prueba'))
        with override_settings(MESSAGING_UPLOAD_QUEUE_BYTES=max(phone_bytes,staged_bytes)):
            result=self.parallel(lambda:self.queued(uuid.uuid4()),lambda:self.phone_upload(row,token,pixels))
        self.assertIn(tuple(result),((202,429),(429,201)))
        self.assertEqual(MediaUpload.objects.count()+PhoneImage.objects.count(),1)

    def test_replacing_qr_and_uploading_while_staging_do_not_deadlock_or_keep_old_image(self):
        from .models import PhoneTransfer,PhoneImage
        row,token,pixels=self.phone_fixture()
        def replace():
            return self.client_for_thread().post('/api/v2/messaging/phone-transfers/',
                {'conversation_id':self.conversation},format='json').status_code
        result=self.parallel(lambda:self.queued(uuid.uuid4()),lambda:self.phone_upload(row,token,pixels),replace)
        self.assertEqual(result[0],202);self.assertIn(result[1],(201,404));self.assertEqual(result[2],201)
        self.assertEqual(PhoneTransfer.objects.count(),1)
        self.assertFalse(PhoneTransfer.objects.filter(pk=row.pk).exists())
        self.assertEqual(PhoneImage.objects.count(),0)
