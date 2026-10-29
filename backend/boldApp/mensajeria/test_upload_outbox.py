"""Real DB transactions, synthetic Drive protocol. No Google credentials/network."""
import hashlib
import json
import secrets
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound

from boldApp.autenticacion.models import AuthSession
from boldApp.workspace.models import ImageStorageRoot
from . import tests as fixtures
from .models import MediaUpload, DirectMessage, MessageMedia, ChannelMessage, ChannelMedia
from .upload_outbox import perform, cipher, claim, expire_pending
from .upload_cleanup import reconcile
from boldApp.workspace.service import GoogleUnavailable


class SyntheticDrive:
    def __init__(self):
        self.files={};self.calls=[];self.serial=0;self.lose_upload=False;self.unavailable=False;self.after_upload=None

    def __call__(self,user,method,path,**options):
        self.calls.append((method,path,connection.in_atomic_block))
        if connection.in_atomic_block:
            raise AssertionError('Network under transaction')
        if self.unavailable:
            raise GoogleUnavailable()
        if method=='GET' and path=='/files/generateIds':
            self.serial+=1;return {'ids':[f'synthetic_reserved_{self.serial}']}
        if method=='GET' and path.startswith('/files/'):
            row=self.files.get(path.split('/')[-1])
            if not row:raise NotFound()
            return SimpleNamespace(content=row['content']) if options.get('raw') else row['metadata'].copy()
        if method=='POST' and path=='/files':
            multipart=options.get('files');data=json.loads(multipart['metadata'][1]) if multipart else options['body'].copy()
            if data['id'] in self.files:
                from rest_framework.exceptions import ValidationError
                raise ValidationError('Synthetic 409')
            content=multipart['file'][1] if multipart else b''
            data.update(size=str(len(content)),sha256Checksum=hashlib.sha256(content).hexdigest(),trashed=False)
            self.files[data['id']]={'metadata':data,'content':content}
            if multipart and self.after_upload:self.after_upload()
            if multipart and self.lose_upload:
                self.lose_upload=False;raise GoogleUnavailable()
            return data.copy()
        if method=='PATCH' and path.startswith('/files/'):
            self.files[path.split('/')[-1]]['metadata'].update(options['body']);return {}
        raise AssertionError((method,path))


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-outbox-tests-only')
class UploadOutboxTests(TransactionTestCase):
    root=fixtures.DirectChatTests.root
    identity=fixtures.DirectChatTests.identity
    as_person=fixtures.DirectChatTests.as_person
    open=fixtures.DirectChatTests.open

    def setUp(self):
        from boldApp.core.models import Permission
        for resource,action in (('channel','read'),('channel','create'),('channel','manage'),('channel','access'),('message','create'),('message','update')):
            Permission.objects.get_or_create(code=f'slack.{resource}.{action}',defaults={
                'module_code':'slack','resource':resource,'action':action,'risk_level':'low'})
        fixtures.DirectChatTests.setUp(self)
        self.session=AuthSession.objects.create(user_account=self.alice.employee.user_account,
            token_hash=secrets.token_hex(32),credentials_version=self.alice.employee.user_account.credentials_version,
            expires_at=timezone.now()+timedelta(hours=2))
        self.client.force_authenticate(self.alice.employee.user_account,token=self.session)
        self.conversation=self.open();self.url=f'{self.root}{self.conversation}/uploads/'
        self.storage=ImageStorageRoot.objects.create(user=self.alice.employee.user_account,subject='synthetic',
            client_id='synthetic',google_email='fixture@example.invalid',folder_id='synthetic_root',folder_name='BOLD APP',active=True)
        self.drive=SyntheticDrive()
        for target in ('boldApp.mensajeria.upload_provider.google','boldApp.mensajeria.upload_cleanup.google','boldApp.workspace.service.google'):
            current=patch(target,side_effect=self.drive);current.start();self.addCleanup(current.stop)
        for target in ('boldApp.mensajeria.upload_provider.storage_user','boldApp.mensajeria.upload_cleanup.storage_user','boldApp.workspace.image_storage.storage_user'):
            current=patch(target,return_value=self.alice.employee.user_account);current.start();self.addCleanup(current.stop)

    def queue(self,client_id=None,content=b'Documento privado de prueba',url=None):
        return self.client.post(url or self.url,{'client_id':str(client_id or uuid.uuid4()),
            'file':SimpleUploadedFile('revision.txt',content,content_type='text/plain')},format='multipart')

    def make_ready(self,url=None):
        result=self.queue(url=url);self.assertEqual(result.status_code,202,result.data)
        self.assertTrue(perform(result.data['id']))
        row=MediaUpload.objects.get(pk=result.data['id']);self.assertEqual(row.state,'ready')
        return row

    def send(self,row,**extra):
        base=f'/api/v2/messaging/channels/{row.channel_id}/' if row.channel_id else f'{self.root}{row.conversation_id}/'
        return self.client.post(base+'messages/',{'client_id':str(row.client_id),'upload_id':str(row.pk),'body':'Archivo listo',**extra},format='json')

    def test_queue_is_private_encrypted_idempotent_bounded_and_not_eager(self):
        token=uuid.uuid4();result=self.queue(token)
        self.assertEqual(result.status_code,202,result.data);row=MediaUpload.objects.get(pk=result.data['id'])
        self.assertNotIn(b'Documento privado',bytes(row.content));self.assertEqual(cipher().decrypt(bytes(row.content)),b'Documento privado de prueba')
        self.assertEqual(self.drive.calls,[]);self.assertEqual(DirectMessage.objects.count(),0)
        self.assertEqual(self.queue(token).status_code,200);self.assertEqual(MediaUpload.objects.count(),1)
        self.assertEqual(self.queue(token,b'Otro archivo').status_code,409)
        self.assertNotIn('drive_id',result.data);self.assertNotIn('content',result.data)
        with override_settings(MESSAGING_UPLOAD_ACCOUNT_BYTES=row.cipher_bytes):
            self.assertEqual(self.queue().status_code,429)
        peer=self.as_person(self.bob)
        self.assertEqual(peer.get(self.url+str(row.pk)+'/').status_code,404)
        self.assertEqual(peer.get(self.url).data['results'],[])
        outsider=self.as_person(self.owner)
        self.assertEqual(outsider.get(self.url+str(row.pk)+'/').status_code,404)
        self.assertEqual(self.send(row).status_code,409);self.assertEqual(DirectMessage.objects.count(),0)

    def test_drive_ready_then_publish_is_atomic_and_no_network_in_message_transaction(self):
        row=self.make_ready()
        self.assertEqual(bytes(row.content),b'');self.assertEqual(row.cipher_bytes,0);self.assertEqual(DirectMessage.objects.count(),0)
        calls=len(self.drive.calls)
        sent=self.send(row);self.assertEqual(sent.status_code,201,sent.data)
        self.assertEqual(self.send(row).status_code,200);self.assertEqual(len(self.drive.calls),calls)
        row.refresh_from_db();self.assertEqual(row.state,'attached');self.assertEqual(DirectMessage.objects.count(),1)
        self.assertEqual(MessageMedia.objects.get().drive_id,row.drive_id)
        peer=self.as_person(self.bob)
        download=peer.get(f'{self.root}{self.conversation}/messages/{row.message_id}/media/')
        self.assertEqual(download.status_code,200);self.assertEqual(download.content,b'Documento privado de prueba')
        self.assertTrue(all(not atomic for _,_,atomic in self.drive.calls))
        self.assertEqual(self.client.post(self.url+str(row.pk)+'/',{'action':'cancel'},format='json').status_code,409)
        wrong=self.client.post(f'{self.root}{self.conversation}/messages/',{'client_id':str(uuid.uuid4()),'upload_id':str(row.pk),'body':''},format='json')
        self.assertEqual(wrong.status_code,404)

    def test_lost_success_response_and_duplicate_workers_keep_one_reserved_file(self):
        result=self.queue();self.drive.lose_upload=True
        self.assertTrue(perform(result.data['id']))
        self.assertFalse(perform(result.data['id']))
        files=[row for row in self.drive.files.values() if row['metadata']['mimeType']=='text/plain']
        self.assertEqual(len(files),1)
        self.assertTrue(all('permissions' not in row['metadata'] for row in self.drive.files.values()))
        self.assertTrue(all('parents' in row['metadata'] for row in self.drive.files.values()))

    def test_bounded_retries_recovery_after_expired_lease_and_session_revocation(self):
        result=self.queue();identity=result.data['id'];self.drive.unavailable=True
        for attempt in range(3):
            MediaUpload.objects.filter(pk=identity).update(next_at=timezone.now()-timedelta(seconds=1))
            self.assertFalse(perform(identity))
        row=MediaUpload.objects.get(pk=identity);self.assertEqual((row.state,row.attempts),('failed',3))
        self.drive.unavailable=False
        retried=self.client.post(self.url+str(identity)+'/',{'action':'retry'},format='json')
        self.assertEqual(retried.status_code,200,retried.data)
        lease=claim(identity);self.assertIsNotNone(lease);self.assertIsNone(claim(identity))
        MediaUpload.objects.filter(pk=identity).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertTrue(perform(identity));row.refresh_from_db();self.assertEqual(row.state,'ready')
        result=self.queue();self.session.revoked_at=timezone.now();self.session.save(update_fields=['revoked_at'])
        calls=len(self.drive.calls);self.assertFalse(perform(result.data['id']));self.assertEqual(len(self.drive.calls),calls)
        self.assertEqual(MediaUpload.objects.get(pk=result.data['id']).error_code,'access_changed')

    def test_cancel_during_provider_request_cannot_resurrect_or_publish(self):
        result=self.queue();identity=result.data['id']
        def cancel():
            response=self.client.post(self.url+str(identity)+'/',{'action':'cancel'},format='json')
            self.assertEqual(response.status_code,200,response.data)
        self.drive.after_upload=cancel
        self.assertFalse(perform(identity));row=MediaUpload.objects.get(pk=identity)
        self.assertEqual(row.state,'cancelled');self.assertEqual(bytes(row.content),b'');self.assertTrue(row.drive_id)
        self.assertEqual(DirectMessage.objects.count(),0);self.assertEqual(self.send(row).status_code,409)

    def test_expiry_releases_ciphertext_and_integrity_error_is_not_retried_forever(self):
        result=self.queue();identity=result.data['id'];MediaUpload.objects.filter(pk=identity).update(content=b'corrupt')
        self.assertFalse(perform(identity));self.assertEqual(MediaUpload.objects.get(pk=identity).error_code,'integrity')
        MediaUpload.objects.filter(pk=identity).update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(expire_pending(),1);row=MediaUpload.objects.get(pk=identity)
        self.assertEqual((row.state,row.cipher_bytes),('expired',0));self.assertEqual(bytes(row.content),b'')

    def test_channel_and_thread_uploads_publish_only_with_current_permissions(self):
        base='/api/v2/messaging/channels/'
        channel=self.client.post(base,{'unit_id':str(self.unit.pk),'name':'Subidas'},format='json')
        self.assertEqual(channel.status_code,201,channel.data);channel_id=channel.data['id']
        row=self.make_ready(url=f'{base}{channel_id}/uploads/')
        parent=self.send(row);self.assertEqual(parent.status_code,201,parent.data)
        thread=self.make_ready(url=f'{base}{channel_id}/uploads/')
        response=self.send(thread,parent_id=parent.data['message']['id'])
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(ChannelMedia.objects.count(),2)
        self.assertEqual(ChannelMessage.objects.count(),2)
        staged=self.make_ready(url=f'{base}{channel_id}/uploads/')
        from .models import DepartmentChannel
        DepartmentChannel.objects.filter(pk=channel_id).update(archived_at=timezone.now())
        self.assertEqual(self.send(staged).status_code,409);self.assertEqual(ChannelMessage.objects.count(),2)
        cancelled=self.client.post(f'{base}{channel_id}/uploads/{staged.pk}/',{'action':'cancel'},format='json')
        self.assertEqual(cancelled.status_code,200,cancelled.data)

    def test_reconcile_only_owned_cancelled_files_and_never_attached_or_ambiguous(self):
        row=self.make_ready();self.assertFalse(reconcile(row.pk))
        result=self.client.post(self.url+str(row.pk)+'/',{'action':'cancel'},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertTrue(reconcile(row.pk));self.assertTrue(self.drive.files[row.drive_id]['metadata']['trashed'])
        self.assertFalse(reconcile(row.pk))
        attached=self.make_ready();self.assertEqual(self.send(attached).status_code,201)
        self.assertFalse(reconcile(attached.pk));self.assertFalse(self.drive.files[attached.drive_id]['metadata']['trashed'])
        changed=self.make_ready();self.client.post(self.url+str(changed.pk)+'/',{'action':'cancel'},format='json')
        self.drive.files[changed.drive_id]['metadata']['sha256Checksum']='changed'
        self.assertFalse(reconcile(changed.pk));changed.refresh_from_db()
        self.assertEqual(changed.error_code,'cleanup_needs_review');self.assertEqual(changed.cleanup_attempts,6)
        self.assertFalse(self.drive.files[changed.drive_id]['metadata']['trashed'])

    def test_cancelled_inflight_lease_and_unknown_remote_are_retained_for_reconciliation(self):
        result=self.queue();lease=claim(result.data['id'])
        MediaUpload.objects.filter(pk=lease.pk).update(drive_id='pending_reserved',folder_id='synthetic_parent')
        self.client.post(self.url+str(lease.pk)+'/',{'action':'cancel'},format='json')
        self.assertFalse(reconcile(lease.pk));row=MediaUpload.objects.get(pk=lease.pk);self.assertEqual(row.cleanup_attempts,0)
        MediaUpload.objects.filter(pk=lease.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertFalse(reconcile(lease.pk));row.refresh_from_db()
        self.assertIsNone(row.cleaned_at);self.assertEqual(row.error_code,'cleanup_not_found')

    def test_old_worker_is_fenced_and_access_is_rechecked_after_remote_success(self):
        result=self.queue();old=claim(result.data['id'])
        MediaUpload.objects.filter(pk=old.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
        new=claim(old.pk);self.assertNotEqual(old.lease_token,new.lease_token)
        from .upload_provider import upload
        from .upload_outbox import StaleLease
        with self.assertRaises(StaleLease):upload(old,b'Documento privado de prueba')
        self.assertEqual(self.drive.calls,[])
        MediaUpload.objects.filter(pk=old.pk).update(lease_until=timezone.now()-timedelta(seconds=1))
        def revoke():
            AuthSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now())
        self.drive.after_upload=revoke
        self.assertFalse(perform(old.pk));row=MediaUpload.objects.get(pk=old.pk)
        self.assertEqual(row.error_code,'access_changed');self.assertNotEqual(row.state,'ready')
        self.assertTrue(row.drive_id);self.assertEqual(DirectMessage.objects.count(),0)

    def test_broker_loss_does_not_lose_the_durable_upload(self):
        with override_settings(CELERY_TASK_ALWAYS_EAGER=False),patch(
            'boldApp.mensajeria.upload_tasks.drain_media_uploads.apply_async',side_effect=OSError('synthetic broker unavailable')):
            result=self.queue()
        self.assertEqual(result.status_code,202,result.data);self.assertEqual(MediaUpload.objects.count(),1)
        self.assertEqual(self.drive.calls,[])
        from io import StringIO
        from django.core.management import call_command
        report=StringIO();call_command('drain_media_uploads',stdout=report)
        self.assertEqual(MediaUpload.objects.get(pk=result.data['id']).state,'ready')
        self.assertIn("'ready': 1",report.getvalue())

    def test_action_endpoint_rejects_oversized_files_without_changing_the_upload(self):
        from .media import MAX_BYTES
        response=self.queue();identity=response.data['id']
        result=self.client.post(self.url+str(identity)+'/',{'action':'cancel',
            'file':SimpleUploadedFile('wrong.txt',b'x'*(MAX_BYTES+1),content_type='text/plain')},format='multipart')
        self.assertEqual(result.status_code,400,result.data)
        self.assertEqual(MediaUpload.objects.get(pk=identity).state,'queued')

    def test_retired_root_does_not_redirect_upload_and_post_publish_retry_remains_idempotent(self):
        row=self.make_ready();response=self.send(row);self.assertEqual(response.status_code,201,response.data)
        ImageStorageRoot.objects.filter(pk=self.storage.pk).update(active=False)
        self.assertEqual(self.send(row).status_code,200)
        ImageStorageRoot.objects.filter(pk=self.storage.pk).update(active=True)
        staged=self.queue();ImageStorageRoot.objects.filter(pk=self.storage.pk).update(active=False)
        calls=len(self.drive.calls);self.assertFalse(perform(staged.data['id']))
        self.assertEqual(len(self.drive.calls),calls);self.assertEqual(MediaUpload.objects.get(pk=staged.data['id']).error_code,'access_changed')


@override_settings(MESSAGING_PILOT_ENABLED=False,AUTH_MFA_REQUIRED=False,CELERY_TASK_ALWAYS_EAGER=True,
    AUTH_ENCRYPTION_KEY='synthetic-upload-cookie-tests-only')
class UploadCookieTests(TransactionTestCase):
    def setUp(self):
        from . import test_channel_sessions as cookie_fixtures
        cookie_fixtures.ChannelCookieSessionTests.setUp(self)
        self.storage=ImageStorageRoot.objects.create(user=self.assignments[0].employee.user_account,
            subject='synthetic',client_id='synthetic',google_email='fixture@example.invalid',
            folder_id='synthetic_root',folder_name='BOLD APP',active=True)
        self.drive=SyntheticDrive()
        for target in ('boldApp.mensajeria.upload_provider.google','boldApp.workspace.service.google'):
            current=patch(target,side_effect=self.drive);current.start();self.addCleanup(current.stop)
        for target in ('boldApp.mensajeria.upload_provider.storage_user','boldApp.workspace.image_storage.storage_user'):
            current=patch(target,return_value=self.assignments[0].employee.user_account);current.start();self.addCleanup(current.stop)

    def queue(self,client=None):
        return (client or self.clients[0]).post(self.url+'uploads/',{'client_id':str(uuid.uuid4()),
            'file':SimpleUploadedFile('cookie.txt',b'Validacion con cookies y CSRF',content_type='text/plain')},format='multipart')

    def test_two_real_cookie_sessions_csrf_private_staging_and_recipient_download(self):
        from rest_framework.test import APIClient
        missing=APIClient(enforce_csrf_checks=True);missing.cookies=self.clients[0].cookies.copy()
        missing.credentials(HTTP_X_ASSIGNMENT_ID=str(self.assignments[0].pk))
        self.assertEqual(self.queue(missing).status_code,403);self.assertEqual(MediaUpload.objects.count(),0)
        response=self.queue();self.assertEqual(response.status_code,202,response.data)
        row=MediaUpload.objects.get(pk=response.data['id'])
        self.assertIsNotNone(row.session_id);self.assertEqual(row.account_id,self.assignments[0].employee.user_account.pk)
        self.assertEqual(self.clients[1].get(self.url+'uploads/'+str(row.pk)+'/').status_code,404)
        self.assertEqual(self.clients[1].get(self.url+'messages/').data['results'],[])
        self.assertEqual(self.clients[1].get(self.url+'library/').data['results'],[])
        self.assertEqual(self.drive.calls,[]);self.assertTrue(perform(row.pk))
        sent=self.clients[0].post(self.url+'messages/',{'client_id':str(row.client_id),'upload_id':str(row.pk),'body':'Archivo confirmado'},format='json')
        self.assertEqual(sent.status_code,201,sent.data)
        download=self.clients[1].get(self.url+'messages/'+sent.data['message']['id']+'/media/')
        self.assertEqual(download.status_code,200);self.assertEqual(download.content,b'Validacion con cookies y CSRF')
        self.assertNotIn('drive_id',sent.data['message']['media'])

    def test_logout_stops_pending_network_and_pilot_boundary_remains_fail_closed(self):
        response=self.queue();self.assertEqual(response.status_code,202,response.data)
        self.assertEqual(self.clients[0].post('/api/v2/auth/logout/',{},format='json').status_code,204)
        self.assertFalse(perform(response.data['id']));self.assertEqual(self.drive.calls,[])
        self.assertEqual(MediaUpload.objects.get(pk=response.data['id']).error_code,'access_changed')
        with override_settings(MESSAGING_PILOT_ENABLED=True,MESSAGING_PILOT_UNIT_IDS=(str(self.assignments[0].position.unit_id),)):
            self.assertEqual(self.clients[1].get(self.url+'uploads/').status_code,403)
