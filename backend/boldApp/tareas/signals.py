from functools import partial

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import Comment, Task
from .webhook_events import (
    COMMENT_CREATED,
    TASK_CREATED,
    TASK_DELETED,
    TASK_STATUS_CHANGED,
    TASK_UPDATED,
    dispatch_task_event,
)
from .serializers import CommentSerializer, TaskSerializer


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
