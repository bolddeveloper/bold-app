"""Versioned personal attention on the existing employee socket, not notices."""
import logging
from types import SimpleNamespace

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import F, Q
from django.db.models.signals import pre_delete
from django.utils import timezone

from boldApp.core.events import build_event_envelope
from boldApp.core.models import Employee, PositionAssignment
from .models import ReadingReminder, ReadingReminderClock, SearchDocument

log = logging.getLogger(__name__)
MAX_READING_REMINDERS = 500


def scope_key(document):
    if document.direct_id:
        return "chat:" + str(document.direct.conversation_id)
    message = document.channel_message
    return ("thread:" + str(message.parent_id)) if message.parent_id else ("channel:" + str(message.channel_id))


def reminder_data(row):
    document = row.document
    if not document:
        return None
    if document.direct_id:
        message = document.direct
        conversation = message.conversation
        peer = conversation.second_employee_id if conversation.first_employee_id == row.employee_id else conversation.first_employee_id
        target = {"kind":"chat", "conversation_id":str(message.conversation_id), "message_id":str(message.pk), "employee_id":str(peer)}
    else:
        message = document.channel_message
        target = {"kind":"channel", "channel_id":str(message.channel_id), "message_id":str(message.pk),
            "parent_id":str(message.parent_id) if message.parent_id else None}
    return {"id":str(row.pk), "scope_key":row.scope_key, "document_id":str(document.pk),
        "version":row.version, "target":target}


def history_view(view):
    from .search_views import HistorySearchView
    if isinstance(view, HistorySearchView):
        return view
    result = HistorySearchView()
    result.request = view.request
    return result


@transaction.atomic
def reading_snapshot(view):
    actor = view.actor()
    # A collection clock plus complete snapshots prevents late HTTP/socket
    # responses from resurrecting a cleared reminder, including across scopes.
    Employee.objects.select_for_update().get(pk=actor)
    version = ReadingReminderClock.objects.filter(employee_id=actor).values_list("version", flat=True).first() or 0
    candidates = ReadingReminder.objects.filter(employee_id=actor, document__isnull=False)
    if not candidates.exists():
        return {"version":version, "items":[]}
    visible = history_view(view).visible_documents({"scope":"all", "kind":"all", "archived":True})
    rows = candidates.filter(document_id__in=visible.values("pk")).select_related(
        "document__direct__conversation", "document__channel_message").defer(
            "document__text", "document__direct__body", "document__channel_message__body").order_by("scope_key")[:MAX_READING_REMINDERS]
    return {"version":version, "items":[reminder_data(row) for row in rows]}


def advance_clock(employee_id):
    # Call only while holding this Employee row's transaction lock. Cleared rows
    # remain as tiny tombstones; their old request versions can never reapply.
    clock, _ = ReadingReminderClock.objects.get_or_create(employee_id=employee_id)
    clock.version += 1
    clock.save(update_fields=["version"])
    return clock.version


def publish_reading_change(employee_id):
    def dispatch():
        try:
            layer = get_channel_layer()
            if layer is not None:
                async_to_sync(layer.group_send)(f"messaging_employee_{employee_id}",
                    {"type":"messaging.reminder.changed", "employee_id":str(employee_id)})
        except Exception:
            log.warning("Personal reading push unavailable; reminders remain persisted")
    transaction.on_commit(dispatch, robust=True)


def reading_event(assignment_id, session_id, event):
    from boldApp.autenticacion.models import AuthSession
    from .access import assignment_can_chat
    from .views import PrivateChatView
    assignment = PositionAssignment.objects.select_related("employee__user_account", "position__unit", "position__job_role").filter(pk=assignment_id).first()
    if not assignment or str(assignment.employee_id) != event.get("employee_id") or not assignment_can_chat(assignment):
        return None
    now = timezone.now()
    session = AuthSession.objects.filter(pk=session_id, user_account__employee_id=assignment.employee_id,
        user_account__is_active=True, user_account__employee__is_active=True, revoked_at__isnull=True,
        expires_at__gt=now, credentials_version=F("user_account__credentials_version")).filter(
            Q(idle_expires_at__isnull=True) | Q(idle_expires_at__gt=now)).first()
    if not session:
        return None
    view = PrivateChatView()
    view.request = SimpleNamespace(assignment=assignment, auth=session, user=assignment.employee.user_account)
    snapshot = reading_snapshot(view)
    return build_event_envelope("messaging.reminder.changed", "employee", assignment.employee_id, {"reading":snapshot})


def document_removed(sender, instance, using, **kwargs):
    # SET_NULL alone would leave the collection clock unchanged and allow an
    # older snapshot to resurrect a now-deleted anchor on another device.
    employees = list(ReadingReminder.objects.using(using).filter(document=instance)
        .order_by("employee_id").values_list("employee_id", flat=True).distinct())
    for employee_id in employees:
        Employee.objects.using(using).select_for_update().get(pk=employee_id)
        version = advance_clock(employee_id)
        ReadingReminder.objects.using(using).filter(employee_id=employee_id, document=instance).update(document=None, version=version)
        publish_reading_change(employee_id)


def connect():
    pre_delete.connect(document_removed, sender=SearchDocument, dispatch_uid="messaging.reading.document_removed", weak=False)
