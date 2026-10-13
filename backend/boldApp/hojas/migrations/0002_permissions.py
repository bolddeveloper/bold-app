from django.db import migrations


def register(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    labels = {"read": "Consultar archivos de Hojas", "create": "Crear archivos y carpetas de Hojas", "edit": "Editar archivos de Hojas", "assign": "Conectar filas con tareas y asignar responsables", "share": "Compartir archivos de Hojas", "export": "Descargar y sincronizar Excel de Hojas", "delete": "Enviar archivos de Hojas a la papelera"}
    for action, description in labels.items():
        Permission.objects.update_or_create(code="sheets.file." + action, defaults={"module_code": "sheets", "resource": "file", "action": action, "description": description, "risk_level": "high" if action in {"assign", "share", "delete"} else "medium", "is_delegable": True, "is_bulk_assignable": action in {"read", "create", "edit", "export"}, "is_active": True, "system_managed": True})


class Migration(migrations.Migration):
    dependencies = [("boldApp_hojas", "0001_initial")]
    operations = [migrations.RunPython(register, migrations.RunPython.noop)]
