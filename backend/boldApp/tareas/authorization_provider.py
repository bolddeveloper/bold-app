from boldApp.core.resource_context import register_resource_context
from django.core.exceptions import ValidationError

from .models import Task


def task_authorization_context(resource_id):
    try:
        row = Task.all_objects.filter(pk=resource_id).values("created_by_assignment_id").first()
    except (TypeError, ValueError, ValidationError):
        return {}
    if row is None:
        return {}
    return {"resource_created_by_assignment_id": row["created_by_assignment_id"]}


register_resource_context("tasks", "task", task_authorization_context)
