from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0003_project_avatar_data_url")]
    operations = [
        migrations.AddField(
            model_name="project",
            name="priority",
            field=models.CharField(choices=[("Alta", "Alta"), ("Media", "Media"), ("Baja", "Baja")], default="Media", max_length=10),
        ),
    ]
