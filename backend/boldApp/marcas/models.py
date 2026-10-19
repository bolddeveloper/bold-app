from django.conf import settings
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class Brand(UUIDPrimaryKeyModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="brands")
    unit = models.ForeignKey("boldApp_core.OrganizationalUnit", on_delete=models.PROTECT)
    members = models.ManyToManyField("boldApp_core.PositionAssignment", blank=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    logo = models.TextField(null=True, blank=True)
    details = models.JSONField(default=dict)
    project_ids = models.JSONField(default=list)
    task_ids = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "pk"]
