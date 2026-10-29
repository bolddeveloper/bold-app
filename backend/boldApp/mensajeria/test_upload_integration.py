"""Ownership-safe lookup and private hints; simulated Drive, isolated accounts."""
import uuid
from types import SimpleNamespace
from django.test import TransactionTestCase,override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import PositionAssignment,Position
from . import test_upload_outbox as base
from .models import DirectMessage
from .upload_events import upload_event


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class UploadRecoveryTests(TransactionTestCase):
    root=base.UploadOutboxTests.root
    identity=base.UploadOutboxTests.identity
    as_person=base.UploadOutboxTests.as_person
    open=base.UploadOutboxTests.open
    setUp=base.UploadOutboxTests.setUp
    queue=base.UploadOutboxTests.queue
    make_ready=base.UploadOutboxTests.make_ready
    send=base.UploadOutboxTests.send

    def test_lookup_finds_ready_and_confirmed_without_disclosing_another_authors_attempt(self):
        row=self.make_ready();path=self.url+'?client_id='+str(row.client_id)
        value=self.client.get(path);self.assertEqual(value.status_code,200,value.data)
        self.assertEqual(value.data['results'][0]['state'],'ready');self.assertIsNone(value.data['message_id'])
        self.assertEqual(self.send(row).status_code,201);row.refresh_from_db()
        DirectMessage.objects.filter(pk=row.message_id).update(body='Editado después de confirmar',version=2)
        value=self.client.get(path);self.assertEqual(value.data['message_id'],str(row.message_id))
        current=self.client.get(f'{self.root}{self.conversation}/messages/{row.message_id}/')
        self.assertEqual(current.data['message']['body'],'Editado después de confirmar')
        peer=self.as_person(self.bob);value=peer.get(path)
        self.assertEqual(value.data,{'results':[],'message_id':None})
        self.assertEqual(self.client.get(self.url+'?client_id=not-an-id').status_code,400)
        self.assertEqual(self.client.get(self.url+'?client_id='+str(row.client_id)+'&account=other').status_code,400)

    def test_hints_contain_only_opaque_scope_and_require_current_assignment_session_and_acl(self):
        response=self.queue();identity=response.data['id'];event={'upload_id':identity}
        envelope=upload_event(self.alice.pk,self.session.pk,event)
        self.assertEqual(set(envelope['payload']),{'upload_id','kind','container_id','client_id'})
        self.assertNotIn('filename',str(envelope));self.assertNotIn('drive_id',str(envelope))
        self.assertIsNone(upload_event(self.bob.pk,self.session.pk,event))
        second=PositionAssignment.objects.create(employee=self.alice.employee,position=Position.objects.create(unit=self.other_unit,job_role=self.role))
        self.assertIsNone(upload_event(second.pk,self.session.pk,event))
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=()):
            self.assertIsNone(upload_event(self.alice.pk,self.session.pk,event))
        AuthSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now())
        self.assertIsNone(upload_event(self.alice.pk,self.session.pk,event))

    def test_legacy_file_publication_is_retired_for_chat_channels_and_threads_without_provider_io(self):
        from .models import MediaUpload,ChannelMessage
        from unittest.mock import patch
        channel=self.client.post('/api/v2/messaging/channels/',{'unit_id':str(self.unit.pk),'name':'Archivos'},format='json').data['id']
        channel_url=f'/api/v2/messaging/channels/{channel}/'
        parent=self.client.post(channel_url+'messages/',{'client_id':str(uuid.uuid4()),'body':'Raíz'},format='json').data['message']['id']
        for url,extra in ((f'{self.root}{self.conversation}/',{}),(channel_url,{}),(channel_url,{'parent_id':parent})):
            with patch('boldApp.mensajeria.upload_provider.google',side_effect=AssertionError('no provider on legacy endpoint')),patch('boldApp.mensajeria.media.google',side_effect=AssertionError('no legacy provider')):
                response=self.client.post(url+'messages/',{'client_id':str(uuid.uuid4()),'body':'Conserva el borrador',
                    'file':SimpleUploadedFile('legacy.txt',b'Synthetic stale PWA',content_type='text/plain'),**extra},format='multipart')
            self.assertEqual(response.status_code,409,response.data)
            self.assertIn('Actualiza BOLD',str(response.data));self.assertIn('intento original',str(response.data))
        self.assertEqual(DirectMessage.objects.count(),0);self.assertEqual(ChannelMessage.objects.count(),1)
        self.assertEqual(MediaUpload.objects.count(),0);self.assertEqual(self.drive.calls,[])
        # JSON pretending to carry a file cannot revive a second code path.
        self.assertEqual(self.client.post(f'{self.root}{self.conversation}/messages/',
            {'client_id':str(uuid.uuid4()),'body':'','file':'spoof'},format='json').status_code,409)
        import json
        for payload in (None,[],7,'file'):
            value=self.client.generic('POST',f'{self.root}{self.conversation}/messages/',json.dumps(payload),content_type='application/json')
            self.assertEqual(value.status_code,400,value.data)

    def test_stale_file_retry_keeps_the_original_nonce_recoverable_without_republishing(self):
        row=self.make_ready();self.assertEqual(self.send(row).status_code,201)
        writes=len(self.drive.calls)
        response=self.client.post(f'{self.root}{self.conversation}/messages/',{'client_id':str(row.client_id),
            'body':'Archivo listo','file':SimpleUploadedFile('legacy.txt',b'Old client retry',content_type='text/plain')},format='multipart')
        self.assertEqual(response.status_code,409)
        value=self.client.get(self.url+'?client_id='+str(row.client_id))
        row.refresh_from_db();self.assertEqual(value.data['message_id'],str(row.message_id))
        self.assertEqual(DirectMessage.objects.count(),1);self.assertEqual(len(self.drive.calls),writes)


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-cookie-tests-only')
class UploadSocketTests(TransactionTestCase):
    setUp=base.UploadCookieTests.setUp
    queue=base.UploadCookieTests.queue

    def test_real_cookie_stale_client_is_rejected_without_a_message_and_csrf_still_applies(self):
        from rest_framework.test import APIClient
        from .models import ChannelMessage,MediaUpload
        def values():return {'client_id':str(uuid.uuid4()),'body':'Pendiente',
            'file':SimpleUploadedFile('legacy.txt',b'Synthetic old client',content_type='text/plain')}
        missing=APIClient(enforce_csrf_checks=True);missing.cookies=self.clients[0].cookies.copy()
        missing.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignments[0].pk))
        self.assertEqual(missing.post(self.url+'messages/',values(),format='multipart').status_code,403)
        for client in self.clients:
            result=client.post(self.url+'messages/',values(),format='multipart')
            self.assertEqual(result.status_code,409,result.data)
        self.assertFalse(ChannelMessage.objects.exists());self.assertFalse(MediaUpload.objects.exists())
        self.assertEqual(self.drive.calls,[])

    def test_real_cookie_discard_requires_csrf_and_fences_a_subsequent_file_request(self):
        from rest_framework.test import APIClient
        nonce=str(uuid.uuid4())
        missing=APIClient(enforce_csrf_checks=True);missing.cookies=self.clients[0].cookies.copy()
        missing.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignments[0].pk))
        endpoint=self.url+'uploads/discard/'
        self.assertEqual(missing.post(endpoint,{'client_id':nonce},format='json').status_code,403)
        result=self.clients[0].post(endpoint,{'client_id':nonce},format='json')
        self.assertEqual(result.status_code,200,result.data);self.assertEqual(result.data['outcome'],'cancelled')
        late=self.clients[0].post(self.url+'uploads/',{'client_id':nonce,
            'file':SimpleUploadedFile('late.txt',b'Late bytes',content_type='text/plain')},format='multipart')
        self.assertEqual(late.status_code,200,late.data);self.assertEqual(late.data['state'],'cancelled')
        self.assertEqual(self.drive.calls,[])

    def ticket(self,index):
        result=self.clients[index].post('/api/v2/auth/websocket-ticket/',{'channel':'notifications',
            'assignment':str(self.assignments[index].pk)},format='json')
        self.assertEqual(result.status_code,200,result.data);return result.data['ticket']

    def test_private_upload_hint_reaches_only_the_owner_over_the_existing_socket(self):
        from asgiref.sync import async_to_sync
        from channels.db import database_sync_to_async
        from channels.testing import WebsocketCommunicator
        from config.asgi import application
        from boldApp.notificaciones.tests.socket_helpers import receive_event
        from .upload_outbox import perform
        sockets=[WebsocketCommunicator(application,f'/ws/notifications/?ticket={self.ticket(index)}',
            headers=[(b'origin',b'http://localhost:5174')]) for index in range(2)]
        async def no_upload(socket):
            for _ in range(10):
                if await socket.receive_nothing(timeout=.05):return
                envelope=await socket.receive_json_from(timeout=1)
                self.assertNotEqual(envelope.get('event_type'),'messaging.upload.changed')
            self.fail('Unexpected event storm')
        async def scenario():
            try:
                for socket in sockets:
                    self.assertTrue((await socket.connect())[0]);await receive_event(socket,'control.ready')
                result=await database_sync_to_async(self.queue)();self.assertEqual(result.status_code,202,result.data)
                envelope=await receive_event(sockets[0],'messaging.upload.changed')
                self.assertEqual(envelope['payload']['upload_id'],result.data['id'])
                self.assertEqual(set(envelope['payload']),{'upload_id','kind','container_id','client_id'})
                await no_upload(sockets[1])
                self.assertTrue(await database_sync_to_async(perform)(result.data['id']))
                await receive_event(sockets[0],'messaging.upload.changed');await no_upload(sockets[1])
            finally:
                for socket in sockets:await socket.disconnect()
        async_to_sync(scenario)()
