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


# Guarda el estado previo de status/deleted_at de la tarea antes de guardarla,
# para poder comparar en post_save y decidir que evento(s) disparar.
@receiver(pre_save, sender=Task)
def capture_previous_task_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status_id = None
        instance._previous_deleted_at = None
        return

    previous = Task.all_objects.filter(pk=instance.pk).values("status_id", "deleted_at").first()
    instance._previous_status_id = previous["status_id"] if previous else None
    instance._previous_deleted_at = previous["deleted_at"] if previous else None


# Dispara el evento de webhook correspondiente segun lo que cambio en la tarea.
@receiver(post_save, sender=Task)
def dispatch_task_events(sender, instance, created, **kwargs):
    payload = TaskSerializer(instance).data

    if created:
        dispatch_task_event(instance.workspace_id, TASK_CREATED, "task", instance.id, payload)
        return

    became_deleted = instance.deleted_at is not None and instance._previous_deleted_at is None
    if became_deleted:
        dispatch_task_event(instance.workspace_id, TASK_DELETED, "task", instance.id, payload)
        return

    if instance.status_id != instance._previous_status_id:
        dispatch_task_event(instance.workspace_id, TASK_STATUS_CHANGED, "task", instance.id, payload)

    dispatch_task_event(instance.workspace_id, TASK_UPDATED, "task", instance.id, payload)


# Dispara el evento comment.created cuando se agrega un comentario a una tarea.
@receiver(post_save, sender=Comment)
def dispatch_comment_created_event(sender, instance, created, **kwargs):
    if not created:
        return

    payload = CommentSerializer(instance).data
    dispatch_task_event(instance.task.workspace_id, COMMENT_CREATED, "comment", instance.id, payload)
