import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0011_comment_image_project_id_comment_image_section_and_more"), ("boldApp_core", "0017_account_connector_delegation")]
    operations = [migrations.CreateModel(name="SharedWorkspaceFolder", fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("folder_id", models.UUIDField()), ("folders", models.JSONField(default=list)),
        ("updated_at", models.DateTimeField(auto_now=True)),
        ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="shared_workspace_folders", to=settings.AUTH_USER_MODEL)),
        ("unit", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.organizationalunit")),
        ("members", models.ManyToManyField(blank=True, to="boldApp_core.positionassignment")),
    ], options={"constraints": [models.UniqueConstraint(fields=("owner", "unit", "folder_id"), name="unique_shared_workspace_owner_folder")]})]
