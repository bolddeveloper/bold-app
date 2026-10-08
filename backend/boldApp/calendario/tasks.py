from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import CalendarDraft
from boldApp.workspace.models import GoogleConnection
from .service import event_path, google_request


@shared_task
def send_calendar_reminders():
    from .reminders import refresh_reminders
    count = 0
    for connection in GoogleConnection.objects.select_related("user").filter(user__is_active=True):
        try:
            count += refresh_reminders(connection.user)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Calendar reminders failed for account %s", connection.user_id)
    return count


@shared_task
def refresh_calendar_presence():
    from boldApp.autenticacion.presence import connected_account_ids, settings_for
    from boldApp.core.models import UserAccount
    from .presence import refresh_meetings
    from django.core.cache import caches
    accounts = UserAccount.objects.filter(pk__in=connected_account_ids(), googleconnection__isnull=False)
    for user in accounts:
        preferences = settings_for(user)
        if not preferences["calendar_automatic"] or preferences["status"] in ("offline", "vacation"):
            continue
        # A short lock prevents overlapping beats from multiplying Google requests.
        key = f"calendar-sync:{user.pk}"
        if caches["presence"].add(key, True, 110):
            try:
                refresh_meetings(user)
            except Exception:
                caches["presence"].delete(f"meetings:{user.pk}")


@shared_task
def cleanup_calendar_drafts():
    expired = CalendarDraft.objects.filter(last_seen_at__lt=timezone.now() - timedelta(minutes=4)).values_list("id", flat=True)
    for draft_id in expired:
        with transaction.atomic():
            draft = CalendarDraft.objects.select_for_update().filter(pk=draft_id, last_seen_at__lt=timezone.now() - timedelta(minutes=4)).first()
            if not draft:
                continue
            if not draft.connection_id or not draft.owner_id or not GoogleConnection.objects.filter(pk=draft.connection_id, user_id=draft.owner_id, subject=draft.google_subject).exists():
                continue
            try:
                google_request(draft.owner, "DELETE", event_path(draft.event_id), params={"sendUpdates": "none"})
            except ValidationError as error:
                if "ya no existe" not in str(error):
                    continue
            except Exception:
                # Keep the record for the next minute when Google is unavailable.
                continue
            draft.delete()
