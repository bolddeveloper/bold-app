"""Projection tests: real staging HTTP validation, simulated *ready* worker result.

This helper does not certify Google/worker transactions. Those are tested with
TransactionTestCase in test_upload_outbox and test_upload_concurrency.
"""
import secrets
import uuid
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from boldApp.autenticacion.models import AuthSession
from boldApp.workspace.models import ImageStorageRoot
from .models import MediaUpload
from .upload_outbox import attach as attach_prepared, cipher


@override_settings(AUTH_MFA_REQUIRED=False, AUTH_ENCRYPTION_KEY='synthetic-media-projection-fixtures', CELERY_TASK_ALWAYS_EAGER=True)
def staged_message(test, client, base, client_id, file, body='', **extra):
    user=getattr(client.handler,'_force_user',None)
    if user and not isinstance(getattr(client.handler,'_force_token',None),AuthSession):
        session=AuthSession.objects.create(user_account=user,token_hash=secrets.token_hex(32),
            credentials_version=user.credentials_version,expires_at=timezone.now()+timedelta(hours=2))
        client.force_authenticate(user,token=session)
    if getattr(test,'auto_storage',True) and not ImageStorageRoot.objects.filter(active=True).exists():
        test.drive()
    result=client.post(base+'uploads/',{'client_id':str(client_id),'file':file},format='multipart')
    if result.status_code not in (200,202):return result
    row=MediaUpload.objects.get(pk=result.data['id'])
    if row.state=='queued':
        # Only the final provider result is simulated, never validation/auth/ACL.
        test.uploaded=cipher().decrypt(bytes(row.content))
        row.state='ready';row.drive_id='synthetic_ready_'+str(row.pk);row.folder_id='synthetic_private_folder'
        row.content=b'';row.cipher_bytes=0;row.attempts=1
        row.save(update_fields=['state','drive_id','folder_id','content','cipher_bytes','attempts'])
    return client.post(base+'messages/',{'client_id':str(client_id),'upload_id':str(row.pk),'body':body,**extra},format='json')


def fake_attach(test,row,message):
    return attach_prepared(row,message)
