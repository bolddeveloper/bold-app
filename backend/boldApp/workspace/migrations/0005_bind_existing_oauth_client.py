from django.conf import settings
from django.db import migrations


def bind_existing_client(apps, schema_editor):
    # Existing personal tokens belonged to this server client, never Calendar's shared account.
    client = getattr(settings, "GOOGLE_WORKSPACE_CLIENT_ID", "")
    if client:
        apps.get_model("boldApp_workspace", "GoogleConnection").objects.filter(client_id="").update(client_id=client)


class Migration(migrations.Migration):
    dependencies = [("boldApp_workspace", "0004_googleoauthconfiguration_googleconnection_client_id_and_more")]
    operations = [migrations.RunPython(bind_existing_client, migrations.RunPython.noop)]
