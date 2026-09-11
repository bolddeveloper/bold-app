from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0002_project_end_date_project_start_date")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="avatar_data_url",
            field=models.TextField(blank=True, null=True),
        ),
    ]
