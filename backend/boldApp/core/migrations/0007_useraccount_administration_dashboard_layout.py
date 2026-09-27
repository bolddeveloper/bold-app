from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0006_reconcile_security_history")]

    operations = [
        migrations.AddField(
            model_name="useraccount",
            name="administration_dashboard_layout",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
