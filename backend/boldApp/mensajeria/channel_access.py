"""The same configurable Core permissions apply to HTTP and socket hints."""
from rest_framework.exceptions import PermissionDenied

from boldApp.core.authorization import apply_session_assurance, build_authorization_context, check_and_log, resolve_access
from boldApp.core.models import Permission
from .access import assignment_can_chat


class ChannelPolicy:
    def __init__(self, assignment, request=None):
        self.assignment = assignment
        self.request = request
        self.permissions = {row.code: row for row in Permission.objects.filter(module_code="slack", is_active=True)}
        self.contexts = {}

    def allows(self, code, unit, resource_id=None, *, require_assurance=True):
        permission = self.permissions.get(code)
        if not permission or not assignment_can_chat(self.assignment):
            return False
        if code not in self.contexts:
            self.contexts[code] = build_authorization_context(self.assignment, permission)
        decision = resolve_access(self.assignment, permission, unit, resource_id=resource_id, context=self.contexts[code])
        # Background notification creation stores only a generic hint. Every
        # REST/socket projection still uses the default, session-enforced path.
        return apply_session_assurance(decision, permission, self.request).allowed if require_assurance else decision.allowed

    def require(self, code, unit, resource_id=None):
        allowed = self.allows(code, unit, resource_id)
        if code in self.permissions and self.request is not None:
            allowed = check_and_log(assignment=self.assignment, permission_code=code, target_unit=unit,
                resource_id=resource_id, resource_type="channel", request=self.request).allowed
        if not allowed:
            raise PermissionDenied("Tu asignación activa no permite esta acción en Slack.")
