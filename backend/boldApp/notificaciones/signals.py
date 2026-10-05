from functools import partial
from uuid import uuid4

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from boldApp.tareas.models import Comment, Project, ProjectMember, Task, TaskFollower

from .services import (
    notify_comment_created,
    notify_project_created,
    notify_project_member_added,
    notify_project_updated,
    notify_task_created,
    notify_task_updated,
    notify_task_follower_added,
)


@receiver(pre_save, sender=Task)
def capture_task_notification_state(sender, instance, **kwargs):
    previous = Task.all_objects.filter(pk=instance.pk).values(
        "assignee_assignment_id", "status_id", "due_date", "priority", "title"
    ).first() if instance.pk else None
    instance._notification_previous = {
        "assignee": previous["assignee_assignment_id"],
        "status": previous["status_id"],
        "due_date": previous["due_date"],
        "priority": previous["priority"],
        "title": previous["title"],
    } if previous else None


@receiver(post_save, sender=Task)
def create_task_notifications(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(partial(notify_task_created, instance.id))
    elif instance._notification_previous:
        transaction.on_commit(partial(
            notify_task_updated,
            instance.id,
            instance._notification_previous,
            getattr(instance, "_notification_actor_assignment_id", None),
        ))


@receiver(post_save, sender=Comment)
def create_comment_notifications(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(partial(notify_comment_created, instance.id))


@receiver(pre_save, sender=Project)
def capture_project_notification_state(sender, instance, **kwargs):
    previous = Project.all_objects.filter(pk=instance.pk).values(
        "status", "end_date", "priority", "name", "owner_assignment_id"
    ).first() if instance.pk else None
    instance._notification_previous = previous


@receiver(post_save, sender=Project)
def create_project_notifications(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(partial(notify_project_created, instance.id))
    elif instance._notification_previous:
        transaction.on_commit(partial(
            notify_project_updated,
            instance.id,
            instance._notification_previous,
            getattr(instance, "_notification_actor_assignment_id", None),
        ))


@receiver(pre_save, sender=ProjectMember)
@receiver(pre_save, sender=TaskFollower)
def capture_participant_notification_state(sender, instance, **kwargs):
    fields = ["assignment_id", "project_id", "status", "removed_at"] if sender is ProjectMember else ["assignment_id", "task_id", "notification_level"]
    instance._notification_previous_participant = sender.objects.filter(pk=instance.pk).values(*fields).first() if instance.pk else None


@receiver(post_save, sender=ProjectMember)
def create_project_member_notification(sender, instance, created, **kwargs):
    previous = getattr(instance, "_notification_previous_participant", None)
    active = instance.status == "active" and not instance.removed_at
    was_active = previous and previous["status"] == "active" and not previous["removed_at"]
    changed = previous and (previous["assignment_id"] != instance.assignment_id or previous["project_id"] != instance.project_id)
    if active and (created or not was_active or changed) and not getattr(instance, "_notification_skip", False):
        transaction.on_commit(partial(notify_project_member_added, instance.id,
            getattr(instance, "_notification_actor_assignment_id", instance.added_by_assignment_id), str(uuid4())))


@receiver(post_save, sender=TaskFollower)
def create_task_follower_notification(sender, instance, created, **kwargs):
    previous = getattr(instance, "_notification_previous_participant", None)
    changed = previous and (previous["assignment_id"] != instance.assignment_id or previous["task_id"] != instance.task_id)
    if instance.notification_level != "none" and (created or changed or (previous and previous["notification_level"] == "none")):
        transaction.on_commit(partial(notify_task_follower_added, instance.id,
            getattr(instance, "_notification_actor_assignment_id", instance.added_by_assignment_id), str(uuid4())))
