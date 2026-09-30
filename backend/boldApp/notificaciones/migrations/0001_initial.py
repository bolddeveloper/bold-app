import django.db.models.deletion
import uuid

from django.db import migrations, models


def copy_legacy_notifications(apps, schema_editor):
    LegacyNotification = apps.get_model("boldApp_tareas", "Notification")
    Notification = apps.get_model("boldApp_notificaciones", "Notification")
    for row in LegacyNotification.objects.all().iterator():
        notification, created = Notification.objects.get_or_create(
            id=row.id,
            defaults={
                "recipient_assignment_id": row.recipient_assignment_id,
                "task_id": row.task_id,
                "type": row.type,
                "module": "tasks",
                "resource_type": "task" if row.task_id else "",
                "resource_id": row.task_id,
                "title": row.title,
                "body": row.body,
                "route": {"module": "tasks", "target": "tasks", **({"task_id": str(row.task_id)} if row.task_id else {})},
                "is_read": row.is_read,
                "read_at": row.read_at,
            },
        )
        if created:
            # auto_now_add intentionally ignores supplied values on insert; restore
            # the original timestamp so migrating does not make old alerts look new.
            Notification.objects.filter(id=notification.id).update(created_at=row.created_at)


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ("boldApp_core", "0008_organizationalunit_is_control_plane_and_more"),
        ("boldApp_tareas", "0004_project_priority"),
    ]
    operations = [
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("type", models.CharField(max_length=64)),
                ("module", models.CharField(default="tasks", max_length=40)),
                ("resource_type", models.CharField(blank=True, default="", max_length=40)),
                ("resource_id", models.UUIDField(blank=True, null=True)),
                ("title", models.CharField(max_length=180)),
                ("body", models.TextField(blank=True, null=True)),
                ("route", models.JSONField(blank=True, default=dict)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("dedupe_key", models.CharField(blank=True, max_length=255, null=True)),
                ("is_read", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("actor_assignment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="notifications_authored", to="boldApp_core.positionassignment")),
                ("project", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="app_notifications", to="boldApp_tareas.project")),
                ("recipient_assignment", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="notifications", to="boldApp_core.positionassignment")),
                ("task", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="app_notifications", to="boldApp_tareas.task")),
            ],
            options={"db_table": "application_notifications", "ordering": ["-created_at"]},
        ),
        migrations.AddIndex(model_name="notification", index=models.Index(fields=["recipient_assignment", "is_read", "created_at"], name="idx_notif_recipient_read")),
        migrations.AddConstraint(model_name="notification", constraint=models.UniqueConstraint(condition=models.Q(("dedupe_key__isnull", False)), fields=("recipient_assignment", "dedupe_key"), name="unique_notification_recipient_event")),
        migrations.RunPython(copy_legacy_notifications, migrations.RunPython.noop),
    ]
