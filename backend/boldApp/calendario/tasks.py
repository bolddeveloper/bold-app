from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import CalendarDraft
from boldApp.workspace.models import GoogleConnection
from .service import event_path, google_request


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
