import re

from django.db import transaction

from boldApp.core.authorization import build_authorization_context, resolve_access
from boldApp.core.models import Permission, PositionAssignment, UserAccount
from boldApp.tareas.models import Comment, Project, ProjectMember, Task, TaskFollower

from .events import dispatch_notification
from .models import Notification


EMAIL_MENTION = re.compile(r"(?<![\w.+-])@?([a-z0-9._%+-]+@bold\.gt)\b", re.IGNORECASE)


def _active_assignments(ids):
    return PositionAssignment.objects.select_related(
        "employee__user_account", "position__unit", "position__job_role"
    ).filter(
        id__in=set(ids), employee__is_active=True, employee__user_account__is_active=True, is_active=True, released_at__isnull=True
    )


def _readable_assignments(assignments, permission_code, resource):
    permission = Permission.objects.filter(code=permission_code, is_active=True).first()
    if not permission:
        return []
    readable = []
    for assignment in assignments:
        context = build_authorization_context(assignment, permission)
        if resolve_access(
            assignment,
            permission,
            resource.unit,
            resource_id=resource.id,
            context=context,
        ).allowed:
            readable.append(assignment)
    return readable


def _owner_assignment_ids():
    return PositionAssignment.objects.filter(
        employee__is_active=True,
        employee__user_account__is_active=True,
        employee__user_account__is_superuser=True,
        is_active=True,
        released_at__isnull=True,
    ).values_list("id", flat=True)


def _actor_name(actor):
    return actor.employee.full_name if actor else "Bold"


def create_notification(*, recipient, event_type, title, body="", actor=None, task=None, project=None, route=None, metadata=None, dedupe_key=None):
    if actor and recipient.id == actor.id:
        return None
    defaults = {
        "actor_assignment": actor,
        "task": task,
        "project": project,
        "type": event_type,
        "module": (route or {}).get("module", "tasks"),
        "resource_type": "task" if task else "project" if project else "",
        "resource_id": task.id if task else project.id if project else None,
        "title": title[:180],
        "body": body,
        "route": route or {},
        "metadata": metadata or {},
    }
    if dedupe_key:
        notification, created = Notification.objects.get_or_create(
            recipient_assignment=recipient,
            dedupe_key=dedupe_key,
            defaults=defaults,
        )
    else:
        notification, created = Notification.objects.create(
            recipient_assignment=recipient,
            **defaults,
        ), True
    if created:
        transaction.on_commit(lambda: dispatch_notification(notification))
    return notification if created else None


def _task_recipient_ids(task):
    ids = {task.created_by_assignment_id}
    if task.assignee_assignment_id:
        ids.add(task.assignee_assignment_id)
    ids.update(
        task.followers.exclude(notification_level="none").values_list("assignment_id", flat=True)
    )
    return ids


def notify_task_created(task_id):
    task = Task.all_objects.select_related("created_by_assignment__employee", "unit").get(id=task_id)
    actor = task.created_by_assignment
    recipients = _readable_assignments(_active_assignments([task.assignee_assignment_id]), "tasks.task.read", task)
    for recipient in recipients:
        create_notification(
            recipient=recipient, actor=actor, task=task, event_type="task.assigned",
            title="Nueva tarea asignada",
            body=f"{_actor_name(actor)} te asignó “{task.title}”.",
            route={"module": "tasks", "target": "tasks", "task_id": str(task.id)},
            dedupe_key=f"task.created:{task.id}",
        )


def notify_task_updated(task_id, previous, actor_id=None):
    task = Task.all_objects.select_related("created_by_assignment__employee", "unit", "status").get(id=task_id)
    if task.deleted_at:
        return
    actor = _active_assignments([actor_id]).first() if actor_id else None
    changes = []
    event_type = "task.updated"
    if previous.get("assignee") != task.assignee_assignment_id:
        changes.append("responsable")
        event_type = "task.assigned"
    if previous.get("status") != task.status_id:
        changes.append("estado")
        event_type = "task.status_changed"
    if previous.get("due_date") != task.due_date:
        changes.append("fecha límite")
        event_type = "task.due_changed"
    if previous.get("priority") != task.priority:
        changes.append("prioridad")
    if previous.get("title") != task.title:
        changes.append("título")
    if not changes:
        return
    recipients = _readable_assignments(_active_assignments(_task_recipient_ids(task)), "tasks.task.read", task)
    change_text = ", ".join(changes)
    for recipient in recipients:
        assigned = "responsable" in changes and recipient.id == task.assignee_assignment_id
        create_notification(
            recipient=recipient, actor=actor, task=task, event_type="task.assigned" if assigned else event_type,
            title="Te asignaron una tarea" if assigned else "Tarea actualizada",
            body=f"{_actor_name(actor)} te asignó como responsable de “{task.title}”." if assigned else f"{_actor_name(actor)} actualizó {change_text} de “{task.title}”.",
            route={"module": "tasks", "target": "tasks", "task_id": str(task.id)},
            dedupe_key=f"task.updated:{task.id}:{task.updated_at.isoformat()}",
            metadata={"changed_fields": changes},
        )


def notify_comment_created(comment_id):
    comment = Comment.all_objects.select_related(
        "author_assignment__employee", "task__unit", "task__created_by_assignment"
    ).get(id=comment_id)
    task = comment.task
    actor = comment.author_assignment
    regular_ids = set(_task_recipient_ids(task))
    emails = {email.lower() for email in EMAIL_MENTION.findall(comment.body)}
    mentioned_ids = set()
    if emails:
        account_ids = UserAccount.objects.filter(email__in=emails, is_active=True).values_list("employee_id", flat=True)
        mentioned_ids.update(
            PositionAssignment.objects.filter(
                employee_id__in=account_ids, is_active=True, released_at__isnull=True
            ).values_list("id", flat=True)
        )
    all_ids = regular_ids | mentioned_ids
    recipients = _readable_assignments(_active_assignments(all_ids), "tasks.task.read", task)
    snippet = " ".join(comment.body.split())[:180]
    for recipient in recipients:
        mentioned = recipient.id in mentioned_ids
        create_notification(
            recipient=recipient, actor=actor, task=task,
            event_type="comment.mentioned" if mentioned else "comment.created",
            title="Te mencionaron en un comentario" if mentioned else "Nuevo comentario",
            body=f"{_actor_name(actor)} en “{task.title}”: {snippet}",
            route={"module": "tasks", "target": "tasks", "task_id": str(task.id), "comment_id": str(comment.id)},
            dedupe_key=f"comment.created:{comment.id}",
        )


def _project_recipient_ids(project):
    ids = {project.owner_assignment_id, *list(_owner_assignment_ids())}
    ids.update(
        project.members.filter(status="active", removed_at__isnull=True).values_list("assignment_id", flat=True)
    )
    return ids


def notify_project_created(project_id):
    project = Project.all_objects.select_related("created_by_assignment__employee", "unit").get(id=project_id)
    actor = project.created_by_assignment
    recipients = _readable_assignments(_active_assignments({project.owner_assignment_id, *list(_owner_assignment_ids())}), "tasks.project.read", project)
    for recipient in recipients:
        create_notification(
            recipient=recipient, actor=actor, project=project, event_type="project.created",
            title="Te asignaron un proyecto" if recipient.pk == project.owner_assignment_id else "Nuevo proyecto",
            body=f"{_actor_name(actor)} te asignó como responsable de “{project.name}”." if recipient.pk == project.owner_assignment_id else f"{_actor_name(actor)} creó “{project.name}” en {project.unit.name}.",
            route={"module": "tasks", "target": "department_projects", "project_id": str(project.id)},
            dedupe_key=f"project.created:{project.id}",
        )


def notify_project_updated(project_id, previous, actor_id=None):
    project = Project.all_objects.select_related("created_by_assignment__employee", "unit").get(id=project_id)
    if project.deleted_at:
        return
    actor = _active_assignments([actor_id]).first() if actor_id else None
    changes = []
    owner_changed = previous.get("owner_assignment_id") != project.owner_assignment_id
    if owner_changed:
        changes.append("responsable")
    for key, label in (("status", "estado"), ("end_date", "fecha de entrega"), ("priority", "prioridad"), ("name", "nombre")):
        if previous.get(key) != getattr(project, key):
            changes.append(label)
    if not changes:
        return
    recipients = _readable_assignments(_active_assignments(_project_recipient_ids(project)), "tasks.project.read", project)
    for recipient in recipients:
        assigned = owner_changed and recipient.pk == project.owner_assignment_id
        create_notification(
            recipient=recipient, actor=actor, project=project, event_type="project.assigned" if assigned else "project.updated",
            title="Te asignaron un proyecto" if assigned else "Proyecto actualizado",
            body=f"{_actor_name(actor)} te asignó como responsable de “{project.name}”." if assigned else f"{_actor_name(actor)} actualizó {', '.join(changes)} de “{project.name}”.",
            route={"module": "tasks", "target": "department_projects", "project_id": str(project.id)},
            dedupe_key=f"project.updated:{project.id}:{project.updated_at.isoformat()}",
            metadata={"changed_fields": changes},
        )


def notify_project_member_added(member_id, actor_id=None, event_id=None):
    member = ProjectMember.objects.select_related(
        "project__unit", "assignment__employee", "added_by_assignment__employee"
    ).filter(id=member_id).first()
    if not member or member.project.deleted_at or member.status != "active" or member.removed_at:
        return
    actor = _active_assignments([actor_id]).first() if actor_id else member.added_by_assignment
    recipients = _readable_assignments(_active_assignments([member.assignment_id]), "tasks.project.read", member.project)
    for recipient in recipients:
        create_notification(
            recipient=recipient, actor=actor, project=member.project,
            event_type="project.member_added", title="Te agregaron a un proyecto",
            body=f"{_actor_name(actor)} te agregó a “{member.project.name}”.",
            route={"module": "tasks", "target": "department_projects", "project_id": str(member.project_id)},
            dedupe_key=f"project.member_added:{member.id}:{event_id or member.joined_at.isoformat()}",
        )


def notify_task_follower_added(follower_id, actor_id=None, event_id=None):
    follower = TaskFollower.objects.select_related("task__unit", "added_by_assignment__employee").filter(pk=follower_id).first()
    if not follower or follower.notification_level == "none" or follower.task.deleted_at:
        return
    # The responsible already receives its assignment notification.
    if follower.assignment_id == follower.task.assignee_assignment_id:
        return
    actor = _active_assignments([actor_id]).first() if actor_id else follower.added_by_assignment
    recipients = _readable_assignments(_active_assignments([follower.assignment_id]), "tasks.task.read", follower.task)
    for recipient in recipients:
        create_notification(
            recipient=recipient, actor=actor, task=follower.task,
            event_type="task.collaborator_added", title="Te agregaron como colaborador",
            body=f"{_actor_name(actor)} te agregó como colaborador de “{follower.task.title}”.",
            route={"module": "tasks", "target": "tasks", "task_id": str(follower.task_id)},
            dedupe_key=f"task.collaborator_added:{follower.pk}:{event_id or follower.followed_at.isoformat()}",
        )
