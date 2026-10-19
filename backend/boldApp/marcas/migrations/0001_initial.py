import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def permissions(apps, schema_editor):
    Permission = apps.get_model("boldApp_core", "Permission")
    for action, title, risk, bulk in [("read", "Consultar marcas compartidas conmigo.", "low", True), ("create", "Crear marcas de trabajo.", "medium", True), ("manage", "Editar contexto y asociaciones de marcas compartidas.", "medium", True), ("share", "Gestionar colaboradores de una marca propia.", "high", False)]:
        Permission.objects.using(schema_editor.connection.alias).get_or_create(code=f"brands.brand.{action}", defaults={
            "module_code": "brands", "resource": "brand", "action": action, "description": title, "risk_level": risk,
            "is_delegable": True, "is_bulk_assignable": bulk, "is_active": True, "system_managed": True})


class Migration(migrations.Migration):
    dependencies = [("boldApp_core", "0017_account_connector_delegation"), ("boldApp_tareas", "0015_workspace_library"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(name="Brand", fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("name", models.CharField(max_length=120)), ("description", models.TextField(blank=True)),
        ("logo", models.TextField(blank=True, null=True)), ("details", models.JSONField(default=dict)),
        ("project_ids", models.JSONField(default=list)), ("task_ids", models.JSONField(default=list)),
        ("revision", models.PositiveIntegerField(default=1)), ("created_at", models.DateTimeField(auto_now_add=True)),
        ("updated_at", models.DateTimeField(auto_now=True)), ("archived_at", models.DateTimeField(blank=True, null=True)),
        ("owner", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="brands", to=settings.AUTH_USER_MODEL)),
        ("unit", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="boldApp_core.organizationalunit")),
        ("members", models.ManyToManyField(blank=True, to="boldApp_core.positionassignment")),
    ], options={"ordering": ["created_at", "pk"]}), migrations.RunPython(permissions, migrations.RunPython.noop)]
