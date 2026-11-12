from django.db import models
from .mixins import UUIDPrimaryKeyModel


class SavedReport(UUIDPrimaryKeyModel):
    owner = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT, related_name='saved_reports')
    name = models.CharField(max_length=120)
    definition = models.JSONField(default=dict)
    shared_with = models.ManyToManyField('boldApp_core.PositionAssignment', related_name='shared_reports')
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at','id']


class MeetingWorkLink(UUIDPrimaryKeyModel):
    """Only explicit links; a relationship is never calendar read permission."""
    event = models.ForeignKey('calendario.AppCalendarEvent', on_delete=models.CASCADE, related_name='work_links')
    task = models.ForeignKey('Task', null=True, blank=True, on_delete=models.CASCADE, related_name='meeting_links')
    project = models.ForeignKey('Project', null=True, blank=True, on_delete=models.CASCADE, related_name='meeting_links')
    created_by = models.ForeignKey('boldApp_core.PositionAssignment', on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=(models.Q(task__isnull=False,project__isnull=True)|models.Q(task__isnull=True,project__isnull=False)),name='meeting_work_one_target'),
            models.UniqueConstraint(fields=['event','task'],condition=models.Q(task__isnull=False),name='meeting_work_unique_task'),
            models.UniqueConstraint(fields=['event','project'],condition=models.Q(project__isnull=False),name='meeting_work_unique_project'),
        ]
