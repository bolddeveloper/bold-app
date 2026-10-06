from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0013_user_notification_settings")]
    operations = [migrations.AddField(model_name="useraccount", name="shortcut_settings", field=models.JSONField(blank=True, default=dict))]
