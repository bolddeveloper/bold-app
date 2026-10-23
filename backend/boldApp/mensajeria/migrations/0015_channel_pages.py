import django.db.models.deletion
import uuid
from django.db import migrations, models


def register(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    for action, description in {
        "read": "Leer páginas e historial de los canales accesibles",
        "create": "Crear páginas dentro de canales accesibles",
        "update": "Editar páginas y recuperar versiones sin sobrescritura silenciosa",
        "manage": "Archivar y restaurar páginas de los canales accesibles",
    }.items():
        Permission.objects.get_or_create(code=f"slack.page.{action}", defaults={
            "module_code": "slack", "resource": "page", "action": action, "description": description,
            "risk_level": "low", "is_delegable": True, "is_bulk_assignable": True,
            "is_active": True, "system_managed": True,
        })


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0017_account_connector_delegation"),
                    ("boldApp_mensajeria", "0014_phonetransfer_phoneimage")]
    operations = [
        migrations.AddField(model_name="channelmessage", name="page_id", field=models.UUIDField(blank=True, null=True)),
        migrations.CreateModel(name="ChannelPage", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("client_id", models.UUIDField()), ("creation_digest", models.CharField(max_length=64)),
            ("title", models.CharField(max_length=160)), ("icon", models.CharField(default="note", max_length=16)),
            ("blocks", models.JSONField(default=list)), ("version", models.PositiveIntegerField(default=1)),
            ("archived_at", models.DateTimeField(null=True)), ("created_at", models.DateTimeField(auto_now_add=True)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("channel", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="pages", to="boldApp_mensajeria.departmentchannel")),
            ("creator", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="channel_pages", to="boldApp_core.employee")),
            ("updated_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="updated_channel_pages", to="boldApp_core.employee")),
        ], options={"db_table": "messaging_channel_pages"}),
        migrations.CreateModel(name="PageRevision", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("version", models.PositiveIntegerField()), ("client_id", models.UUIDField()),
            ("payload_digest", models.CharField(max_length=64)), ("title", models.CharField(max_length=160)),
            ("icon", models.CharField(max_length=16)), ("blocks", models.JSONField(default=list)),
            ("archived", models.BooleanField(default=False)), ("created_at", models.DateTimeField(auto_now_add=True)),
            ("actor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="boldApp_core.employee")),
            ("page", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="revisions", to="boldApp_mensajeria.channelpage")),
        ], options={"db_table": "messaging_page_revisions"}),
        migrations.AddIndex(model_name="channelpage", index=models.Index(fields=["channel", "-created_at", "-id"], name="slack_page_list")),
        migrations.AddConstraint(model_name="channelpage", constraint=models.UniqueConstraint(fields=("channel", "creator", "client_id"), name="slack_page_create_retry")),
        migrations.AddConstraint(model_name="pagerevision", constraint=models.UniqueConstraint(fields=("page", "version"), name="slack_page_revision")),
        migrations.AddConstraint(model_name="pagerevision", constraint=models.UniqueConstraint(fields=("page", "actor", "client_id"), name="slack_page_save_retry")),
        migrations.RunPython(register, migrations.RunPython.noop),
    ]
