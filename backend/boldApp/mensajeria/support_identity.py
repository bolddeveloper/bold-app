"""A mentionable service account with no interactive login or employee access."""
import uuid

from django.db import transaction

from boldApp.core.models import Employee, JobRole, Position, PositionAssignment, UserAccount


BOT_ID = uuid.uuid5(uuid.NAMESPACE_URL, 'bold:local-support:assignment')
BOT_NAME = 'soportebold'
BOT_EMAIL = 'soportebold@bold.gt'
BOT_TOKEN = '@' + BOT_EMAIL


def isolated(assignment):
    account = getattr(assignment.employee, 'user_account', None)
    return bool(not assignment.is_active and not assignment.employee.is_active and account
        and account.email == BOT_EMAIL and not account.is_active and not account.has_usable_password()
        and not account.is_staff and not account.is_superuser)


@transaction.atomic
def configure_identity(unit):
    person, _ = Employee.objects.get_or_create(
        id=uuid.uuid5(BOT_ID, 'employee'), defaults={'full_name': BOT_NAME, 'is_active': False})
    role, _ = JobRole.objects.get_or_create(
        id=uuid.uuid5(BOT_ID, 'role'), defaults={'title': 'Asistente de soporte (sin acceso)'})
    position, _ = Position.objects.get_or_create(
        id=uuid.uuid5(BOT_ID, 'position'), defaults={'unit': unit, 'job_role': role})
    assignment, _ = PositionAssignment.objects.get_or_create(
        id=BOT_ID, defaults={'employee': person, 'position': position, 'is_active': False})
    if not hasattr(person, 'user_account'):
        if UserAccount.objects.filter(email__iexact=BOT_EMAIL).exists():
            raise ValueError('El correo de soportebold ya pertenece a otra cuenta.')
        UserAccount.objects.create_user(email=BOT_EMAIL, employee=person, password=None, is_active=False)
    if not isolated(assignment):
        raise ValueError('La cuenta de soporte debe conservarse sin inicio de sesión ni permisos de usuario.')
    if person.full_name != BOT_NAME:
        person.full_name = BOT_NAME
        person.save(update_fields=['full_name'])
    assignment.employee = person
    return assignment


def mention_person():
    assignment = PositionAssignment.objects.select_related('employee__user_account').filter(pk=BOT_ID).first()
    if not assignment or not isolated(assignment):
        return None
    return {'employee_id': str(assignment.employee_id), 'name': BOT_NAME, 'email': BOT_EMAIL,
            'token': BOT_TOKEN, 'is_bot': True, 'aliases': ['Soporte BOLD']}
