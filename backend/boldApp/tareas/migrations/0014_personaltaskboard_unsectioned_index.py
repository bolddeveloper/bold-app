from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0013_personaltaskboard")]
    operations = [migrations.AddField(
        model_name="personaltaskboard",
        name="unsectioned_index",
        field=models.PositiveIntegerField(null=True, blank=True, default=None),
    )]
