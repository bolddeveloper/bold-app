from datetime import timedelta
from threading import Lock, Timer
import logging
import json
import uuid

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from .models import Workbook

timers, timer_lock = {}, Lock()
logger = logging.getLogger(__name__)


@shared_task(ignore_result=True)
def synchronize(workbook_id):
    from .drive import sync, update_external
    lease = uuid.uuid4()
    with transaction.atomic():
        workbook = Workbook.objects.select_for_update().filter(pk=workbook_id, deleted_at__isnull=True).first()
        now = timezone.now()
        if not workbook or workbook.sync_after and workbook.sync_after > now or workbook.lease_until and workbook.lease_until > now:
            return
        workbook.sync_lease, workbook.lease_until = lease, now + timedelta(seconds=120)
        workbook.save(update_fields=["sync_lease", "lease_until"])
    try:
        if workbook.sync_state in {"importing", "external"}:
            update_external(workbook_id, lease)
            return
        calculate_workbook(workbook_id)
        sync(workbook_id, lease=lease)
    finally:
        Workbook.objects.filter(pk=workbook_id, sync_lease=lease).update(sync_lease=None, lease_until=None)


def calculate_workbook(workbook_id):
    from . import engine
    from .operations import publish
    from .access import require_file
    workbook = Workbook.objects.select_related("creator__employee__user_account", "creator__position__unit", "creator__position__job_role").get(pk=workbook_id)
    validation = next((item for item in workbook.document.get("resources", []) if item["name"] == "SHEET_DATA_VALIDATION_PLUGIN"), None)
    rules = json.loads(validation["data"]) if validation else {}
    unresolved = [(sheet, rule) for sheet, items in rules.items() for rule in items if rule.get("type") == "list" and str(rule.get("formula1", "")).lstrip("=").startswith("_BOLD_LIST_")]
    if workbook.deleted_at or workbook.calculated_revision >= workbook.revision and not unresolved:
        return
    try:
        require_file(workbook.creator, workbook)
        if unresolved:
            if not workbook.excel_content:
                raise APIException("Actualiza desde el Excel original para recuperar las opciones de sus desplegables.")
            imported = engine.import_file(workbook, bytes(workbook.excel_content))["document"]
            recovered = next((item for item in imported.get("resources", []) if item["name"] == "SHEET_DATA_VALIDATION_PLUGIN"), None)
            options = json.loads(recovered["data"]) if recovered else {}
            for sheet, rule in unresolved:
                candidate = next((item for item in options.get(sheet, []) if item.get("uid") == rule.get("uid") and item.get("type") == "list"), None)
                if not candidate or not isinstance(json.loads(candidate["formula1"]), list):
                    raise APIException("No se recuperaron las opciones del desplegable. Conservamos los datos; revisa el Excel original.")
                rule["formula1"] = candidate["formula1"]
            validation["data"] = json.dumps(rules, ensure_ascii=False)
        has_formula = any(cell.get("f") for sheet in workbook.document["sheets"].values() for cells in sheet.get("cellData", {}).values() for cell in cells.values())
        result = engine.import_file(workbook, engine.export(workbook))["document"] if has_formula and workbook.excel_content and workbook.excel_revision != workbook.revision else engine.call("calculate", workbook.document)["document"] if has_formula and not workbook.excel_content else workbook.document
        from django.db import transaction
        with transaction.atomic():
            current = Workbook.objects.select_for_update().get(pk=workbook_id)
            if current.revision != workbook.revision or current.deleted_at:
                return
            if unresolved:
                for item in current.document.get("resources", []):
                    if item["name"] == validation["name"]:
                        item["data"] = validation["data"]
            for sheet_id in current.document["sheetOrder"]:
                for row, cells in current.document["sheets"][sheet_id]["cellData"].items():
                    for col, cell in cells.items():
                        if cell.get("f"):
                            calculated = result["sheets"][sheet_id].get("cellData", {}).get(row, {}).get(col, {})
                            if "v" in calculated:
                                cell["v"] = calculated["v"]
            current.calculated_revision = current.revision
            current.calculation_error = ""
            current.save(update_fields=["document", "calculated_revision", "calculation_error"])
            transaction.on_commit(lambda: publish(current.id, {"calculated": True, "revision": current.revision}))
    except Exception as exc:
        logger.exception("No se pudo recalcular el archivo de Hojas %s", workbook_id)
        message = "No se pudieron recalcular las fórmulas. Tus cambios siguen guardados; reintenta en unos momentos."
        if isinstance(exc, APIException):
            detail = exc.detail
            reason = " ".join(map(str, detail)) if isinstance(detail, list) else str(detail.get("detail", "Revisa el archivo.")) if isinstance(detail, dict) else str(detail)
            message = f"No se pudieron recalcular las fórmulas: {reason.rstrip('.')}. Tus cambios siguen guardados."
        changed = Workbook.objects.filter(pk=workbook_id, revision=workbook.revision, calculated_revision__lt=workbook.revision, deleted_at__isnull=True).update(calculation_error=message)
        if changed:
            publish(workbook_id, {"calculated": True, "calculation_error": message})


def enqueue(workbook_id, due):
    delay = max(0.1, (due - timezone.now()).total_seconds())
    if settings.CELERY_TASK_ALWAYS_EAGER:
        # Eager Celery ignores countdown; keep Google off the HTTP request thread locally.
        def run():
            close_old_connections()
            try:
                synchronize(workbook_id)
            finally:
                close_old_connections()
                with timer_lock:
                    if timers.get(workbook_id) is timer:
                        timers.pop(workbook_id, None)
        timer = Timer(delay, run)
        timer.daemon = True
        with timer_lock:
            old = timers.pop(workbook_id, None)
            if old:
                old.cancel()
            timers[workbook_id] = timer
            timer.start()
    else:
        synchronize.apply_async(args=[workbook_id], countdown=delay)


@shared_task(ignore_result=True)
def recover_pending():
    now = timezone.now()
    from django.db.models import Q
    for identity in Workbook.objects.filter(deleted_at__isnull=True, sync_after__lte=now).filter(Q(lease_until__isnull=True) | Q(lease_until__lt=now)).values_list("id", flat=True)[:100]:
        enqueue(str(identity), now + timedelta(milliseconds=100))
    from django.db.models import F
    for identity in Workbook.objects.filter(deleted_at__isnull=True, calculation_error="", calculated_revision__lt=F("revision"), drive_account__isnull=True).values_list("id", flat=True)[:100]:
        enqueue(str(identity), now + timedelta(milliseconds=100))
