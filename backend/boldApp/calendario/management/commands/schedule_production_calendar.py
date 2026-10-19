from datetime import date
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.html import strip_tags

from boldApp.calendario.models import AppCalendar
from boldApp.calendario.local import event_times
from boldApp.calendario.production_hours import production_schedule


class Command(BaseCommand):
    help = "Aplica horarios de las notas de producción sin cambiar eventos que ya tienen hora."

    def add_arguments(self, parser):
        parser.add_argument("--daytime", action="store_true", help="Interpretar horas sin AM/PM como jornada diurna.")
        parser.add_argument("--default-minutes", type=int, default=60)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--report", help="Ruta de un informe JSON de cambios y casos por revisar.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not 5 <= options["default_minutes"] <= 12 * 60:
            raise CommandError("La duración provisional debe estar entre 5 y 720 minutos.")
        calendar = AppCalendar.objects.filter(system_key="production").first()
        if not calendar:
            raise CommandError("Primero importa Calendario producción.")
        report = {"scheduled": [], "review": [], "unchanged_timed": 0, "without_time": 0}
        for row in list(calendar.events.select_for_update().order_by("id")):
            original = row.data
            if original.get("start", {}).get("dateTime"):
                report["unchanged_timed"] += 1
                continue
            day = original.get("start", {}).get("date")
            if not day:
                continue
            # Import notes preserve the exact original cell before the agenda attribution.
            text = strip_tags(original.get("description", "").split("\n\nAgenda:", 1)[0]).strip() or original.get("summary", "")
            if original.get("summary") and original["summary"] not in text:
                text = original["summary"] + "\n" + text
            blocks, warnings = production_schedule(text, date.fromisoformat(day), daytime=options["daytime"], default_minutes=options["default_minutes"])
            report["review"].extend({"id": str(row.pk), "source": row.source_key, "reason": warning} for warning in warnings)
            if warnings and not options["dry_run"]:
                original = {**original, "source_hours_review": warnings}
            if not blocks:
                report["without_time"] += 1
                if warnings and not options["dry_run"] and row.data.get("source_hours_review") != warnings:
                    row.data = original
                    row.save(update_fields=["data", "updated_at"])
                continue
            report["scheduled"].append({"id": str(row.pk), "source": row.source_key, "blocks": blocks})
            if options["dry_run"]:
                continue
            for index, block in enumerate(blocks):
                data = {**original, "summary": block["summary"], "start": block["start"], "end": block["end"],
                    "source_hours": {"original_start": original["start"], "original_end": original["end"], "original_summary": original.get("summary", ""), "original_description": original.get("description", ""), "note": block["note"]}}
                data["description"] = original.get("description", "") + ("\n\n" + block["note"] if block["note"] else "")
                start, end = event_times(data)
                if index == 0:
                    row.data, row.start_at, row.end_at = data, start, end
                    row.save(update_fields=["data", "start_at", "end_at", "updated_at"])
                else:
                    calendar.events.get_or_create(source_key=f"{row.source_key or row.pk}:hours:{index+1}", defaults={"data": data,"start_at": start,"end_at": end})
        if options["report"]:
            Path(options["report"]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        self.stdout.write(f"{'Simulación: ' if options['dry_run'] else ''}{len(report['scheduled'])} entradas con horario; {len(report['review'])} casos por revisar; {report['unchanged_timed']} eventos ya programados conservados.")
