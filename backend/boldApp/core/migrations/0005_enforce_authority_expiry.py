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


def reconcile_previously_applied_security_bounds(apps, schema_editor):
    """Hace idempotente el hardening para bases que ya alcanzaron 0004."""

    AccessGrant = apps.get_model("boldApp_core", "AccessGrant")
    GrantAuthority = apps.get_model("boldApp_core", "GrantAuthority")
    Permission = apps.get_model("boldApp_core", "Permission")

    Permission.objects.exclude(code__in=DELEGABLE_PERMISSION_CODES).update(is_delegable=False)
    now = timezone.now()

    for grant in AccessGrant.objects.filter(effect="allow", valid_until__isnull=True).iterator():
        updates = {
            "valid_until": max(now, grant.valid_from + datetime.timedelta(seconds=1)),
        }
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
        elif authority.valid_until <= now or authority.revoked_at is not None:
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
        ("boldApp_core", "0004_harden_permission_delegation_constraints"),
    ]

    operations = [
        migrations.RunPython(
            reconcile_previously_applied_security_bounds,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="grantauthority",
            name="valid_until",
            field=models.DateTimeField(),
        ),
    ]
