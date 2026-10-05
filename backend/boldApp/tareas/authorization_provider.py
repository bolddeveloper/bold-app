from boldApp.core.resource_context import register_resource_context, register_resource_access_guard
from django.core.exceptions import ValidationError
from django.db.models import Q

from .models import Task, Project


def participating_projects(assignment, queryset=None):
    queryset = Project.objects.all() if queryset is None else queryset
    if assignment.employee.user_account.is_superuser:
        return queryset
    return queryset.filter(
        Q(created_by_assignment=assignment) | Q(owner_assignment=assignment)
        | Q(members__assignment=assignment, members__status="active", members__removed_at__isnull=True)
    ).distinct()


def project_participation_allows(assignment, resource_id):
    try:
        return participating_projects(assignment, Project.objects.filter(pk=resource_id)).exists()
    except (TypeError, ValueError, ValidationError):
        return False


def task_authorization_context(resource_id):
    try:
        row = Task.all_objects.filter(pk=resource_id).values("created_by_assignment_id").first()
    except (TypeError, ValueError, ValidationError):
        return {}
    if row is None:
        return {}
    return {"resource_created_by_assignment_id": row["created_by_assignment_id"]}


register_resource_context("tasks", "task", task_authorization_context)
register_resource_access_guard("tasks", "project", project_participation_allows)
