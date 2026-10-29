"""Reconcile only cancelled/expired reserved files, using recoverable Drive Trash.

Never scan arbitrary corporate folders or permanently delete a file. Ambiguous
metadata is held for review instead of guessed ownership.
"""
import uuid
from datetime import timedelta
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound
from boldApp.workspace.image_storage import storage_user
from boldApp.workspace.service import google, file_id
from .models import MediaUpload
from .upload_outbox import LEASE, StaleLease, rows
from .upload_provider import FIELDS


def reconcile(identity):
    now=timezone.now()
    with transaction.atomic():
        row=rows().select_for_update(of=('self',)).filter(pk=identity,state__in=['cancelled','expired'],
            cleaned_at__isnull=True,cleanup_attempts__lt=6,next_at__lte=now).first()
        if not row or row.lease_until and row.lease_until>now:
            return False
        if not row.drive_id:
            row.cleaned_at=now;row.save(update_fields=['cleaned_at']);return True
        row.lease_token=uuid.uuid4();row.lease_until=now+LEASE;row.cleanup_attempts+=1
        row.save(update_fields=['lease_token','lease_until','cleanup_attempts'])
    def call(method,path,**options):
        if connection.in_atomic_block:
            raise RuntimeError('Cleanup provider I/O inside transaction')
        if not MediaUpload.objects.filter(pk=row.pk,state__in=['cancelled','expired'],lease_token=row.lease_token).update(lease_until=timezone.now()+LEASE):
            raise StaleLease()
        return google(user,method,path,**options)
    code=''
    done=False
    try:
        user=storage_user(row.root)
        remote=call('GET','/files/'+file_id(row.drive_id),params={'fields':FIELDS,'supportsAllDrives':'true'})
        if (remote.get('id')!=row.drive_id or row.folder_id not in remote.get('parents',[]) or
            remote.get('appProperties',{}).get('bold_media_upload')!=str(row.pk) or
            remote.get('sha256Checksum')!=row.digest or str(remote.get('size'))!=str(row.size_bytes)):
            code='cleanup_needs_review'
        else:
            if not remote.get('trashed'):
                call('PATCH','/files/'+file_id(row.drive_id),body={'trashed':True},params={'supportsAllDrives':'true','fields':'id'})
            done=True
    except StaleLease:
        return False
    except NotFound:
        # A timed-out create may still finish remotely. Retain the reserved ID
        # and check later rather than declaring an absent object reconciled.
        code='cleanup_not_found'
    except Exception:
        code='cleanup_unavailable'
    with transaction.atomic():
        saved=MediaUpload.objects.select_for_update().get(pk=row.pk)
        if saved.state not in ('cancelled','expired') or saved.lease_token!=row.lease_token:
            return False
        saved.lease_token=None;saved.lease_until=None;saved.error_code=code
        saved.next_at=timezone.now()+timedelta(hours=1)
        if done:saved.cleaned_at=timezone.now()
        # Ownership ambiguity must not be retried into a destructive action.
        if code=='cleanup_needs_review':saved.cleanup_attempts=6
        saved.save(update_fields=['lease_token','lease_until','error_code','next_at','cleaned_at','cleanup_attempts','updated_at'])
    return done


def reconcile_pending(limit=4):
    now=timezone.now()
    ids=list(MediaUpload.objects.filter(state__in=['cancelled','expired'],cleaned_at__isnull=True,
        cleanup_attempts__lt=6,next_at__lte=now).filter(Q(lease_until__isnull=True)|Q(lease_until__lte=now))
        .order_by('next_at','pk').values_list('pk',flat=True)[:limit])
    return sum(bool(reconcile(identity)) for identity in ids)
