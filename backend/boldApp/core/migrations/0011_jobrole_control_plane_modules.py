from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0010_add_dynamic_role_permission_scopes")]
    operations = [
        migrations.AddField(model_name="jobrole", name="administration_enabled", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="jobrole", name="permissions_enabled", field=models.BooleanField(default=False)),
    ]
