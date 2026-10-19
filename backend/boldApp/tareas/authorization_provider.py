from boldApp.core.resource_context import register_resource_context, register_resource_access_guard
from django.core.exceptions import ValidationError
from django.db.models import Q

from .models import Task, Project, TaskFollower, ProjectMember, TaskProject


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
        row = Task.all_objects.filter(pk=resource_id).values("unit_id", "created_by_assignment_id", "assignee_assignment_id", "deleted_at").first()
    except (TypeError, ValueError, ValidationError):
        return {}
    if row is None:
        return {}
    editors = set() if row["deleted_at"] else {
        row["assignee_assignment_id"],
        *TaskFollower.objects.filter(task_id=resource_id).values_list("assignment_id", flat=True),
    }
    readers = set(editors)
    if not row["deleted_at"]:
        readers.add(row["created_by_assignment_id"])
        projects = Project.objects.filter(pk__in=TaskProject.objects.filter(task_id=resource_id).values("project_id"))
        readers.update(ProjectMember.objects.filter(project__in=projects, status="active", removed_at__isnull=True,
            assignment__is_active=True, assignment__released_at__isnull=True, assignment__employee__is_active=True).values_list("assignment_id", flat=True))
        readers.update(projects.values_list("owner_assignment_id", flat=True))
    return {
        "resource_created_by_assignment_id": row["created_by_assignment_id"],
        "task_assignee_assignment_id": None if row["deleted_at"] else row["assignee_assignment_id"],
        "task_unit_id": row["unit_id"],
        "task_reader_assignment_ids": readers,
        "task_editor_assignment_ids": editors,
        "task_delete_assignment_ids": set() if row["deleted_at"] else {
            row["created_by_assignment_id"], row["assignee_assignment_id"],
        },
    }


def project_authorization_context(resource_id):
    try:
        project = Project.objects.filter(pk=resource_id).first()
    except (TypeError, ValueError, ValidationError):
        return {}
    if not project:
        return {}
    members = set(project.members.filter(status="active", removed_at__isnull=True, assignment__is_active=True,
        assignment__released_at__isnull=True, assignment__employee__is_active=True).values_list("assignment_id", flat=True))
    members.update((project.owner_assignment_id, project.created_by_assignment_id))
    return {"project_unit_id": project.unit_id, "project_member_assignment_ids": members}


register_resource_context("tasks", "task", task_authorization_context)
register_resource_context("tasks", "comment", task_authorization_context)
register_resource_context("tasks", "project", project_authorization_context)
register_resource_access_guard("tasks", "project", project_participation_allows)
