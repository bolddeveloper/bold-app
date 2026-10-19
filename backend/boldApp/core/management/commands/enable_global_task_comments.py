"""Enable comments across departments while task read checks remain mandatory."""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from boldApp.core.models import JobRole, JobRolePermission, Permission


class Command(BaseCommand):
    help = "Habilita comentarios globales para los cargos existentes, sin cambiar lectura ni denegaciones."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        permission = Permission.objects.filter(code="tasks.comment.create", is_active=True).first()
        if not permission:
            raise CommandError("No existe el permiso activo de comentarios.")
        changed = denied = 0
        for role in JobRole.objects.order_by("pk"):
            rules = JobRolePermission.objects.select_for_update().filter(job_role=role, permission=permission)
            if rules.filter(effect="deny").exists():
                denied += 1
                continue
            if rules.filter(scope_type="global", effect="allow").exists():
                continue
            changed += 1
            if options["dry_run"]:
                continue
            rule = rules.filter(effect="allow", scope_type__in=("own_unit", "own_sub_tree")).first()
            if rule is None:
                rule = JobRolePermission(job_role=role, permission=permission, effect="allow")
            rule.scope_type = "global"
            rule.target_unit = None
            rule.reason = "Comentarios entre departamentos: requiere acceso de lectura a la tarea. Habilitado en despliegue autorizado."
            rule.save()
        self.stdout.write(f"Comentarios globales: {changed} cargos {'por actualizar' if options['dry_run'] else 'actualizados'}; {denied} cargos con denegaciones explícitas conservadas.")
