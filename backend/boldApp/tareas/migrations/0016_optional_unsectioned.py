from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0015_workspace_library")]
    operations = [
        migrations.AddField(model_name="project", name="unsectioned_hidden", field=models.BooleanField(default=False, db_default=False)),
        migrations.AddField(model_name="personaltaskboard", name="unsectioned_hidden", field=models.BooleanField(default=False, db_default=False)),
    ]
