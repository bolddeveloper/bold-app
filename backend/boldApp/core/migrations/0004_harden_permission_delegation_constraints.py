import datetime

from django.db import migrations, models
from django.utils import timezone


DELEGABLE_PERMISSION_CODES = {
    "tasks.task.read",
    "tasks.task.create",
    "tasks.task.update",
    "tasks.task.delete",
    "tasks.task.assign",
    "tasks.comment.create",
    "tasks.project.read",
    "tasks.project.manage",
    "tasks.catalog.read",
    "tasks.webhook.manage",
}


def normalize_security_bounds(apps, schema_editor):
    AccessGrant = apps.get_model("boldApp_core", "AccessGrant")
    GrantAuthority = apps.get_model("boldApp_core", "GrantAuthority")
    Permission = apps.get_model("boldApp_core", "Permission")

    # Ningún permiso heredado o desconocido queda delegable por accidente.
    Permission.objects.exclude(code__in=DELEGABLE_PERMISSION_CODES).update(is_delegable=False)

    now = timezone.now()
    for grant in AccessGrant.objects.filter(effect="allow", valid_until__isnull=True).iterator():
        # Los antiguos grants permanentes se cierran al migrar. Se conserva
        # la fila para auditoría, pero ya no participa en decisiones nuevas.
        updates = {
            "valid_until": max(now, grant.valid_from + datetime.timedelta(seconds=1)),
        }
        # No convierte una revocacion auditada en una mera expiracion.
        if grant.status != "revoked":
            updates["status"] = "expired"
        AccessGrant.objects.filter(pk=grant.pk).update(**updates)

    valid_sensitivity = {"low", "medium", "high", "critical"}
    for authority in GrantAuthority.objects.all().iterator():
        updates = {}
        if authority.valid_until is None:
            updates["valid_until"] = (
                now
                if now > authority.valid_from
                else authority.valid_from + datetime.timedelta(microseconds=1)
            )
            updates["is_active"] = False
        elif authority.valid_until <= now:
            updates["is_active"] = False
        if authority.max_sensitivity_level not in valid_sensitivity:
            updates["max_sensitivity_level"] = "low"
        bounded_duration = min(max(authority.max_grant_duration_seconds, 300), 7776000)
        if bounded_duration != authority.max_grant_duration_seconds:
            updates["max_grant_duration_seconds"] = bounded_duration
        if authority.delegation_depth_remaining > 5:
            updates["delegation_depth_remaining"] = 5
        if updates:
            GrantAuthority.objects.filter(pk=authority.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("boldApp_core", "0003_remove_jobrolepermission_unique_job_role_permission_and_more"),
    ]

    operations = [
        migrations.RunPython(normalize_security_bounds, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="grantauthority",
            name="max_sensitivity_level",
            field=models.CharField(
                choices=[
                    ("low", "Bajo"),
                    ("medium", "Medio"),
                    ("high", "Alto"),
                    ("critical", "Crítico"),
                ],
                default="low",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="permission",
            name="is_delegable",
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name="accessgrant",
            constraint=models.CheckConstraint(
                condition=models.Q(effect="deny") | models.Q(valid_until__isnull=False),
                name="access_grant_allow_requires_expiry",
            ),
        ),
        migrations.AddConstraint(
            model_name="grantauthority",
            constraint=models.CheckConstraint(
                condition=models.Q(max_sensitivity_level__in=["low", "medium", "high", "critical"]),
                name="grant_authority_valid_sensitivity",
            ),
        ),
        migrations.AddConstraint(
            model_name="grantauthority",
            constraint=models.CheckConstraint(
                condition=models.Q(max_grant_duration_seconds__gte=300)
                & models.Q(max_grant_duration_seconds__lte=7776000),
                name="grant_authority_valid_duration_limit",
            ),
        ),
        migrations.AddConstraint(
            model_name="grantauthority",
            constraint=models.CheckConstraint(
                condition=models.Q(delegation_depth_remaining__lte=5),
                name="grant_authority_valid_depth",
            ),
        ),
    ]
