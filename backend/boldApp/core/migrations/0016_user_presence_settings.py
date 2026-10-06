from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0015_merge_20261006_0823")]
    operations = [migrations.AddField(model_name="useraccount", name="presence_settings", field=models.JSONField(default=dict, blank=True))]
