from functools import partial

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from boldApp.tareas.models import Comment, Task, TaskFollower
from .task_bridge import bridging, refresh_from_task


@receiver(post_save, sender=Task)
@receiver(post_save, sender=Comment)
@receiver(post_delete, sender=Comment)
@receiver(post_save, sender=TaskFollower)
@receiver(post_delete, sender=TaskFollower)
def task_changed(sender, instance, raw=False, **kwargs):
    if not raw and not bridging.get():
        transaction.on_commit(partial(refresh_from_task, instance.pk if sender is Task else instance.task_id))
