import getpass
import os

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from boldApp.core.models import (
    Employee,
    JobRole,
    OrganizationalUnit,
    Position,
    PositionAssignment,
    UserAccount,
)


class Command(BaseCommand):
    help = "Crea la primera cuenta propietaria en una base vacia, sin usar la seed demo."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--name", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        email = UserAccount.objects.normalize_email(options["email"]).strip().lower()
        full_name = options["name"].strip()
        if not email.endswith("@bold.gt"):
            raise CommandError("La cuenta propietaria debe usar un correo @bold.gt.")
        if not full_name:
            raise CommandError("El nombre del propietario es obligatorio.")
        if UserAccount.objects.filter(is_superuser=True).exists():
            raise CommandError("Ya existe una cuenta propietaria; no se creo otra.")
        if UserAccount.objects.filter(email=email).exists():
            raise CommandError("El correo ya pertenece a otra cuenta.")

        password = os.environ.get("BOLD_BOOTSTRAP_OWNER_PASSWORD")
        if not password:
            password = getpass.getpass("Contrasena inicial: ")
            confirmation = getpass.getpass("Confirma la contrasena: ")
            if password != confirmation:
                raise CommandError("Las contrasenas no coinciden.")

        candidate = UserAccount(email=email)
        try:
            validate_password(password, candidate)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from error

        root, _ = OrganizationalUnit.objects.get_or_create(
            name="Bold",
            defaults={"unit_type": "company", "sensitivity_level": "medium"},
        )
        unit, _ = OrganizationalUnit.objects.get_or_create(
            name="Dirección",
            defaults={
                "unit_type": "team",
                "parent_unit": root,
                "sensitivity_level": "critical",
                "color_hex": "#3f3f41",
                "is_control_plane": True,
            },
        )
        if not unit.is_control_plane:
            unit.is_control_plane = True
            unit.save(update_fields=["is_control_plane", "updated_at"])
        role, _ = JobRole.objects.get_or_create(
            title="Propietario",
            defaults={"level": "owner", "description": "Propietario de la organizacion."},
        )
        position, _ = Position.objects.get_or_create(
            unit=unit,
            job_role=role,
            defaults={"display_order": 0, "is_open": False},
        )
        if position.assignments.filter(is_active=True, released_at__isnull=True).exists():
            raise CommandError("La plaza propietaria ya tiene una asignacion activa.")

        employee = Employee.objects.create(full_name=full_name)
        account = UserAccount.objects.create_superuser(
            email=email,
            employee=employee,
            password=password,
            email_verified_at=timezone.now(),
            password_changed_at=timezone.now(),
        )
        PositionAssignment.objects.create(position=position, employee=employee)
        self.stdout.write(self.style.SUCCESS(f"Cuenta propietaria creada: {account.email}"))
