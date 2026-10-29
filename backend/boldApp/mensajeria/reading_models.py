"""Personal reading reminders, deliberately separate from truthful receipts."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class ReadingReminderClock(models.Model):
    employee = models.OneToOneField("boldApp_core.Employee", primary_key=True, on_delete=models.CASCADE)
    version = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = "messaging_reading_reminder_clocks"


class ReadingReminder(UUIDPrimaryKeyModel):
    employee = models.ForeignKey("boldApp_core.Employee", on_delete=models.CASCADE)
    # Derived on the server: chat:<conversation>, channel:<channel>, thread:<root>.
    scope_key = models.CharField(max_length=44)
    document = models.ForeignKey("boldApp_mensajeria.SearchDocument", null=True, on_delete=models.SET_NULL,
        related_name="reading_reminders")
    version = models.PositiveBigIntegerField(default=0)
    last_client_id = models.UUIDField(null=True)
    last_digest = models.CharField(max_length=64, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "messaging_reading_reminders"
        constraints = [models.UniqueConstraint(fields=["employee", "scope_key"], name="unique_personal_reading_scope")]
