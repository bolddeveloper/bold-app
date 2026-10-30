"""Create a fresh, guarded localhost profile; print only its path, not secrets."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import secrets
import uuid
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)


def prepare():
    parent = Path(os.environ["LOCALAPPDATA"]) / "BOLDApp" / "validation"
    parent.mkdir(parents=True, exist_ok=True)
    root = parent / ("pwa-multitasking-" + uuid.uuid4().hex)
    root.mkdir(mode=0o700)
    key = ec.generate_private_key(ec.SECP256R1())
    private_json(root / "private-settings.json", {"signing": secrets.token_hex(32), "encryption": secrets.token_hex(32),
        "push_private": base64.urlsafe_b64encode(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())).decode(),
        "push_public": base64.urlsafe_b64encode(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).decode().rstrip("=")})
    os.environ["BOLD_MULTITASKING_ACCEPTANCE_DIR"] = str(root)
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_multitasking_acceptance"
    import django
    django.setup()
    from django.conf import settings
    from django.core.management import call_command
    from django.utils import timezone
    from boldApp.core.models import Employee, UserAccount, OrganizationalUnit, Position, PositionAssignment
    from boldApp.tareas.management.commands.seed_demo_data import Command
    from boldApp.tareas.models import Task, TaskProject, Project, ProjectMember, Section, TaskStatus
    from boldApp.tareas.pipelines import personal_pipeline, ensure_project_pipeline
    from boldApp.notificaciones.models import Notification
    with contextlib.redirect_stdout(io.StringIO()):
        call_command("migrate", interactive=False, verbosity=0)
        roles = Command().seed_roles_and_permissions([{"role": "Desarrollador"}, {"role": "Propietario"}])
        unit = OrganizationalUnit.objects.create(pk=settings.MESSAGING_PILOT_UNIT_IDS[0], name="IT · Aceptación local", unit_type="department", sensitivity_level="low")
        outside = OrganizationalUnit.objects.create(name="Dirección · Aceptación local", unit_type="department", sensitivity_level="low", is_control_plane=True)
        Command().seed_statuses({unit.name: unit, outside.name: outside})
        accounts, assignments = [], []
        for index, name in enumerate(("Empleado A · Sintético", "Empleado B · Sintético", "Luis · Propietario sintético")):
            employee = Employee.objects.create(full_name=name)
            password = secrets.token_urlsafe(32)
            user = UserAccount.objects.create_user(email=f"multitasking.acceptance.{index}@bold.gt", employee=employee, password=password,
                is_superuser=index == 2, is_staff=index == 2, email_verified_at=timezone.now(), notification_settings={"desktop_enabled": True, "enabled": True, "volume": 60})
            assignment = PositionAssignment.objects.create(employee=employee, position=Position.objects.create(unit=outside if index == 2 else unit,
                job_role=roles["Propietario" if index == 2 else "Desarrollador"]))
            accounts.append({"email": user.email, "password": password, "id": str(user.pk), "assignment_id": str(assignment.pk)})
            assignments.append(assignment); personal_pipeline(employee)
        project = Project.objects.create(unit=unit, owner_assignment=assignments[0], created_by_assignment=assignments[0], name="Proyecto de aceptación", status="active")
        for assignment in assignments[:2]:
            ProjectMember.objects.create(project=project, assignment=assignment, member_role="member", status="active", added_by_assignment=assignments[0])
        section = Section.objects.create(project=project, name="Revisión de prueba", position=1000)
        pipeline = ensure_project_pipeline(project)
        status = TaskStatus.objects.filter(unit=unit, is_final=False).order_by("position").first()
        task = Task.objects.create(unit=unit, status=status, created_by_assignment=assignments[0], assignee_assignment=assignments[0],
            title="Tarea de aceptación", description="Descripción inicial", priority="medium")
        TaskProject.objects.create(task=task, project=project, section=section, position=1000, added_by_assignment=assignments[0])
        Notification.objects.all().delete()
        fixture = {"local_only": True, "root": str(root), "url": settings.FRONTEND_URL, "accounts": accounts,
            "project_id": str(project.pk), "section_id": str(section.pk), "task_id": str(task.pk), "status_id": str(status.pk),
            "pipeline_id": str(pipeline.pk), "unit_id": str(unit.pk)}
        private_json(root / "fixture.json", fixture)
    print(str(root))


if __name__ == "__main__":
    prepare()
