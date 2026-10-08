from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0012_sharedworkspacefolder")]
    operations = [migrations.CreateModel(name="PersonalTaskBoard", fields=[
        ("assignment", models.OneToOneField(primary_key=True, serialize=False, on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.positionassignment")),
        ("sections", models.JSONField(default=list)),
        ("task_sections", models.JSONField(default=dict)),
    ])]
