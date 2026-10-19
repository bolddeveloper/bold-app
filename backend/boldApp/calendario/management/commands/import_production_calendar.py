import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.core.management import call_command
from django.db import transaction

from boldApp.core.models import UserAccount
from boldApp.calendario.models import AppCalendar, CalendarMember
from boldApp.calendario.local import event_times
from boldApp.calendario.production_import import production_events


class Command(BaseCommand):
    help = "Importa la agenda de producción sin sobrescribir eventos existentes ni conectar Google."

    def add_arguments(self, parser):
        parser.add_argument("--source", help="Excel original; sin este argumento usa los datos revisados incluidos.")
        parser.add_argument("--owner", required=True, help="Correo de la cuenta propietaria de BOLD.")
        parser.add_argument("--manager", action="append", default=[], help="Correo con acceso de administración; repetible.")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--schedule-hours", action="store_true", help="Aplicar los horarios diurnos y la duración provisional de una hora.")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            owner = UserAccount.objects.get(email__iexact=options["owner"], is_active=True)
            managers = [UserAccount.objects.get(email__iexact=email, is_active=True) for email in options["manager"]]
        except UserAccount.DoesNotExist:
            raise CommandError("Propietario o administrador no corresponde a una cuenta activa de BOLD.")
        dataset = production_events(options["source"]) if options["source"] else json.loads((Path(__file__).parents[2] / "data" / "production_calendar.json").read_text(encoding="utf-8"))
        if options["dry_run"]:
            self.stdout.write(f"{len(dataset['events'])} eventos; {len(dataset['warnings'])} fechas para revisar. Sin cambios.")
            return
        calendar, _ = AppCalendar.objects.get_or_create(system_key="production", defaults={"name": "Calendario producción", "owner": owner})
        if calendar.owner_id != owner.pk:
            raise CommandError("Ya existe un propietario diferente. No se modificó su calendario.")
        for user in managers:
            if user.pk != owner.pk:
                CalendarMember.objects.update_or_create(calendar=calendar, user=user, defaults={"role": "manager"})
        created = 0
        for item in dataset["events"]:
            data = {key: value for key, value in item.items() if key != "source_key"}
            start, end = event_times(data)
            _, added = calendar.events.get_or_create(source_key=item["source_key"], defaults={"data": data, "start_at": start, "end_at": end})
            created += added
        self.stdout.write(self.style.SUCCESS(f"{created} eventos añadidos; {len(dataset['events']) - created} existentes conservados. {len(dataset['warnings'])} fechas para revisar en el original."))
        if options["schedule_hours"]:
            call_command("schedule_production_calendar", daytime=True, default_minutes=60, stdout=self.stdout)
