from django.db import migrations


class Migration(migrations.Migration):
    """Une Permisos con el Core endurecido sin reescribir el historial de 0001."""

    dependencies = [
        ("boldApp_permisos", "0001_initial"),
        ("boldApp_core", "0006_reconcile_security_history"),
    ]

    operations = []
