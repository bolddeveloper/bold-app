import django.db.models.deletion
import uuid
from django.db import migrations, models


PERMISSIONS = [
    ("suggestions.feedback.create", "create", "low", True, "Enviar sugerencias e incidencias."),
    ("suggestions.feedback.read", "read", "medium", True, "Consultar sugerencias dentro del alcance autorizado."),
    ("suggestions.feedback.manage", "manage", "high", False, "Gestionar el estado de las sugerencias."),
]


def register_permissions(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    JobRole = apps.get_model("boldApp_core", "JobRole")
    JobRolePermission = apps.get_model("boldApp_core", "JobRolePermission")
    permissions = {}
    for code, action, risk, bulk, description in PERMISSIONS:
        permissions[code], _ = Permission.objects.update_or_create(
            code=code,
            defaults={
                "module_code": "suggestions", "resource": "feedback", "action": action,
                "risk_level": risk, "is_delegable": action != "manage",
                "requires_step_up_mfa": False, "is_active": True,
                "system_managed": True, "is_bulk_assignable": bulk,
                "description": description,
            },
        )
    create_permission = permissions["suggestions.feedback.create"]
    for role in JobRole.objects.exclude(level__iexact="owner"):
        JobRolePermission.objects.get_or_create(
            job_role=role, permission=create_permission, scope_type="own_unit",
            target_unit=None,
            defaults={
                "effect": "allow", "reason": "Acceso base para enviar sugerencias desde la aplicacion.",
            },
        )


class Migration(migrations.Migration):
    initial = True
    dependencies = [("boldApp_core", "0009_permission_bulk_assignment")]

    operations = [
        migrations.CreateModel(
            name="Suggestion",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("category", models.CharField(choices=[("idea", "Idea"), ("bug", "Problema"), ("visual", "Mejora visual"), ("other", "Otro")], max_length=20)),
                ("message", models.TextField(max_length=2000)),
                ("source_module", models.CharField(blank=True, max_length=50)),
                ("source_view", models.CharField(blank=True, max_length=80)),
                ("status", models.CharField(choices=[("new", "Nueva"), ("reviewing", "En revision"), ("accepted", "Aceptada"), ("resolved", "Resuelta"), ("dismissed", "Descartada")], default="new", max_length=20)),
                ("internal_note", models.TextField(blank=True, max_length=2000)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("author_assignment", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="suggestions_authored", to="boldApp_core.positionassignment")),
                ("reviewed_by_assignment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="suggestions_reviewed", to="boldApp_core.positionassignment")),
                ("unit", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="suggestions", to="boldApp_core.organizationalunit")),
            ],
            options={"db_table": "suggestions", "ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="SuggestionEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("event_type", models.CharField(max_length=60)),
                ("changes", models.JSONField(blank=True, default=dict)),
                ("occurred_at", models.DateTimeField(auto_now_add=True)),
                ("actor_assignment", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="suggestion_events", to="boldApp_core.positionassignment")),
                ("suggestion", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="events", to="boldApp_sugerencias.suggestion")),
            ],
            options={"db_table": "suggestion_events", "ordering": ["-occurred_at"]},
        ),
        migrations.AddIndex(model_name="suggestion", index=models.Index(fields=["unit", "status", "created_at"], name="idx_suggestion_unit_status")),
        migrations.AddIndex(model_name="suggestion", index=models.Index(fields=["author_assignment", "created_at"], name="idx_suggestion_author_time")),
        migrations.RunPython(register_permissions, migrations.RunPython.noop),
    ]
