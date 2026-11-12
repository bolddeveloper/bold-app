"""Append-only operational facts. Missing historical intervals stay unknown."""
from django.utils import timezone
from django.db import transaction
from django.db.models import Max
from boldApp.core.models import PositionAssignment
from .models import Task, TaskTimelineEvent, TaskTracking


def assignment_snapshot(assignment):
    if not assignment:
        return {}
    return {'assignment_id': str(assignment.pk), 'employee_id': str(assignment.employee_id),
            'name': assignment.employee.full_name, 'unit_id': str(assignment.position.unit_id),
            'unit_name': assignment.position.unit.name}


def task_snapshot(task):
    return {'status_id': str(task.status_id), 'status_category': task.status.category,'status_name':task.status.name,
            'completed': task.status.is_final, 'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            'assignee_id': str(task.assignee_assignment_id) if task.assignee_assignment_id else None,
            'assignee':assignment_snapshot(task.assignee_assignment),
            'unit_id': str(task.unit_id),'unit_name':task.unit.name, 'due_date': task.due_date.isoformat() if task.due_date else None,
            'start_date': task.start_date.isoformat() if task.start_date else None,
            'deleted': task.deleted_at is not None, 'priority': task.priority}


def event(task, kind, *, actor=None, phase=None, before=None, after=None, reason='', at=None):
    people = list(phase.responsible.select_related('employee', 'position__unit')) if phase else (
        [task.assignee_assignment] if task.assignee_assignment_id else [])
    lead = phase.lead if phase else task.assignee_assignment
    with transaction.atomic():
        Task.all_objects.select_for_update().get(pk=task.pk)
        sequence=(TaskTimelineEvent.objects.filter(task=task).aggregate(last=Max('sequence'))['last'] or 0)+1
        return TaskTimelineEvent.objects.create(task=task, phase=phase, kind=kind, actor=actor,sequence=sequence,
            responsible_assignment_id=lead.pk if lead else None,
            responsible_employee_id=lead.employee_id if lead else None,
            responsible_unit_id=lead.position.unit_id if lead else task.unit_id,
            actor_snapshot=assignment_snapshot(actor), responsibility_snapshot=[assignment_snapshot(p) for p in people],
            before=before or {}, after=after or {}, reason=reason, occurred_at=at or timezone.now())


def record_task_save(task, previous, *, created):
    TaskTracking.objects.get_or_create(task=task, defaults={
        'observed_since': task.created_at if created else timezone.now(), 'complete_history': created})
    current = task_snapshot(task)
    actor_id = getattr(task, '_notification_actor_assignment_id', None)
    actor = PositionAssignment.objects.select_related('employee', 'position__unit').filter(pk=actor_id).first() if actor_id else None
    if created:
        event(task, 'task.created', actor=actor, after=current)
        if current['completed']:
            event(task, 'task.completed', actor=actor, after=current)
        return
    if previous is None or previous == current:
        return
    kind = ('task.completed' if current['completed'] and not previous['completed'] else
            'task.reopened' if previous['completed'] and not current['completed'] else 'task.changed')
    event(task, kind, actor=actor, before=previous, after=current)
