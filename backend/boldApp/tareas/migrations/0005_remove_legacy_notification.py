from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_notificaciones", "0001_initial"),
        ("boldApp_tareas", "0004_project_priority"),
    ]
    operations = [migrations.DeleteModel(name="Notification")]
