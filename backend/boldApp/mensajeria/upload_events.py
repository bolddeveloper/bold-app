"""Content-free owner-only hints over the existing session socket, never notices."""
import logging
import uuid
from types import SimpleNamespace
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import F,Q
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException
from boldApp.autenticacion.models import AuthSession
from boldApp.core.events import build_event_envelope
from .models import MediaUpload

log=logging.getLogger(__name__)


def publish_upload_change(row):
    identity,employee=str(row.pk),str(row.assignment.employee_id)
    def dispatch():
        try:
            layer=get_channel_layer()
            if layer is not None:
                async_to_sync(layer.group_send)(f'messaging_employee_{employee}',
                    {'type':'messaging.upload.changed','upload_id':identity})
        except Exception:
            log.warning('Media upload hint unavailable; status remains persisted')
    transaction.on_commit(dispatch,robust=True)


def upload_event(assignment_id,session_id,event):
    from .upload_views import MediaUploadView
    from .access import assignment_can_chat
    now=timezone.now()
    try:identity=uuid.UUID(str(event.get('upload_id','')))
    except (ValueError,TypeError,AttributeError):return None
    session=AuthSession.objects.select_related('user_account').filter(pk=session_id,revoked_at__isnull=True,
        user_account__is_active=True,expires_at__gt=now,credentials_version=F('user_account__credentials_version')).filter(
            Q(idle_expires_at__isnull=True)|Q(idle_expires_at__gt=now)).first()
    if not session:return None
    row=MediaUpload.objects.select_related('assignment__employee','assignment__position__unit').filter(
        pk=identity,assignment_id=assignment_id,account_id=session.user_account_id).first()
    if not row or not assignment_can_chat(row.assignment):return None
    kind='chat' if row.conversation_id else 'channel'
    container_id=row.conversation_id or row.channel_id
    view=MediaUploadView();view.request=SimpleNamespace(user=session.user_account,auth=session,assignment=row.assignment)
    try:view.scope(kind,container_id)
    except (APIException,Http404):return None
    return build_event_envelope('messaging.upload.changed','media_upload',row.pk,
        {'upload_id':str(row.pk),'kind':kind,'container_id':str(container_id),'client_id':str(row.client_id)})
