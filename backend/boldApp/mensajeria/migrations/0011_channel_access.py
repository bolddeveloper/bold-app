import django.db.models.deletion
from django.db import migrations, models


def register(apps, schema_editor):
    apps.get_model("boldApp_core", "Permission").objects.get_or_create(code="slack.channel.access", defaults={
        "module_code": "slack", "resource": "channel", "action": "access",
        "description": "Administrar privacidad e invitaciones de canales, sin lectura implícita",
        "risk_level": "medium", "is_delegable": True, "is_bulk_assignable": False,
        "is_active": True, "system_managed": True,
    })


class Migration(migrations.Migration):
    dependencies = [("boldApp_mensajeria", "0010_independent_channels")]
    operations = [
        migrations.AddField(model_name="departmentchannel", name="visibility", field=models.CharField(
            choices=[("public", "Todos los empleados"), ("department", "Departamento e invitados"), ("private", "Solo personas invitadas")], default="public", max_length=12)),
        migrations.CreateModel(name="ChannelAccessRule", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("access", models.CharField(choices=[("read", "Solo lectura"), ("write", "Leer y participar"), ("blocked", "Sin acceso")], max_length=8)),
            ("channel", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="access_rules", to="boldApp_mensajeria.departmentchannel")),
            ("employee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="boldApp_core.employee")),
        ], options={"db_table": "messaging_channel_access", "constraints": [models.UniqueConstraint(fields=("channel", "employee"), name="unique_channel_access_employee")]}),
        migrations.AddConstraint(model_name="departmentchannel", constraint=models.CheckConstraint(
            condition=~models.Q(visibility="department") | models.Q(unit__isnull=False), name="department_channel_has_unit")),
        migrations.RunPython(register, migrations.RunPython.noop),
    ]
