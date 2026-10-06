from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_tareas", "0008_taskstatus_unit_cascade")]
    operations = [migrations.AddField(model_name="project", name="unsectioned_index", field=models.PositiveIntegerField(null=True, blank=True, default=None))]
