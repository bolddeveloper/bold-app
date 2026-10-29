"""Durable media staging. Provider calls are forbidden inside DB transactions.

Two steps: store normalized bytes privately, then publish with upload_id only
after Drive confirms. No pending message/notification is exposed to a peer.
"""
import base64
import hashlib
import logging
import uuid
from datetime import timedelta
from types import SimpleNamespace

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from boldApp.autenticacion.models import AuthSession
from boldApp.workspace.models import ImageStorageRoot
from .access import assignment_can_chat
from .models import MediaUpload, MediaUploadQuota, MessageMedia, ChannelMedia
from .views import Conflict

TTL = timedelta(hours=24)
LEASE = timedelta(minutes=3)
ACTIVE = ('queued','uploading','retry')
META = ('kind','mime_type','size_bytes','digest','filename','width','height')
log = logging.getLogger(__name__)


class QueueFull(APIException):
    status_code = 429
    default_detail = 'La cola temporal de archivos está llena. Espera a que termine un envío antes de añadir otro.'
    wait = 60


class StaleLease(Exception):
    pass


def cipher():
    secret = settings.AUTH_ENCRYPTION_KEY.strip()
    if not secret:
        if not settings.DEBUG:
            raise RuntimeError('AUTH_ENCRYPTION_KEY es obligatoria para la cola de archivos.')
        secret = settings.SECRET_KEY
    key = hashlib.sha256(('bold:media-outbox:v1:' + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def rows():
    return MediaUpload.objects.defer('content').select_related('account','session','assignment__employee',
        'assignment__position__unit','root__user','channel__unit','conversation')


def live(row):
    now = timezone.now()
    session, account, assignment = row.session, row.account, row.assignment
    if (row.expires_at <= now or not session or session.user_account_id != account.pk or session.revoked_at or
        session.expires_at <= now or session.idle_expires_at and session.idle_expires_at <= now or
        session.credentials_version != account.credentials_version or not account.is_active or account.must_change_password or
        settings.AUTH_MFA_REQUIRED and not account.mfa_methods.filter(is_active=True).exists() or
        account.employee_id != assignment.employee_id or not assignment_can_chat(assignment)):
        raise PermissionDenied('La sesión o asignación ya no permite esta subida.')
    if not row.root or not row.root.active:
        raise PermissionDenied('El destino de Drive cambió; no se redirige el archivo automáticamente.')
    if row.channel_id:
        from .channel_access import ChannelPolicy
        policy = ChannelPolicy(assignment, SimpleNamespace(auth=session, user=account))
        if row.channel.archived_at or not all(policy.allows(code,row.channel.unit,row.channel_id)
            for code in ('slack.channel.read','slack.message.create')):
            raise PermissionDenied('El canal ya no permite la subida.')
    else:
        from .presenters import people, available
        ids = (row.conversation.first_employee_id,row.conversation.second_employee_id)
        peers = list(people().filter(pk__in=ids))
        if account.employee_id not in ids or len(peers)!=2 or not all(available(peer) for peer in peers):
            raise PermissionDenied('La conversación ya no permite la subida.')


def identity(kind, container_id, account_id, client_id):
    return uuid.uuid5(uuid.NAMESPACE_URL,f'bold-upload:v1:{kind}:{container_id}:{account_id}:{client_id}')


def enqueue(request, kind, container, client_id, prepared):
    if not isinstance(request.auth,AuthSession):
        raise PermissionDenied('Se requiere una sesión autenticada para conservar una subida.')
    token = identity(kind,container.pk,request.user.pk,client_id)
    # Normalize/validate/encrypt before taking the reservation mutex.
    encoded = cipher().encrypt(prepared['content'])
    with transaction.atomic():
        # Publication and discard lock the container before the upload. Taking
        # this first also prevents quota/FK key-share deadlocks with discard.
        container=type(container).objects.select_for_update().get(pk=container.pk)
        MediaUploadQuota.objects.get_or_create(pk=1)
        MediaUploadQuota.objects.select_for_update().get(pk=1)
        old = rows().filter(pk=token).first()
        if old:
            if old.assignment_id != request.assignment.pk:
                raise NotFound('Subida no disponible para esta asignación.')
            if old.state=='cancelled':
                return old,False
            if any(getattr(old,key)!=prepared[key] for key in META):
                raise Conflict('Este intento ya contiene otro archivo. No se ha duplicado.')
            return old, False
        messages=container.messages.filter(author_id=request.assignment.employee_id,client_id=client_id)
        if messages.exists():
            raise Conflict('Este intento ya se publicó. Consulta el mensaje antes de crear otra subida.')
        from .upload_capacity import check_capacity, check_temporary_capacity
        check_capacity(request.user, prepared['size_bytes'])
        check_temporary_capacity(request.user, len(encoded), check_records=False)
        # Short global mutex makes byte/count reservations atomic across roots/users.
        own = MediaUpload.objects.filter(account=request.user)
        if (own.filter(state__in=(*ACTIVE,'ready','failed')).count() >= 20 or
            MediaUpload.objects.filter(state__in=(*ACTIVE,'ready','failed')).count() >= 200):
            raise QueueFull()
        root = ImageStorageRoot.objects.filter(active=True).order_by('pk').first()
        if not root:
            raise ValidationError('Configura el destino corporativo de Drive antes de preparar una subida.')
        now = timezone.now()
        row = MediaUpload.objects.create(id=token,account=request.user,assignment=request.assignment,session=request.auth,
            conversation=container if kind=='chat' else None, channel=container if kind=='channel' else None,
            root=root,client_id=client_id,content=encoded,cipher_bytes=len(encoded),next_at=now,expires_at=now+TTL,
            **{key:prepared[key] for key in META})
        live(row)
        from .upload_events import publish_upload_change
        publish_upload_change(row)
        # Eager mode must NOT turn the request back into a synchronous Drive upload.
        transaction.on_commit(wake,robust=True)
        return row, True


def wake():
    if not settings.CELERY_TASK_ALWAYS_EAGER:
        from .upload_tasks import drain_media_uploads
        try:
            drain_media_uploads.apply_async(retry=False,ignore_result=True)
        except Exception as exc:
            # The durable row is the outbox; periodic recovery can redispatch.
            log.warning('Media queue wake unavailable (%s)',type(exc).__name__)


def manifest(row):
    now = timezone.now()
    return {'id':str(row.pk),'client_id':str(row.client_id),'state':row.state,'kind':row.kind,
        'filename':row.filename,'size_bytes':row.size_bytes,'expires_at':row.expires_at,'attempts':row.attempts,
        'error_code':row.error_code,'message_id':str(row.message_id) if row.message_id else None,
        'next_attempt_at':row.next_at if row.state=='retry' else None,
        'can_retry':row.state=='failed' and row.attempts<6 and row.expires_at>now,
        'can_cancel':row.state not in ('attached','cancelled','expired')}


def claim(upload_id):
    now = timezone.now()
    with transaction.atomic():
        row = rows().select_for_update(of=('self',)).filter(pk=upload_id).first()
        if not row or row.state not in ACTIVE or row.next_at>now or row.expires_at<=now:
            return None
        if row.state=='uploading' and row.lease_until and row.lease_until>now:
            return None
        if row.attempts>=6 or row.cycle_attempts>=3:
            row.state='failed'; row.error_code='retry_limit'; row.save(update_fields=['state','error_code']);return None
        row.state='uploading'; row.lease_token=uuid.uuid4(); row.lease_until=now+LEASE
        row.attempts+=1; row.cycle_attempts+=1
        row.save(update_fields=['state','lease_token','lease_until','attempts','cycle_attempts','updated_at'])
        from .upload_events import publish_upload_change
        publish_upload_change(row)
        return row


def renew(row):
    if connection.in_atomic_block:
        raise RuntimeError('Provider I/O attempted inside a database transaction.')
    if not MediaUpload.objects.filter(pk=row.pk,state='uploading',lease_token=row.lease_token,
        expires_at__gt=timezone.now()).update(lease_until=timezone.now()+LEASE):
        raise StaleLease()


def perform(upload_id):
    row = claim(upload_id)
    if not row:
        return False
    try:
        live(row)
        encoded = MediaUpload.objects.only('content').get(pk=row.pk).content
        content = cipher().decrypt(bytes(encoded))
        if len(content)!=row.size_bytes or hashlib.sha256(content).hexdigest()!=row.digest:
            raise ValueError('Staged content integrity failure')
        from .upload_provider import upload
        upload(row,content)
        # Recheck account/session/ACL/root after the external request as well.
        latest = rows().get(pk=row.pk); live(latest)
        with transaction.atomic():
            saved = MediaUpload.objects.select_for_update().get(pk=row.pk)
            if saved.state!='uploading' or saved.lease_token!=row.lease_token:
                return False
            saved.state='ready'; saved.error_code=''; saved.content=b''; saved.cipher_bytes=0
            saved.lease_token=None; saved.lease_until=None
            saved.save(update_fields=['state','error_code','content','cipher_bytes','lease_token','lease_until','updated_at'])
            from .upload_events import publish_upload_change
            publish_upload_change(rows().get(pk=saved.pk))
        return True
    except StaleLease:
        return False
    except Exception as exc:
        # Never retain provider text, URLs, tokens or file contents in errors/logs.
        from cryptography.fernet import InvalidToken
        from boldApp.workspace.service import GoogleUnavailable, Reconnect
        transient = isinstance(exc,GoogleUnavailable)
        code = ('access_changed' if isinstance(exc,(PermissionDenied,NotFound)) else 'drive_reconnect' if isinstance(exc,Reconnect)
            else 'drive_unavailable' if transient else 'integrity' if isinstance(exc,(ValueError,InvalidToken)) else 'upload_failed')
        log.warning('Media upload stopped: %s (%s)',row.pk,code)
        with transaction.atomic():
            saved = MediaUpload.objects.select_for_update().get(pk=row.pk)
            if saved.state!='uploading' or saved.lease_token!=row.lease_token:
                return False
            saved.state='retry' if transient and saved.cycle_attempts<3 and saved.attempts<6 else 'failed'
            saved.error_code=code; saved.next_at=timezone.now()+timedelta(seconds=30*2**(saved.cycle_attempts-1))
            saved.lease_token=None; saved.lease_until=None
            saved.save(update_fields=['state','error_code','next_at','lease_token','lease_until','updated_at'])
            from .upload_events import publish_upload_change
            publish_upload_change(rows().get(pk=saved.pk))
        return False


def prepared_upload(request,kind,container,client_id,upload_id):
    """Called inside the existing message transaction, after its ACL check."""
    row = rows().select_for_update(of=('self',)).filter(pk=upload_id,account=request.user,
        assignment=request.assignment,client_id=client_id,**{('conversation_id' if kind=='chat' else 'channel_id'):container.pk}).first()
    if not row:
        raise NotFound('Este archivo no pertenece al envío ni a su ámbito actual.')
    if row.state not in ('ready','attached') or row.state=='ready' and (row.expires_at<=timezone.now() or not row.root.active):
        raise Conflict('El archivo aún no está disponible para publicar. Revisa su subida.')
    return row,{key:getattr(row,key) for key in META}


def attach(row,message):
    if row.state=='attached':
        if row.message_id!=message.pk:
            raise Conflict('El archivo ya pertenece a otro mensaje.')
        return
    model = MessageMedia if row.conversation_id else ChannelMedia
    model.objects.create(id=row.pk,message=message,root_id=row.root_id,drive_id=row.drive_id,
        **{key:getattr(row,key) for key in META})
    row.state='attached'; row.message_id=message.pk
    row.save(update_fields=['state','message_id','updated_at'])
    from .upload_events import publish_upload_change
    publish_upload_change(row)


def expire_pending(limit=20):
    # Keep tombstones/reserved IDs for reconciliation; only staged ciphertext is cleared.
    now = timezone.now()
    ids = list(MediaUpload.objects.filter(state__in=(*ACTIVE,'ready','failed'),expires_at__lte=now)
        .order_by('expires_at').values_list('pk',flat=True)[:limit])
    for identity in ids:
        with transaction.atomic():
            row=MediaUpload.objects.select_for_update().get(pk=identity)
            if row.state in (*ACTIVE,'ready','failed') and row.expires_at<=now:
                row.state='expired'; row.content=b''; row.cipher_bytes=0
                row.save(update_fields=['state','content','cipher_bytes','updated_at'])
                from .upload_events import publish_upload_change
                publish_upload_change(rows().get(pk=row.pk))
    return len(ids)
