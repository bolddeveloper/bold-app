from django.db import migrations


RESERVED_CONTROL_PLANE_CODES = {
    "permissions.module.access",
    "permissions.policy.read",
    "permissions.policy.manage",
    "permissions.audit.read",
    "permissions.authority.manage",
    "permissions.simulate",
}


def reconcile_security_history(apps, schema_editor):
    """Corrige exclusivamente filas heredadas sin reabrir el hardening 0003."""

    GrantAuthority = apps.get_model("boldApp_core", "GrantAuthority")
    Permission = apps.get_model("boldApp_core", "Permission")
    PermissionAuditLog = apps.get_model("boldApp_core", "PermissionAuditLog")

    # El AddField de 0003 evaluó uuid.uuid4 una vez durante el backfill. Los
    # eventos reconocidos como legacy reciben un identificador estable y único.
    for audit in PermissionAuditLog.objects.filter(reason_code="legacy_decision").only(
        "id", "correlation_id"
    ).iterator():
        if audit.correlation_id != audit.id:
            PermissionAuditLog.objects.filter(pk=audit.pk).update(correlation_id=audit.id)

    # 0003 incorporó valid_from con la hora de migración. Solo las autoridades
    # marcadas por aquel backfill y cuya creación es anterior recuperan su fecha.
    for authority in GrantAuthority.objects.filter(reason="Autoridad migrada").only(
        "id", "created_at", "valid_from"
    ).iterator():
        if authority.created_at and authority.valid_from > authority.created_at:
            GrantAuthority.objects.filter(pk=authority.pk).update(valid_from=authority.created_at)

    # Estas capacidades describen un plano de control futuro, pero la versión
    # actual se protege mediante dueño + GrantAuthority. Mantenerlas activas en
    # el selector permitiría guardar políticas que no cambian comportamiento.
    Permission.objects.filter(code__in=RESERVED_CONTROL_PLANE_CODES).update(
        is_active=False,
        is_delegable=False,
    )


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_core", "0005_enforce_authority_expiry"),
    ]

    operations = [
        migrations.RunPython(reconcile_security_history, migrations.RunPython.noop),
    ]
