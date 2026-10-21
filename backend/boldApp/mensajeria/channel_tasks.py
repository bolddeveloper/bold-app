"""Task references never grant access and never snapshot protected task titles."""
from rest_framework.exceptions import NotFound

from boldApp.core.authorization import apply_session_assurance, build_authorization_context, resolve_access
from boldApp.core.authorization_units import load_authorization_units
from boldApp.core.models import Permission
from boldApp.tareas.authorization_provider import task_reader_contexts
from boldApp.tareas.models import Task


class TaskReferences:
    def __init__(self, assignment, request):
        self.assignment = assignment
        self.request = request
        self.permission = Permission.objects.filter(code="tasks.task.read", is_active=True).first()
        self.context = build_authorization_context(assignment, self.permission) if self.permission else None
        self.units = load_authorization_units(assignment)
        self.rows = {}

    def prime(self, identities):
        unknown = set(identities) - self.rows.keys() - {None}
        if not unknown:
            return
        rows = list(Task.objects.filter(pk__in=unknown).select_related("unit", "status"))
        self.rows.update(dict.fromkeys(unknown))
        self.rows.update({row.pk: row for row in rows})
        if self.context:
            self.context.resource_contexts.update(task_reader_contexts(rows, self.assignment))

    def data(self, identity):
        if identity is None:
            return None
        self.prime([identity])
        task = self.rows.get(identity)
        if not task or not self.context:
            return {"available": False}
        decision = resolve_access(self.assignment, self.permission, self.units.get(task.unit_id, task.unit),
                                  resource_id=task.pk, context=self.context)
        if not apply_session_assurance(decision, self.permission, self.request).allowed:
            return {"available": False}
        return {"available": True, "id": str(task.pk), "title": task.title,
                "status": task.status.name, "completed": bool(task.completed_at or task.status.is_final)}

    def require(self, identity):
        if identity is not None and not self.data(identity)["available"]:
            raise NotFound("Esta tarea no está disponible para tu asignación activa.")
