"""Chat notices never contain message bodies, including desktop projections."""
from django.conf import settings
from django.utils import timezone
from boldApp.core.models import PositionAssignment
from boldApp.notificaciones.models import Notification
from boldApp.notificaciones.services import create_notification
from boldApp.notificaciones.events import dispatch_invalidation


def notify_message(message, actor):
    conversation = message.conversation
    peer_id = conversation.second_employee_id if conversation.first_employee_id == actor.employee_id else conversation.first_employee_id
    recipients = PositionAssignment.objects.select_related("employee__user_account").filter(
        employee_id=peer_id, employee__is_active=True, employee__user_account__is_active=True,
        is_active=True, released_at__isnull=True)
    if settings.MESSAGING_PILOT_ENABLED:
        recipients = recipients.filter(position__unit_id__in=settings.MESSAGING_PILOT_UNIT_IDS)
    for recipient in recipients:
        create_notification(recipient=recipient, actor=actor, event_type="messaging.message_created",
            title="Nuevo mensaje de " + actor.employee.full_name,
            body="Tienes un mensaje privado pendiente de leer en Chat.",
            route={"module": "messaging", "employee_id": str(actor.employee_id), "conversation_id": str(conversation.pk)},
            resource_type="direct_conversation", resource_id=conversation.pk,
            metadata={"message_id": str(message.pk)}, dedupe_key="chat.message:" + str(message.pk), robust_dispatch=True)


def mark_notices_read(conversation, employee_id, message_ids):
    rows = Notification.objects.filter(module="messaging", resource_type="direct_conversation",
        resource_id=conversation.pk, recipient_assignment__employee_id=employee_id,
        metadata__message_id__in=[str(value) for value in message_ids], is_read=False)
    assignments = list(rows.values_list("recipient_assignment_id", flat=True).distinct())
    if rows.update(is_read=True, read_at=timezone.now()):
        for assignment_id in assignments:
            dispatch_invalidation(assignment_id)
