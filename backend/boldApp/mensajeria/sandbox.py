"""Provision and exercise two fictitious accounts in the fixed local sandbox.

python -m boldApp.mensajeria.sandbox [--check]
Not a seed for the company database; this command refuses any other settings/DB.
"""
import os
import sys
import uuid

os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_messaging_sandbox"


def prepare():
    import django
    django.setup()
    from pathlib import Path
    from django.conf import settings
    from django.core.management import call_command
    from boldApp.core.models import Employee, JobRole, JobRolePermission, Permission, OrganizationalUnit, Position, PositionAssignment, UserAccount
    expected = Path(__file__).resolve().parents[2] / "db.messaging-sandbox.sqlite3"
    if Path(settings.DATABASES["default"]["NAME"]).resolve() != expected.resolve() or settings.DATABASES["default"]["ENGINE"] != "django.db.backends.sqlite3":
        raise RuntimeError("Sandbox requires the fixed isolated SQLite database")
    call_command("migrate", interactive=False, verbosity=0)
    role, _ = JobRole.objects.get_or_create(title="Prueba de mensajería")
    for code in ("tasks.task.read", "tasks.project.read"):
        permission = Permission.objects.filter(code=code).first()
        if permission:
            JobRolePermission.objects.get_or_create(job_role=role, permission=permission, effect="allow", scope_type="own_unit")
    identities = []
    for label in ("alfa", "beta"):
        name = f"Prueba de chat {label.title()}"
        email = f"chat.{label}@bold.gt"
        account = UserAccount.objects.filter(email=email).select_related("employee").first()
        if account and account.employee.full_name != name:
            raise RuntimeError("Refusing to change a non-fixture account")
        unit, _ = OrganizationalUnit.objects.get_or_create(name=f"Sandbox {label.title()}", defaults={"unit_type": "department", "sensitivity_level": "low"})
        if not account:
            account = UserAccount.objects.create_user(email=email, employee=Employee.objects.create(full_name=name), password="Isolated-Chat-Fixture-Only-2026!")
        assignment = PositionAssignment.objects.filter(employee=account.employee, is_active=True, released_at__isnull=True).first()
        if not assignment:
            assignment = PositionAssignment.objects.create(employee=account.employee, position=Position.objects.create(unit=unit, job_role=role))
        identities.append((account, assignment))
    print("Isolated SQLite migrated; two synthetic non-administrator employees are ready.")
    return identities


def check(identities):
    from django.conf import settings
    from rest_framework.test import APIClient
    clients = []
    for account, assignment in identities:
        client = APIClient(enforce_csrf_checks=True)
        response = client.get("/api/v2/auth/session/")
        csrf = response.data["csrf_token"]
        response = client.post("/api/v2/auth/login/", {"email": account.email, "password": "Isolated-Chat-Fixture-Only-2026!"}, format="json", HTTP_X_CSRFTOKEN=csrf)
        assert response.status_code == 200 and response.data["authenticated"], "Real login failed"
        csrf = client.get("/api/v2/auth/session/").data["csrf_token"]
        client.credentials(HTTP_X_ASSIGNMENT_ID=str(assignment.pk), HTTP_X_CSRFTOKEN=csrf)
        clients.append(client)
    assert clients[0].cookies[settings.AUTH_SESSION_COOKIE_NAME].value != clients[1].cookies[settings.AUTH_SESSION_COOKIE_NAME].value
    root = "/api/v2/messaging/conversations/"
    opened = clients[0].post(root, {"employee_id": str(identities[1][0].employee_id)}, format="json")
    assert opened.status_code in (200, 201), opened.data
    conversation = opened.data["id"]
    url = f"{root}{conversation}/messages/"
    sent = clients[0].post(url, {"body": "Prueba aislada Alfa → Beta", "client_id": str(uuid.uuid4())}, format="json")
    assert sent.status_code == 201, sent.data
    message = sent.data["message"]
    assert message["id"] in [row["id"] for row in clients[1].get(url).data["results"]]
    assert clients[1].patch(url + message["id"] + "/", {"body": "No permitido", "version": 1}, format="json").status_code == 403
    edited = clients[0].patch(url + message["id"] + "/", {"body": "Prueba corregida por Alfa", "version": 1}, format="json")
    assert edited.status_code == 200
    assert any(row["id"] == message["id"] and row["body"] == "Prueba corregida por Alfa" for row in clients[1].get(url).data["results"])
    assert clients[1].post(url, {"body": "Respuesta de Beta", "client_id": str(uuid.uuid4())}, format="json").status_code == 201
    print("PASS: two independent cookie sessions, CSRF, cross-department chat, send/reload/reply and author-only edit.")


if __name__ == "__main__":
    identities = prepare()
    if "--check" in sys.argv:
        check(identities)
