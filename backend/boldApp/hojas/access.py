from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from boldApp.core.authorization import check_and_log
from .models import Member, Workbook


def module_allowed(assignment, action="read"):
    return check_and_log(assignment=assignment, permission_code="sheets.file." + action, target_unit=assignment.position.unit).allowed


def require_module(assignment, action="read"):
    if not module_allowed(assignment, "read") or action != "read" and not module_allowed(assignment, action):
        raise PermissionDenied("No tienes permiso para esta acción en Sheets.")


def accessible(assignment):
    account = assignment.employee.user_account
    return Workbook.objects.filter(Q(owner=account) | Q(members__account=account)).distinct()


def participates(assignment, identity):
    return accessible(assignment).filter(pk=identity, deleted_at__isnull=True).exists()


def readable(assignment, identity):
    return module_allowed(assignment) and participates(assignment, identity)


def require_file(assignment, workbook, action="read", *, include_deleted=False):
    require_module(assignment, action)
    account = assignment.employee.user_account
    owner = workbook.owner_id == account.id
    role = "owner" if owner else Member.objects.filter(workbook=workbook, account=account).values_list("role", flat=True).first()
    if not role or workbook.deleted_at and not include_deleted or action in {"share", "delete"} and not owner or action not in {"read", "export"} and role == "reader":
        raise PermissionDenied("El archivo no está disponible para esta cuenta.")
    return role
