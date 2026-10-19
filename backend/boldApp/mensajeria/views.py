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
        rows = self.conversations().annotate(last_body=Subquery(latest.values("body")[:1]))
        paginator = ConversationPagination()
        page = paginator.paginate_queryset(rows, request)
        ids = {identity for row in page for identity in (row.first_employee_id, row.second_employee_id)}
        directory = {person.pk: person for person in people().filter(pk__in=ids)}
        actor_id = self.actor()
        return paginator.get_paginated_response([{
            "id": str(row.pk), "peer": person_data(directory[row.second_employee_id if row.first_employee_id == actor_id else row.first_employee_id]),
            "updated_at": row.updated_at, "preview": (row.last_body or "")[:160],
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


class MessageListView(PrivateChatView):
    def get(self, request, conversation_id):
        conversation = self.conversation(conversation_id)
        paginator = MessagePagination()
        page = paginator.paginate_queryset(conversation.messages.all(), request)
        now = timezone.now()
        response = paginator.get_paginated_response([message_data(row, self.actor(), now) for row in page])
        response.data["server_now"] = now
        return response

    @transaction.atomic
    def post(self, request, conversation_id):
        conversation = self.conversation(conversation_id, lock=True)
        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor_id = self.actor()
        peer_id = conversation.second_employee_id if conversation.first_employee_id == actor_id else conversation.first_employee_id
        if not available(get_object_or_404(people(), pk=peer_id)):
            raise PermissionDenied("Este empleado ya no puede recibir mensajes. Puedes consultar el historial.")
        values = serializer.validated_data
        message, created = DirectMessage.objects.get_or_create(
            conversation=conversation, author_id=actor_id, client_id=values["client_id"], defaults={"body": values["body"]}
        )
        if not created and message.body != values["body"]:
            raise Conflict("Este envío ya existe con otro contenido. Actualiza la conversación.")
        if created:
            conversation.updated_at = message.created_at
            conversation.save(update_fields=["updated_at"])
            publish_change(conversation, "message.created", [message.pk])
        now = timezone.now()
        return Response({"message": message_data(message, actor_id, now), "server_now": now}, status=201 if created else 200)


class MessageDetailView(PrivateChatView):
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
        if serializer.validated_data["version"] != message.version:
            raise Conflict()
        if serializer.validated_data["body"] != message.body:
            message.body = serializer.validated_data["body"]
            message.version += 1
            message.edited_at = now
            message.save(update_fields=["body", "version", "edited_at"])
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
            publish_change(conversation, "receipt.updated", list(ids))
        return Response({"conversation_id": str(conversation.pk), "receipts": receipts, "server_now": now})


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
