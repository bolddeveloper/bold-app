"""Generate dated occurrences from existing tasks, with bounded catch-up and deduplication."""
from calendar import monthrange
from datetime import date, timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from boldApp.core.authorization import resolve_access
from boldApp.core.models import Permission
from .models import Attachment, Task, TaskFollower, TaskProject, TaskStatus, TaskTag


def next_date(current, rule, anchor_day=None):
    interval = rule["interval"]
    try:
        if rule["frequency"] != "monthly":
            following = current + timedelta(days=interval * (7 if rule["frequency"] == "weekly" else 1))
        else:
            month = current.year * 12 + current.month - 1 + interval
            year, offset = divmod(month, 12)
            following = date(year, offset + 1, min(anchor_day or current.day, monthrange(year, offset + 1)[1]))
        return following if following <= date.fromisoformat(rule["until"]) else None
    except (ValueError, OverflowError):
        return None


def validate_rule(rule, anchor):
    if rule == {}:
        return rule
    if not isinstance(rule, dict) or set(rule) != {"frequency", "interval", "until"} or rule.get("frequency") not in ("daily", "weekly", "monthly"):
        raise ValidationError({"recurrence": "Selecciona repetición diaria, semanal o mensual y una fecha final."})
    interval = rule["interval"]
    if isinstance(interval, bool) or not isinstance(interval, int) or not 1 <= interval <= 365:
        raise ValidationError({"recurrence": "El intervalo debe estar entre 1 y 365."})
    try:
        until = date.fromisoformat(rule["until"])
        if not anchor or until <= anchor or until.year > 9998:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValidationError({"recurrence": "Indica una fecha inicial y una fecha final posterior."})
    return rule


def copy_occurrence(source, occurrence_date, status, parent=None, delta=None):
    from boldApp.workspace.image_storage import store_instance_images, task_path
    if not source.image_origin_set:
        task_path(source)
    delta = delta if delta is not None else occurrence_date - (source.start_date or source.due_date)
    task = Task.objects.create(unit=source.unit, created_by_assignment=source.created_by_assignment,
        image_origin_project_id=source.image_origin_project_id, image_origin_set=source.image_origin_set,
        assignee_assignment=source.assignee_assignment, status=status, title=source.title,
        description=source.description, voice_notes=source.voice_notes, priority=source.priority,
        start_date=source.start_date + delta if source.start_date else None,
        due_date=source.due_date + delta if source.due_date else None,
        parent_task=parent or source.parent_task,
        recurrence_source=source if parent is None else None,
        recurrence_date=occurrence_date if parent is None else None)
    store_instance_images(task)
    for follower in source.followers.filter(assignment__is_active=True, assignment__released_at__isnull=True, assignment__employee__is_active=True, assignment__employee__user_account__is_active=True):
        TaskFollower.objects.create(task=task, assignment=follower.assignment, notification_level=follower.notification_level, added_by_assignment=source.created_by_assignment)
    for link in source.task_projects.filter(project__deleted_at__isnull=True):
        TaskProject.objects.create(task=task, project=link.project, section=link.section, position=link.position, added_by_assignment=source.created_by_assignment)
    for link in source.task_tags.all():
        TaskTag.objects.create(task=task, tag=link.tag, added_by_assignment=source.created_by_assignment)
    for item in source.attachments.filter(deleted_at__isnull=True):
        attachment = Attachment.objects.create(task=task, uploaded_by_assignment=item.uploaded_by_assignment,
            file_name=item.file_name, file_url=item.file_url, mime_type=item.mime_type, size_bytes=item.size_bytes)
        store_instance_images(attachment)
    for child in source.subtasks.all():
        copy_occurrence(child, occurrence_date, status, task, delta)
    return task


@shared_task
def generate_recurring_tasks(today=None):
    today = today or timezone.localdate()
    permission = Permission.objects.filter(code="tasks.task.create", is_active=True).first()
    if not permission:
        return 0
    count = 0
    for task_id in Task.objects.filter(recurrence_next_date__lte=today, parent_task__deleted_at__isnull=True, created_by_assignment__employee__user_account__is_active=True).values_list("pk", flat=True):
        with transaction.atomic():
            source = Task.objects.select_for_update().select_related("unit", "created_by_assignment__position", "created_by_assignment__employee__user_account").filter(pk=task_id).first()
            if not source or not source.recurrence or not source.recurrence_next_date:
                continue
            assignment = source.created_by_assignment
            if not assignment.is_active or assignment.released_at or not assignment.employee.is_active or not assignment.employee.user_account.is_active or not resolve_access(assignment, permission, source.unit).allowed:
                continue
            status = TaskStatus.objects.filter(unit=source.unit, is_final=False).order_by("position").first()
            if not status:
                continue
            until = date.fromisoformat(source.recurrence["until"])
            due = source.recurrence_next_date
            # ponytail: catch up 32 occurrences per tick; a queue can replace this bound for large imports.
            for _ in range(32):
                if due is None or due > today or due > until:
                    break
                if not Task.all_objects.filter(recurrence_source=source, recurrence_date=due).exists():
                    copy_occurrence(source, due, status)
                    count += 1
                due = next_date(due, source.recurrence, (source.start_date or source.due_date).day)
            source.recurrence_next_date = due
            source.save(update_fields=["recurrence_next_date", "updated_at"])
    return count
