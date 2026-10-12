import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def preserve_shares(apps, schema_editor):
    Library = apps.get_model("boldApp_tareas", "WorkspaceLibrary")
    Share = apps.get_model("boldApp_tareas", "SharedWorkspaceFolder")
    database = schema_editor.connection.alias
    for share in Share.objects.using(database).order_by("updated_at"):
        library, _ = Library.objects.using(database).get_or_create(owner_id=share.owner_id, unit_id=share.unit_id)
        rows = {row["id"]: row for row in library.folders}
        rows.update({row["id"]: row for row in share.folders})
        library.folders = list(rows.values()); library.save(using=database, update_fields=["folders"])
    for library in Library.objects.using(database).all():
        ids = {row["id"] for row in library.folders}
        for row in library.folders:
            if row.get("parentId") not in ids:
                row["parentId"] = None
        library.save(using=database, update_fields=["folders"])


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0014_personaltaskboard_unsectioned_index"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name="sharedworkspacefolder", name="revision", field=models.PositiveIntegerField(default=1)),
        migrations.CreateModel(name="WorkspaceLibrary", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("folders", models.JSONField(default=list)),
            ("revision", models.PositiveIntegerField(default=0)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ("unit", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.organizationalunit")),
        ], options={"constraints": [models.UniqueConstraint(fields=("owner", "unit"), name="unique_workspace_library_owner_unit")]}),
        migrations.RunPython(preserve_shares, migrations.RunPython.noop),
    ]
