from django.db import migrations, models


def exempt_existing_accounts(apps, schema_editor):
    apps.get_model("boldApp_core", "UserAccount").objects.using(schema_editor.connection.alias).update(
        interface_settings={"onboarding_completed": True})


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0017_account_connector_delegation")]
    operations = [
        migrations.AddField(model_name="useraccount", name="interface_settings", field=models.JSONField(default=dict, blank=True)),
        migrations.RunPython(exempt_existing_accounts, migrations.RunPython.noop),
    ]
