from django.db import migrations


DEFAULT_TASK_STATUSES = (
    {"category": "todo", "name": "Pend.", "position": 1, "is_final": False},
    {"category": "in_progress", "name": "Activa", "position": 2, "is_final": False},
    {"category": "completed", "name": "Lista", "position": 3, "is_final": True},
)


def provision_default_task_statuses(apps, schema_editor):
    OrganizationalUnit = apps.get_model("boldApp_core", "OrganizationalUnit")
    TaskStatus = apps.get_model("boldApp_tareas", "TaskStatus")
    for unit in OrganizationalUnit.objects.all().iterator():
        for status in DEFAULT_TASK_STATUSES:
            TaskStatus.objects.get_or_create(
                unit=unit,
                category=status["category"],
                defaults={
                    "name": status["name"],
                    "position": status["position"],
                    "is_final": status["is_final"],
                },
            )


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_tareas", "0006_remove_cross_unit_project_members"),
    ]

    operations = [
        migrations.RunPython(
            provision_default_task_statuses,
            migrations.RunPython.noop,
        ),
    ]
