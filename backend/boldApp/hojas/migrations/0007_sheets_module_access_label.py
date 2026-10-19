from django.db import migrations


def forward(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    Permission.objects.filter(code="sheets.file.read", description="Consultar archivos de Sheets").update(description="Ver el módulo Sheets y consultar archivos accesibles")


def backward(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    Permission.objects.filter(code="sheets.file.read", description="Ver el módulo Sheets y consultar archivos accesibles").update(description="Consultar archivos de Sheets")


class Migration(migrations.Migration):
    dependencies = [("boldApp_hojas", "0006_sheets_display_name")]
    operations = [migrations.RunPython(forward, backward)]
