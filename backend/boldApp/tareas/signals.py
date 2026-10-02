from functools import partial

from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from boldApp.core.models import OrganizationalUnit

from .catalog import ensure_default_task_statuses
from .models import Attachment, Comment, Project, ProjectMember, Section, Tag, Task, TaskFollower, TaskProject, TaskStatus, TaskTag
from .webhook_events import (
    COMMENT_CREATED,
    TASK_CREATED,
    TASK_DELETED,
    TASK_STATUS_CHANGED,
    TASK_UPDATED,
    dispatch_task_event,
    dispatch_resource_invalidation,
)
from .serializers import CommentSerializer, TaskSerializer


@receiver(post_save, sender=OrganizationalUnit)
def provision_task_statuses_for_new_unit(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        ensure_default_task_statuses(instance)


# Guarda el estado previo de status/unit/deleted_at de la tarea antes de guardarla,
# para poder comparar en post_save y decidir que evento(s) disparar.
@receiver(pre_save, sender=Task)
def capture_previous_task_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status_id = None
        instance._previous_unit_id = None
        instance._previous_deleted_at = None
        return

    previous = Task.all_objects.filter(pk=instance.pk).values("status_id", "unit_id", "deleted_at").first()
    instance._previous_status_id = previous["status_id"] if previous else None
    instance._previous_unit_id = previous["unit_id"] if previous else None
    instance._previous_deleted_at = previous["deleted_at"] if previous else None


# Dispara el evento de webhook correspondiente segun lo que cambio en la tarea.
@receiver(post_save, sender=Task)
def dispatch_task_events(sender, instance, created, **kwargs):
    payload = TaskSerializer(instance).data
    unit_ids = [instance.unit_id]
    if instance._previous_unit_id and instance._previous_unit_id != instance.unit_id:
        unit_ids.insert(0, instance._previous_unit_id)

    def enqueue(event_type):
        transaction.on_commit(
            partial(dispatch_task_event, unit_ids, event_type, "task", instance.id, payload)
        )

    if created:
        enqueue(TASK_CREATED)
        return

    became_deleted = instance.deleted_at is not None and instance._previous_deleted_at is None
    if became_deleted:
        enqueue(TASK_DELETED)
        return

    if instance.status_id != instance._previous_status_id:
        enqueue(TASK_STATUS_CHANGED)

    enqueue(TASK_UPDATED)


# Dispara el evento comment.created cuando se agrega un comentario a una tarea.
@receiver(post_save, sender=Comment)
def dispatch_comment_created_event(sender, instance, created, **kwargs):
    if not created:
        return

    payload = CommentSerializer(instance).data
    transaction.on_commit(
        partial(
            dispatch_task_event,
            instance.task.unit_id,
            COMMENT_CREATED,
            "comment",
            instance.id,
            payload,
        )
    )


@receiver(post_save, sender=TaskProject)
def dispatch_board_move(sender, instance, created, **kwargs):
    # Initial links are already covered by task.created in the same transaction.
    if created:
        return
    task = instance.task
    transaction.on_commit(
        partial(dispatch_task_event, task.unit_id, TASK_UPDATED, "task", task.id,
                TaskSerializer(task).data)
    )


TASK_RELATION_EVENTS = {
    Comment: "comment.changed", Attachment: "attachment.changed",
    TaskFollower: "follower.changed", TaskTag: "task_tag.changed", TaskProject: "task_link.changed",
}
PROJECT_RELATIONS = (Section, ProjectMember)


def capture_previous_resource_scope(sender, instance, raw=False, **kwargs):
    if raw or not instance.pk:
        return
    manager = getattr(sender, "all_objects", sender.objects)
    fields = ("unit_id",) if sender in (Project, Tag, TaskStatus) else ("project_id",) if sender in PROJECT_RELATIONS else ("task_id",)
    instance._previous_resource_scope = manager.filter(pk=instance.pk).values(*fields).first() or {}


def dispatch_resource_changed(sender, instance, created=False, raw=False, **kwargs):
    if raw or (sender is Comment and created):
        return  # comment.created already carries this invalidation
    previous = getattr(instance, "_previous_resource_scope", {})
    if sender in TASK_RELATION_EVENTS:
        task_ids = list(dict.fromkeys(value for value in (instance.task_id, previous.get("task_id")) if value))
        units = list(Task.all_objects.filter(pk__in=task_ids).values_list("unit_id", flat=True))
        event_type, entity_type = TASK_RELATION_EVENTS[sender], "task_relation"
        payload = {"tasks": [str(value) for value in task_ids]}
    elif sender is Project or sender in PROJECT_RELATIONS:
        project_ids = [instance.pk] if sender is Project else list(dict.fromkeys(value for value in (instance.project_id, previous.get("project_id")) if value))
        units = [instance.unit_id, previous.get("unit_id")] if sender is Project else list(Project.all_objects.filter(pk__in=project_ids).values_list("unit_id", flat=True))
        event_type, entity_type, payload = "project.changed", "project", {}
    else:
        units = [instance.unit_id, previous.get("unit_id")]
        event_type, entity_type, payload = "catalog.changed", "catalog", {"units": [str(value) for value in units if value]}
    transaction.on_commit(partial(dispatch_resource_invalidation, units, event_type, entity_type, instance.pk, payload))


for model in (*TASK_RELATION_EVENTS, Project, *PROJECT_RELATIONS, Tag, TaskStatus):
    pre_save.connect(capture_previous_resource_scope, sender=model, dispatch_uid=f"tasks_previous_scope_{model.__name__}")
    post_save.connect(dispatch_resource_changed, sender=model, dispatch_uid=f"tasks_resource_saved_{model.__name__}")
    post_delete.connect(dispatch_resource_changed, sender=model, dispatch_uid=f"tasks_resource_deleted_{model.__name__}")
