import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_tareas", "0007_provision_default_task_statuses"),
    ]

    operations = [
        migrations.AlterField(
            model_name="taskstatus",
            name="unit",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="task_statuses",
                to="boldApp_core.organizationalunit",
            ),
        ),
    ]
