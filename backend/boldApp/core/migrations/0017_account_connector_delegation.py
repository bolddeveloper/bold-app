from django.db import migrations, models


def authorize_existing_support(apps, schema_editor):
    """One-time provisioning requested for the existing corporate support account.

    Runtime access is tied to this account's flag, not to its email. Future
    accounts and other administrators receive no automatic privilege.
    """
    Account = apps.get_model("boldApp_core", "UserAccount")
    Audit = apps.get_model("boldApp_administrativo", "SystemAuditEvent")
    database = schema_editor.connection.alias
    eligible = Account.objects.using(database).filter(
        email__iexact="soporte@bold.gt", is_active=True, employee__is_active=True,
        employee__position_assignments__is_active=True,
        employee__position_assignments__released_at__isnull=True,
        employee__position_assignments__position__unit__is_control_plane=True,
        employee__position_assignments__position__job_role__administration_enabled=True,
        can_manage_connectors=False,
    ).distinct()
    for account in eligible:
        Account.objects.using(database).filter(pk=account.pk).update(can_manage_connectors=True)
        Audit.objects.using(database).create(
            module_code="administration", event_type="google.connector_access_provisioned",
            target_type="user_account", target_id=account.pk,
            changes={"can_manage_connectors": {"before": False, "after": True}},
            metadata={"source": "deployment", "reason": "Individual support delegation explicitly requested by the operator"},
        )


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_core", "0016_user_presence_settings"),
        ("boldApp_administrativo", "0003_role_level_catalog"),
    ]
    operations = [
        migrations.AddField(model_name="useraccount", name="can_manage_connectors", field=models.BooleanField(default=False)),
        migrations.RunPython(authorize_existing_support, migrations.RunPython.noop),
    ]
