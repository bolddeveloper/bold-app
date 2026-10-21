from django.db import migrations


def register(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    for code, description in {
        "slack.channel.read": "Leer canales e hilos de Slack",
        "slack.channel.create": "Crear canales de Slack en un departamento",
        "slack.channel.manage": "Renombrar, describir, archivar y restaurar canales de Slack",
        "slack.message.create": "Enviar mensajes y respuestas en Slack",
        "slack.message.update": "Editar mensajes propios de Slack durante diez minutos",
    }.items():
        _, resource, action = code.split(".")
        Permission.objects.get_or_create(code=code, defaults={
            "module_code": "slack", "resource": resource, "action": action,
            "description": description, "risk_level": "low", "is_delegable": True,
            "is_bulk_assignable": True, "is_active": True, "system_managed": True,
        })


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0005_department_channels")]
    # Preserve configured policy/history on rollback. No role grants are created.
    operations = [migrations.RunPython(register, migrations.RunPython.noop)]
