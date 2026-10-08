from django.conf import settings
from django.db import models
from .mixins import UUIDPrimaryKeyModel


class SharedWorkspaceFolder(UUIDPrimaryKeyModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shared_workspace_folders")
    unit = models.ForeignKey("boldApp_core.OrganizationalUnit", on_delete=models.CASCADE)
    folder_id = models.UUIDField()
    folders = models.JSONField(default=list)
    members = models.ManyToManyField("boldApp_core.PositionAssignment", blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "unit", "folder_id"], name="unique_shared_workspace_owner_folder")]


class PersonalTaskBoard(models.Model):
    assignment = models.OneToOneField("boldApp_core.PositionAssignment", primary_key=True, on_delete=models.CASCADE)
    sections = models.JSONField(default=list)
    task_sections = models.JSONField(default=dict)
