"""Comprueba el piloto y un recorrido XLSX sin guardar ni publicar datos."""
import base64
from uuid import UUID

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from boldApp.core.authorization import resolve_access
from boldApp.core.models import OrganizationalUnit, Permission, PositionAssignment
from boldApp.hojas import engine
from boldApp.hojas.document import blank


class Command(BaseCommand):
    help = "Verifica unidades del piloto, permisos y cálculo/exportación/importación de Excel. No modifica archivos."

    def add_arguments(self, parser):
        parser.add_argument("--list-units", action="store_true", help="Muestra nombres e identificadores para configurar el piloto.")

    def handle(self, *args, **options):
        if options["list_units"]:
            for unit in OrganizationalUnit.objects.all():
                self.stdout.write(f"{unit.id}  {unit.name} ({unit.unit_type})")
            return
        if not settings.SHEETS_PILOT_ENABLED or not settings.SHEETS_PILOT_UNIT_IDS:
            raise CommandError("Activa SHEETS_PILOT_ENABLED y configura SHEETS_PILOT_UNIT_IDS con las unidades IT autorizadas.")
        try:
            identities = {UUID(value) for value in settings.SHEETS_PILOT_UNIT_IDS}
        except ValueError as error:
            raise CommandError("SHEETS_PILOT_UNIT_IDS debe contener UUID separados por comas.") from error
        units = OrganizationalUnit.objects.filter(pk__in=identities)
        if units.count() != len(identities):
            raise CommandError("Hay unidades del piloto que no existen en esta base de datos.")
        assignments = PositionAssignment.objects.filter(position__unit_id__in=identities, is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True).select_related("position__unit", "position__job_role", "employee__user_account")
        count = 0
        missing = 0
        permissions = list(Permission.objects.filter(code__in=["sheets.file." + action for action in ("read", "create", "edit", "export")]))
        for assignment in assignments:
            count += 1
            if len(permissions) != 4 or not all(resolve_access(assignment, permission, assignment.position.unit).allowed for permission in permissions):
                missing += 1
        if not count or missing:
            raise CommandError(f"Piloto: {count} asignaciones activas, {missing} sin permisos básicos de Sheets. Configura los permisos existentes antes de publicar.")
        self.stdout.write(f"Piloto IT: {units.count()} unidades y {count} asignaciones verificadas. Los demás módulos conservan sus permisos.")
        document = blank("Comprobación de Sheets")
        sheet = document["sheets"][document["sheetOrder"][0]]
        sheet["cellData"] = {"0": {"0": {"v": 20}}, "1": {"0": {"v": 30}}, "2": {"0": {"f": "=SUM(A1:A2)"}}}
        try:
            calculated = engine.call("calculate", document)["document"]
            if calculated["sheets"][sheet["id"]]["cellData"]["2"]["0"].get("v") != 50:
                raise ValueError("El cálculo de la fórmula no produjo 50.")
            content = engine.call("export", calculated, directory=[], links=[], revision=1, recalculate=False)
            if not content.startswith(b"PK"):
                raise ValueError("La exportación no produjo un XLSX válido.")
            imported = engine.call("import", document, file=base64.b64encode(content).decode(), advanced=True)["document"]
            imported_sheet = imported["sheets"][imported["sheetOrder"][0]]
            if imported_sheet["cellData"]["0"]["0"].get("v") != 20:
                raise ValueError("La reimportación no conservó los valores.")
        except Exception as error:
            raise CommandError("Falló el recorrido de Excel; revisa el motor interno, su token y sus registros.") from error
        self.stdout.write(self.style.SUCCESS("Excel: fórmula, exportación XLSX y reimportación correctas. Sin cambios en archivos ni Drive."))
