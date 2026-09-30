from django.db import migrations, models


SAFE_BULK_CODES = {
    "tasks.task.read",
    "tasks.task.create",
    "tasks.task.update",
    "tasks.comment.create",
    "tasks.project.read",
    "tasks.catalog.read",
}


def mark_safe_permissions(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    Permission.objects.filter(code__in=SAFE_BULK_CODES).update(is_bulk_assignable=True)
    Permission.objects.filter(code="tasks.webhook.manage").update(is_bulk_assignable=False)


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0008_organizationalunit_is_control_plane_and_more")]

    operations = [
        migrations.AddField(
            model_name="permission",
            name="is_bulk_assignable",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_safe_permissions, migrations.RunPython.noop),
    ]
