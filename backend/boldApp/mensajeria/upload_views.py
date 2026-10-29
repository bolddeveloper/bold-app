"""Owner-only staged uploads, scoped by the same Chat/Slack boundaries."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from boldApp.autenticacion.models import AuthSession
from .channel_views import SlackView
from .media import BoundedUpload, MAX_BYTES, prepare
from .serializers import StrictInputSerializer
from .views import Conflict
from .upload_outbox import rows, enqueue, manifest, wake,identity,TTL,QueueFull


class UploadInput(StrictInputSerializer):
    client_id=serializers.UUIDField()
    file=serializers.FileField(max_length=200)


class UploadAction(StrictInputSerializer):
    action=serializers.ChoiceField(choices=['retry','cancel'])


class DiscardInput(StrictInputSerializer):
    client_id=serializers.UUIDField()


class MediaUploadView(SlackView):
    def initialize_request(self,request,*args,**kwargs):
        if request.method=='POST':
            # Session/CSRF authentication may parse multipart before post().
            # Bound forged files on action endpoints too, not only creation.
            request.upload_handlers.insert(0,BoundedUpload(request))
        return super().initialize_request(request,*args,**kwargs)

    def scope(self,kind,container_id,*,write=False):
        container=self.conversation(container_id) if kind=='chat' else self.channel(container_id)
        if write and kind=='channel':
            self.writable(container)
        return container

    def owned(self,request,kind,container_id,upload_id,*,lock=False):
        self.scope(kind,container_id)
        query=rows()
        if lock:
            query=query.select_for_update(of=('self',))
        return get_object_or_404(query,pk=upload_id,account=request.user,assignment=request.assignment,
            **{('conversation_id' if kind=='chat' else 'channel_id'):container_id})

    def get(self,request,kind,container_id,upload_id=None):
        if upload_id is not None:
            return Response(manifest(self.owned(request,kind,container_id,upload_id)))
        container=self.scope(kind,container_id)
        query=rows().filter(account=request.user,assignment=request.assignment,
            **{('conversation_id' if kind=='chat' else 'channel_id'):container_id})
        if request.query_params:
            if set(request.query_params)!={'client_id'}:
                raise ValidationError('Filtro de subida no válido.')
            client_id=serializers.UUIDField().run_validation(request.query_params['client_id'])
            row=query.filter(client_id=client_id).first()
            message_id=container.messages.filter(author_id=self.actor(),client_id=client_id).values_list('pk',flat=True).first()
            return Response({'results':[manifest(row)] if row else [],'message_id':str(message_id) if message_id else None})
        # At most 20 outstanding rows/account; attached/terminal rows are retrieved
        # by their deterministic ID, not a growing history of every old upload.
        return Response({'results':[manifest(row) for row in query.filter(state__in=['queued','uploading','retry','ready','failed'])
            .order_by('created_at','pk')[:20]]})

    def post(self,request,kind,container_id,upload_id=None):
        if upload_id is None:
            container=self.scope(kind,container_id,write=True)
            length=request.META.get('CONTENT_LENGTH','')
            if length.isdigit() and int(length)>MAX_BYTES+65536:
                raise ValidationError('El archivo supera los 10 MB.')
            form=UploadInput(data=request.data);form.is_valid(raise_exception=True)
            row,created=enqueue(request,kind,container,form.validated_data['client_id'],prepare(form.validated_data['file']))
            return Response(manifest(row),status=202 if created else 200)
        form=UploadAction(data=request.data);form.is_valid(raise_exception=True)
        # Cancelling one's own staging is not a write into an archived/read-only
        # channel. Current read/pilot boundaries still apply to the owned record.
        self.scope(kind,container_id,write=form.validated_data['action']=='retry')
        with transaction.atomic():
            row=self.owned(request,kind,container_id,upload_id,lock=True)
            if form.validated_data['action']=='cancel':
                if row.state=='attached':
                    raise Conflict('El archivo ya se publicó; no puede cancelarse como borrador.')
                row.state='cancelled';row.content=b'';row.cipher_bytes=0
                # Keep the old lease deadline: cleanup must not race an in-flight write.
                row.lease_token=None
                row.save(update_fields=['state','content','cipher_bytes','lease_token','updated_at'])
            else:
                if not isinstance(request.auth,AuthSession):
                    raise PermissionDenied('Se requiere una sesión autenticada.')
                if row.state!='failed' or row.attempts>=6 or row.expires_at<=timezone.now() or not row.cipher_bytes:
                    raise Conflict('La subida no admite otro reintento con este identificador.')
                row.state='queued';row.cycle_attempts=0;row.next_at=timezone.now();row.session=request.auth;row.error_code=''
                row.save(update_fields=['state','cycle_attempts','next_at','session','error_code','updated_at'])
                transaction.on_commit(wake,robust=True)
            from .upload_events import publish_upload_change
            publish_upload_change(row)
            return Response(manifest(row))


class MediaUploadDiscardView(MediaUploadView):
    """Stop a nonce even if its multipart request has not committed yet.

    Same lock order as enqueue/publication. A published message wins and is
    reported, never deleted. No Google work runs inside this transaction.
    """
    http_method_names=['post','options']

    @transaction.atomic
    def post(self,request,kind,container_id):
        if not isinstance(request.auth,AuthSession):
            raise PermissionDenied('Se requiere una sesión autenticada.')
        form=DiscardInput(data=request.data);form.is_valid(raise_exception=True)
        container=self.scope(kind,container_id)
        type(container).objects.select_for_update().get(pk=container.pk)
        from .models import MediaUpload,MediaUploadQuota
        MediaUploadQuota.objects.get_or_create(pk=1)
        MediaUploadQuota.objects.select_for_update().get(pk=1)
        token=identity(kind,container.pk,request.user.pk,form.validated_data['client_id'])
        row=rows().select_for_update(of=('self',)).filter(pk=token).first()
        if row and row.assignment_id!=request.assignment.pk:
            from rest_framework.exceptions import NotFound
            raise NotFound('Subida no disponible para esta asignación.')
        message_id=container.messages.filter(author_id=self.actor(),client_id=form.validated_data['client_id']).values_list('pk',flat=True).first()
        if message_id:
            return Response({'outcome':'published','message_id':str(message_id)})
        if row and row.state=='attached':
            raise Conflict('Este intento ya se publicó. Actualiza antes de descartar.')
        now=timezone.now()
        if row is None:
            # Bounded rate of empty stops. Retain these minimal tombstones for
            # idempotency; no bytes or Drive root need to be reserved.
            recent=MediaUpload.objects.filter(root__isnull=True,created_at__gte=now-TTL)
            if recent.filter(account=request.user).count()>=200 or recent.count()>=2000:
                raise QueueFull('Hay demasiados descartes recientes. Conservamos el intento; espera antes de volver a comprobarlo.')
            from .upload_capacity import check_capacity
            check_capacity(request.user,metadata_only=True)
            row=MediaUpload.objects.create(id=token,account=request.user,assignment=request.assignment,session=request.auth,
                conversation=container if kind=='chat' else None,channel=container if kind=='channel' else None,
                client_id=form.validated_data['client_id'],state='cancelled',root=None,size_bytes=0,filename='',kind='',
                mime_type='',digest='',next_at=now,expires_at=now+TTL,cleaned_at=now)
        elif row.state not in ('cancelled','expired'):
            row.state='cancelled';row.content=b'';row.cipher_bytes=0;row.lease_token=None
            # Retain the lease deadline/reserved ID for the fenced cleanup job.
            row.save(update_fields=['state','content','cipher_bytes','lease_token','updated_at'])
        from .upload_events import publish_upload_change
        publish_upload_change(row)
        return Response({'outcome':'cancelled','upload':manifest(row)})
