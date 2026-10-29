"""Explicit discard: private nonce stops, no deletion of published messages."""
import uuid
from datetime import timedelta
from django.test import TransactionTestCase,override_settings
from django.db import IntegrityError,transaction
from django.utils import timezone
from boldApp.core.models import Position,PositionAssignment
from . import test_upload_outbox as base
from .models import MediaUpload,DirectMessage,DepartmentChannel
from .upload_outbox import perform
from .upload_cleanup import reconcile


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class UploadDiscardTests(TransactionTestCase):
    root=base.UploadOutboxTests.root
    identity=base.UploadOutboxTests.identity
    as_person=base.UploadOutboxTests.as_person
    open=base.UploadOutboxTests.open
    setUp=base.UploadOutboxTests.setUp
    queue=base.UploadOutboxTests.queue
    make_ready=base.UploadOutboxTests.make_ready
    send=base.UploadOutboxTests.send

    def discard(self,nonce,url=None,client=None):
        return (client or self.client).post((url or self.url)+'discard/',{'client_id':str(nonce)},format='json')

    def test_empty_stop_fences_a_late_upload_without_bytes_root_or_provider_calls(self):
        nonce=uuid.uuid4();response=self.discard(nonce)
        self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data['outcome'],'cancelled')
        row=MediaUpload.objects.get();self.assertIsNone(row.root_id)
        self.assertEqual(row.state,'cancelled');self.assertEqual(row.size_bytes,0);self.assertEqual(bytes(row.content),b'')
        self.assertEqual(self.queue(nonce).data['state'],'cancelled');self.assertFalse(perform(row.pk))
        self.assertEqual(self.discard(nonce).data,response.data)
        self.assertEqual(MediaUpload.objects.count(),1);self.assertEqual(self.drive.calls,[])
        self.assertFalse(DirectMessage.objects.exists());self.assertEqual(self.client.get(self.url+'discard/').status_code,405)

    def test_pending_and_ready_uploads_are_cancelled_without_a_published_message(self):
        for ready in (False,True):
            result=self.queue();row=MediaUpload.objects.get(pk=result.data['id'])
            if ready:self.assertTrue(perform(row.pk))
            value=self.discard(row.client_id);self.assertEqual(value.data['outcome'],'cancelled')
            row.refresh_from_db();self.assertEqual(row.state,'cancelled');self.assertEqual(row.cipher_bytes,0)
            self.assertEqual(self.send(row).status_code,409);self.assertFalse(DirectMessage.objects.exists())

    def test_retired_text_nonce_cannot_be_revived_and_published_text_is_preserved(self):
        url=self.url.removesuffix('uploads/')+'messages/'
        nonce=uuid.uuid4();self.assertEqual(self.discard(nonce).data['outcome'],'cancelled')
        payload={'client_id':str(nonce),'body':'Texto atrasado'}
        self.assertEqual(self.client.post(url,payload,format='json').status_code,409)
        self.assertFalse(DirectMessage.objects.exists())
        fresh=uuid.uuid4();payload.update(client_id=str(fresh),body='Texto publicado')
        value=self.client.post(url,payload,format='json');self.assertEqual(value.status_code,201,value.data)
        message=value.data['message']['id'];DirectMessage.objects.filter(pk=message).update(body='Edición posterior',version=2)
        self.assertEqual(self.discard(fresh).data,{'outcome':'published','message_id':message})
        self.assertEqual(DirectMessage.objects.get(pk=message).body,'Edición posterior')

    def test_inflight_provider_cannot_revive_a_stop_and_cleanup_uses_recoverable_trash(self):
        result=self.queue();row=MediaUpload.objects.get(pk=result.data['id'])
        self.drive.after_upload=lambda:self.assertEqual(self.discard(row.client_id).data['outcome'],'cancelled')
        self.assertFalse(perform(row.pk));row.refresh_from_db();self.assertEqual(row.state,'cancelled')
        self.assertFalse(reconcile(row.pk),'lease of old worker must elapse before cleanup')
        MediaUpload.objects.filter(pk=row.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertTrue(reconcile(row.pk));self.assertTrue(self.drive.files[row.drive_id]['metadata']['trashed'])
        self.assertFalse(DirectMessage.objects.exists())

    def test_publication_wins_without_deleting_or_replacing_the_message(self):
        row=self.make_ready();response=self.send(row);self.assertEqual(response.status_code,201)
        message=response.data['message']['id'];DirectMessage.objects.filter(pk=message).update(body='Edición posterior',version=2)
        value=self.discard(row.client_id);self.assertEqual(value.data,{'outcome':'published','message_id':message})
        self.assertEqual(DirectMessage.objects.get(pk=message).body,'Edición posterior')
        row.refresh_from_db();self.assertEqual(row.state,'attached');self.assertFalse(self.drive.files[row.drive_id]['metadata']['trashed'])

    def test_other_accounts_and_assignments_cannot_cancel_the_owners_upload(self):
        row=self.make_ready();peer=self.as_person(self.bob)
        from boldApp.autenticacion.models import AuthSession
        session=AuthSession.objects.create(user_account=self.bob.employee.user_account,token_hash=uuid.uuid4().hex,
            credentials_version=1,expires_at=timezone.now()+timedelta(hours=1))
        peer.force_authenticate(self.bob.employee.user_account,token=session)
        value=self.discard(row.client_id,client=peer);self.assertEqual(value.data['outcome'],'cancelled')
        self.assertNotEqual(value.data['upload']['id'],str(row.pk));row.refresh_from_db();self.assertEqual(row.state,'ready')
        second=PositionAssignment.objects.create(employee=self.alice.employee,position=Position.objects.create(unit=self.unit,job_role=self.role))
        client=self.as_person(second);client.force_authenticate(self.alice.employee.user_account,token=self.session)
        self.assertEqual(self.discard(row.client_id,client=client).status_code,404)

    def test_archived_channel_can_discard_own_preparation_but_not_publish_it(self):
        channel=self.client.post('/api/v2/messaging/channels/',{'unit_id':str(self.unit.pk),'name':'Archivos'},format='json').data['id']
        url=f'/api/v2/messaging/channels/{channel}/uploads/'
        queued=self.queue(url=url);DepartmentChannel.objects.filter(pk=channel).update(archived_at=timezone.now())
        value=self.discard(queued.data['client_id'],url=url);self.assertEqual(value.status_code,200,value.data)
        self.assertEqual(value.data['outcome'],'cancelled')
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=()):
            self.assertEqual(self.discard(queued.data['client_id'],url=url).status_code,403)

    def test_rootless_stops_cannot_be_promoted_to_an_upload(self):
        self.discard(uuid.uuid4());row=MediaUpload.objects.get()
        with self.assertRaises(IntegrityError),transaction.atomic():
            MediaUpload.objects.filter(pk=row.pk).update(state='queued')
        self.assertFalse(perform(row.pk));self.assertEqual(self.drive.calls,[])

    def test_empty_stop_rate_cap_never_blocks_cancelling_an_existing_file(self):
        from .upload_outbox import identity,TTL
        ready=self.make_ready();now=timezone.now()
        MediaUpload.objects.bulk_create([MediaUpload(id=identity('chat',self.conversation,self.alice.employee.user_account.pk,nonce),
            account=self.alice.employee.user_account,assignment=self.alice,conversation_id=self.conversation,client_id=nonce,
            state='cancelled',size_bytes=0,kind='',mime_type='',filename='',digest='',next_at=now,expires_at=now+TTL)
            for nonce in (uuid.uuid4() for _ in range(200))])
        self.assertEqual(self.discard(uuid.uuid4()).status_code,429)
        self.assertEqual(self.discard(ready.client_id).data['outcome'],'cancelled')
        existing=MediaUpload.objects.filter(root__isnull=True).first()
        self.assertEqual(self.discard(existing.client_id).data['outcome'],'cancelled','idempotent checks do not consume another slot')
