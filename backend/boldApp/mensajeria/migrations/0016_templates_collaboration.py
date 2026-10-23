import django.db.models.deletion
import uuid
from django.db import migrations, models


def register(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    for action, description in {"read": "Leer plantillas de los canales accesibles", "create": "Guardar páginas como plantillas del canal",
                                "update": "Actualizar plantillas del canal", "manage": "Archivar y restaurar plantillas del canal"}.items():
        Permission.objects.get_or_create(code=f"slack.template.{action}", defaults={"module_code": "slack", "resource": "template", "action": action,
            "description": description, "risk_level": "low", "is_delegable": True, "is_bulk_assignable": True, "is_active": True, "system_managed": True})


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0017_account_connector_delegation"), ("boldApp_mensajeria", "0015_channel_pages")]
    operations = [
        migrations.CreateModel(name="PageCollaboration", fields=[
            ("page", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="collaboration", serialize=False, to="boldApp_mensajeria.channelpage")),
            ("epoch", models.UUIDField(default=uuid.uuid4)), ("state", models.BinaryField()), ("updated_at", models.DateTimeField(auto_now=True)),
        ], options={"db_table": "messaging_page_collaboration"}),
        migrations.CreateModel(name="PageTemplate", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ("client_id", models.UUIDField()),
            ("creation_digest", models.CharField(max_length=64)), ("name", models.CharField(max_length=160)),
            ("description", models.CharField(blank=True, max_length=500)), ("title", models.CharField(max_length=160)),
            ("icon", models.CharField(default="note", max_length=16)), ("blocks", models.JSONField(default=list)),
            ("version", models.PositiveIntegerField(default=1)), ("archived_at", models.DateTimeField(null=True)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("channel", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="page_templates", to="boldApp_mensajeria.departmentchannel")),
            ("creator", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="page_templates", to="boldApp_core.employee")),
        ], options={"db_table": "messaging_page_templates", "indexes": [models.Index(fields=["channel", "-created_at", "-id"], name="slack_template_list")],
                    "constraints": [models.UniqueConstraint(fields=("channel", "creator", "client_id"), name="slack_template_create_retry")]}),
        migrations.CreateModel(name="PageUpdateReceipt", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)), ("epoch", models.UUIDField()),
            ("client_id", models.UUIDField()), ("digest", models.CharField(max_length=64)), ("version", models.PositiveIntegerField()),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("actor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="boldApp_core.employee")),
            ("page", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collaboration_receipts", to="boldApp_mensajeria.channelpage")),
        ], options={"db_table": "messaging_page_update_receipts", "constraints": [models.UniqueConstraint(fields=("page", "epoch", "actor", "client_id"), name="slack_page_update_receipt")]}),
        migrations.RunPython(register, migrations.RunPython.noop),
    ]
