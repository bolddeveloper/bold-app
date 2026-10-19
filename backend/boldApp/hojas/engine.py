import base64

import requests
from django.conf import settings
from rest_framework.exceptions import APIException, ValidationError


def call(endpoint, document, **extra):
    try:
        response = requests.post(settings.SHEETS_ENGINE_URL.rstrip("/") + "/" + endpoint, json={"document": document, **extra}, headers={"Authorization": "Bearer " + settings.SHEETS_ENGINE_TOKEN}, timeout=60)
    except requests.RequestException as exc:
        raise APIException("El motor de Sheets no está disponible. Tus datos siguen guardados en BOLD.") from exc
    if not response.ok:
        try:
            message = response.json().get("detail", "No se pudo procesar el Excel.")
        except ValueError:
            message = "El motor de Sheets no está disponible."
        raise ValidationError(message)
    return response.content if endpoint == "export" else response.json()


def directory():
    from boldApp.core.models import PositionAssignment
    return [{"id": str(person.id), "employee": str(person.employee_id), "account": str(person.employee.user_account.id), "name": person.employee.full_name, "email": person.employee.user_account.email, "unit": str(person.position.unit_id), "department": person.position.unit.name} for person in PositionAssignment.objects.filter(is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True).select_related("employee__user_account", "position__unit")]


def export(workbook):
    if workbook.excel_content and workbook.excel_revision == workbook.revision:
        return bytes(workbook.excel_content)
    links = [{"row": str(link.row_id), "task": str(link.task_id)} for link in workbook.task_links.filter(active=True)]
    content = call("export", workbook.document, directory=directory(), links=links, revision=workbook.revision, recalculate=workbook.calculated_revision < workbook.revision, source=base64.b64encode(bytes(workbook.excel_content)).decode() if workbook.excel_content else None)
    return content


def import_file(workbook, content):
    return call("import", workbook.document, file=base64.b64encode(content).decode(), directory=directory(), advanced=True)
