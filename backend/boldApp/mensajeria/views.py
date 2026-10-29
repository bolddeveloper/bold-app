from django.db import transaction
from django.db.models import Case, F, OuterRef, Q, Subquery, Value, When, DateTimeField
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from boldApp.core.permissions import HasActiveAssignment
from .access import CanUseChatPilot

from .models import DirectConversation, DirectMessage, MessagingPreferences
from .serializers import EditMessageSerializer, OpenConversationSerializer, SendMessageSerializer, ReceiptSerializer, PreferencesSerializer
from .presenters import available, message_data, people, person_data
from .events import publish_change
from .unread import summaries
from .notifications import notify_message, mark_notices_read
from .media import BoundedUpload, MAX_BYTES
from .personal_data import prime_saved
from .reactions import prime_reactions
from .mentions import prime_direct_mentions, sync_direct_mentions


class Conflict(APIException):
    status_code = 409
    default_detail = "El mensaje cambió. Actualiza la conversación antes de volver a editarlo."
    default_code = "message_conflict"


class MessagingReadThrottle(UserRateThrottle):
    scope = "messaging_read"
    rate = "120/min"


class MessagingWriteThrottle(UserRateThrottle):
    scope = "messaging_write"
    rate = "60/min"


class ConversationOpenThrottle(UserRateThrottle):
    scope = "messaging_open"
    rate = "20/min"


class ReceiptThrottle(UserRateThrottle):
    scope = "messaging_receipts"
    rate = "120/min"


class ConversationPagination(CursorPagination):
    page_size = 25
    ordering = ("-updated_at", "-id")


class MessagePagination(CursorPagination):
    page_size = 50
    ordering = ("-created_at", "-id")


class PrivateChatView(APIView):
    permission_classes = [HasActiveAssignment, CanUseChatPilot]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Pragma"] = "no-cache"
        return response

    def get_throttles(self):
        return [(MessagingReadThrottle if self.request.method == "GET" else MessagingWriteThrottle)()]

    def actor(self):
        employee = self.request.assignment.employee
        if not employee.is_active:
            raise PermissionDenied("El empleado no está activo.")
        return employee.pk

    def conversations(self):
        actor_id = self.actor()
        # Deliberately no hierarchy/owner override: membership is the read boundary.
        return DirectConversation.objects.filter(Q(first_employee_id=actor_id) | Q(second_employee_id=actor_id),
            first_employee__in=people().values("pk"), second_employee__in=people().values("pk"))

    def conversation(self, conversation_id, *, lock=False):
        rows = self.conversations()
        return get_object_or_404(rows.select_for_update() if lock else rows, pk=conversation_id)

    def conversation_data(self, conversation):
        actor_id = self.actor()
        participants = {person.pk: person for person in people().filter(pk__in=[conversation.first_employee_id, conversation.second_employee_id])}
        peer_id = conversation.second_employee_id if conversation.first_employee_id == actor_id else conversation.first_employee_id
        return {
            "id": str(conversation.pk), "peer": person_data(participants[peer_id]),
            "me": person_data(participants[actor_id]), "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
        }


class ConversationListView(PrivateChatView):
    def get_throttles(self):
        return [ConversationOpenThrottle()] if self.request.method == "POST" else super().get_throttles()

    def get(self, request):
        latest = DirectMessage.objects.filter(conversation_id=OuterRef("pk")).order_by("-created_at", "-id")
        rows = self.conversations().annotate(last_body=Subquery(latest.values("body")[:1]),
            last_media=Subquery(latest.values("media__kind")[:1]))
        paginator = ConversationPagination()
        page = paginator.paginate_queryset(rows, request)
        ids = {identity for row in page for identity in (row.first_employee_id, row.second_employee_id)}
        directory = {person.pk: person for person in people().filter(pk__in=ids)}
        actor_id = self.actor()
        return paginator.get_paginated_response([{
            "id": str(row.pk), "peer": person_data(directory[row.second_employee_id if row.first_employee_id == actor_id else row.first_employee_id]),
            "updated_at": row.updated_at, "preview": (row.last_body or ({"audio":"Nota de voz", "image":"Imagen", "document":"Documento"}.get(row.last_media, "")))[:160],
        } for row in page])

    def post(self, request):
        serializer = OpenConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor_id = self.actor()
        peer_id = serializer.validated_data["employee_id"]
        if peer_id == actor_id:
            raise ValidationError({"employee_id": "Selecciona a otro empleado para conversar."})
        peer = get_object_or_404(people(), pk=peer_id)
        if not available(peer):
            raise ValidationError({"employee_id": "Este empleado no tiene una cuenta y una plaza activas."})
        first, second = sorted([actor_id, peer_id])
        conversation, created = DirectConversation.objects.get_or_create(first_employee_id=first, second_employee_id=second)
        return Response(self.conversation_data(conversation), status=201 if created else 200)


class ConversationDetailView(PrivateChatView):
    def get(self, request, conversation_id):
        return Response(self.conversation_data(self.conversation(conversation_id)))


class UnreadSummaryView(PrivateChatView):
    def get(self, request):
        from .reading_reminders import reading_snapshot
        return Response({"conversations": summaries(self.conversations(), self.actor()), "reading":reading_snapshot(self)})


class MessageListView(PrivateChatView):
    def initialize_request(self, request, *args, **kwargs):
        # CSRF authentication can parse multipart before post() is entered.
        if request.method == "POST":
            request.upload_handlers.insert(0, BoundedUpload(request))
        return super().initialize_request(request, *args, **kwargs)

    def get(self, request, conversation_id):
        conversation = self.conversation(conversation_id)
        paginator = MessagePagination()
        page = paginator.paginate_queryset(conversation.messages.select_related("media"), request)
        prime_saved(page, "direct", self.actor())
        prime_reactions(page, "direct", self.actor())
        prime_direct_mentions(page)
        now = timezone.now()
        response = paginator.get_paginated_response([message_data(row, self.actor(), now) for row in page])
        response.data["server_now"] = now
        return response

    @transaction.atomic
    def post(self, request, conversation_id):
        conversation = self.conversation(conversation_id, lock=True)
        length = request.META.get("CONTENT_LENGTH", "")
        if length.isdigit() and int(length) > MAX_BYTES + 65536:
            raise ValidationError("El mensaje supera el tamaño permitido de 10 MB.")
        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor_id = self.actor()
        peer_id = conversation.second_employee_id if conversation.first_employee_id == actor_id else conversation.first_employee_id
        if not available(get_object_or_404(people(), pk=peer_id)):
            raise PermissionDenied("Este empleado ya no puede recibir mensajes. Puedes consultar el historial.")
        values = serializer.validated_data
        # A forwarding review can retire an uncertain text nonce as well as an
        # attachment. Discard/publication hold this same conversation lock, so
        # a delayed request cannot revive an explicitly stopped intent.
        from .upload_outbox import identity as upload_identity
        from .models import MediaUpload
        if MediaUpload.objects.filter(pk=upload_identity('chat',conversation.pk,request.user.pk,values['client_id']),
                state__in=('cancelled','expired')).exists():
            raise Conflict('Este intento se descartó. Revisa el borrador antes de iniciar otro envío.')
        prepared = None
        staged = None
        if values['upload_id']:
            from .upload_outbox import prepared_upload
            staged,prepared=prepared_upload(request,'chat',conversation,values['client_id'],values['upload_id'])
        message, created = DirectMessage.objects.get_or_create(
            conversation=conversation, author_id=actor_id, client_id=values["client_id"], defaults={"body": values["body"]}
        )
        if not created and message.body != values["body"]:
            raise Conflict("Este envío ya existe con otro contenido. Actualiza la conversación.")
        if not created:
            media = getattr(message, "media", None)
            if bool(media) != bool(prepared) or media and media.digest != prepared["digest"]:
                raise Conflict("Este envío ya existe con otro archivo. No se ha duplicado el mensaje.")
        if created:
            sync_direct_mentions(message)
            if prepared:
                from .upload_outbox import attach
                attach(staged,message)
            conversation.updated_at = message.created_at
            conversation.activity_version += 1
            conversation.save(update_fields=["updated_at", "activity_version"])
            notify_message(message, request.assignment)
            publish_change(conversation, "message.created", [message.pk])
        now = timezone.now()
        return Response({"message": message_data(message, actor_id, now), "server_now": now}, status=201 if created else 200)


class MessageDetailView(PrivateChatView):
    def get(self,request,conversation_id,message_id):
        conversation=self.conversation(conversation_id)
        message=get_object_or_404(conversation.messages.select_related('media'),pk=message_id)
        prime_saved([message],'direct',self.actor());prime_reactions([message],'direct',self.actor())
        prime_direct_mentions([message]);now=timezone.now()
        return Response({'message':message_data(message,self.actor(),now),'server_now':now})

    @transaction.atomic
    def patch(self, request, conversation_id, message_id):
        conversation = self.conversation(conversation_id)
        message = get_object_or_404(DirectMessage.objects.select_for_update(), pk=message_id, conversation=conversation)
        if message.author_id != self.actor():
            raise PermissionDenied("Solo puedes editar tus propios mensajes.")
        now = timezone.now()
        if now >= message.editable_until:
            raise PermissionDenied("El plazo de diez minutos para editar este mensaje ha terminado.")
        serializer = EditMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data["body"] and not hasattr(message, "media"):
            raise ValidationError("Un mensaje de texto no puede quedar vacío.")
        if serializer.validated_data["version"] != message.version:
            raise Conflict()
        if serializer.validated_data["body"] != message.body:
            message.body = serializer.validated_data["body"]
            message.version += 1
            message.edited_at = now
            message.save(update_fields=["body", "version", "edited_at"])
            sync_direct_mentions(message)
            prime_direct_mentions([message])
            publish_change(conversation, "message.updated", [message.pk])
        return Response({"message": message_data(message, self.actor(), now), "server_now": now})


class ReceiptView(PrivateChatView):
    throttle_classes = [ReceiptThrottle]

    def get_throttles(self):
        return [ReceiptThrottle()]

    @transaction.atomic
    def post(self, request, conversation_id):
        conversation = self.conversation(conversation_id, lock=True)
        serializer = ReceiptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = set(serializer.validated_data["message_ids"])
        # Only the recipient can acknowledge messages actually addressed to them.
        rows = conversation.messages.filter(pk__in=ids).exclude(author_id=self.actor())
        if rows.count() != len(ids):
            from rest_framework.exceptions import NotFound
            raise NotFound("Los mensajes no están disponibles para confirmar su recepción.")
        now = timezone.now()
        changed = rows.filter(delivered_at__isnull=True).update(delivered_at=now)
        if serializer.validated_data["state"] == "read":
            changed += rows.filter(read_at__isnull=True).update(read_at=Case(
                When(delivered_at__gt=now, then=F("delivered_at")), default=Value(now), output_field=DateTimeField()))
        receipts = [{"id": str(row.pk), "delivered_at": row.delivered_at, "read_at": row.read_at} for row in rows]
        if changed:
            if serializer.validated_data["state"] == "read":
                conversation.activity_version += 1
                conversation.save(update_fields=["activity_version"])
                mark_notices_read(conversation, self.actor(), ids)
            publish_change(conversation, "receipt.updated", list(ids))
        return Response({"conversation_id": str(conversation.pk), "receipts": receipts, "server_now": now,
                         "unread": summaries(DirectConversation.objects.filter(pk=conversation.pk), self.actor())[0]})


class MessageMediaView(PrivateChatView):
    def get(self, request, conversation_id, message_id):
        from .media import private_media_response
        conversation = self.conversation(conversation_id)
        message = get_object_or_404(conversation.messages.select_related("media__root__user"), pk=message_id)
        media = getattr(message, "media", None)
        if not media:
            from rest_framework.exceptions import NotFound
            raise NotFound("Este mensaje no contiene un archivo.")
        return private_media_response(media)


class PreferencesView(PrivateChatView):
    def get(self, request):
        self.actor()
        value = MessagingPreferences.objects.filter(account=request.user).first()
        return Response({"enter_behavior": value.enter_behavior if value else "send"})

    def put(self, request):
        self.actor()
        serializer = PreferencesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value, _ = MessagingPreferences.objects.update_or_create(account=request.user, defaults=serializer.validated_data)
        return Response({"enter_behavior": value.enter_behavior})
