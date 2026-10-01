from django.db import migrations


def remove_cross_unit_project_members(apps, schema_editor):
    ProjectMember = apps.get_model("boldApp_tareas", "ProjectMember")
    invalid_ids = [
        member.id
        for member in ProjectMember.objects.select_related(
            "project",
            "assignment__position",
        ).iterator()
        if member.project.unit_id != member.assignment.position.unit_id
    ]
    if invalid_ids:
        ProjectMember.objects.filter(id__in=invalid_ids).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_tareas", "0005_remove_legacy_notification"),
    ]

    operations = [
        migrations.RunPython(
            remove_cross_unit_project_members,
            migrations.RunPython.noop,
        ),
    ]
