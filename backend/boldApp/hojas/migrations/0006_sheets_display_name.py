from django.db import migrations


def rename(apps, old, new):
    Permission = apps.get_model("boldApp_core", "Permission")
    for permission in Permission.objects.filter(module_code="sheets", code__startswith="sheets.file.", description__contains=old):
        permission.description = permission.description.replace(old, new)
        permission.save(update_fields=["description"])


def forward(apps, schema_editor):
    rename(apps, "Hojas", "Sheets")


def backward(apps, schema_editor):
    rename(apps, "Sheets", "Hojas")


class Migration(migrations.Migration):
    dependencies = [("boldApp_hojas", "0005_local_office")]
    operations = [migrations.RunPython(forward, backward)]
