"""A receipt and a reference, not another task store or a copy of private media."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class MessageTaskConversion(UUIDPrimaryKeyModel):
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", on_delete=models.SET_NULL, null=True, related_name="task_conversions")
    task = models.ForeignKey("boldApp_tareas.Task", on_delete=models.SET_NULL, null=True, related_name="message_conversions")
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.PROTECT)
    assignment = models.ForeignKey("boldApp_core.PositionAssignment", on_delete=models.PROTECT)
    client_id = models.UUIDField()
    digest = models.CharField(max_length=64)
    source_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "messaging_message_task_conversions"
        constraints = [models.UniqueConstraint(fields=["employee", "client_id"], name="unique_message_task_retry")]
        indexes = [models.Index(fields=["document", "-created_at", "-id"], name="message_task_link_history")]
