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
        self.resources = {}

    def prime(self, channels):
        from .models import ChannelAccessRule
        channels = list(channels)
        rules = dict(ChannelAccessRule.objects.filter(channel_id__in=[row.pk for row in channels],
            employee_id=self.assignment.employee_id).values_list("channel_id", "access"))
        for row in channels:
            self.resources[("slack_channel", str(row.pk))] = {"id": row.pk, "unit_id": row.unit_id,
                "creator_id": row.creator_id, "creator__employee_id": row.creator.employee_id,
                "visibility": row.visibility, "access": rules.get(row.pk)}

    def allows(self, code, unit, resource_id=None, *, require_assurance=True):
        permission = self.permissions.get(code)
        if not permission or not assignment_can_chat(self.assignment):
            return False
        # A channel without a department still obeys the active assignment's
        # role/individual restrictions. Do not borrow another assignment.
        unit = unit or self.assignment.position.unit
        if code not in self.contexts:
            self.contexts[code] = build_authorization_context(self.assignment, permission)
            self.contexts[code].resource_contexts = self.resources
        decision = resolve_access(self.assignment, permission, unit, resource_id=resource_id, context=self.contexts[code])
        # Background notification creation stores only a generic hint. Every
        # REST/socket projection still uses the default, session-enforced path.
        return apply_session_assurance(decision, permission, self.request).allowed if require_assurance else decision.allowed

    def require(self, code, unit, resource_id=None):
        unit = unit or self.assignment.position.unit
        allowed = self.allows(code, unit, resource_id)
        if code in self.permissions and self.request is not None:
            allowed = check_and_log(assignment=self.assignment, permission_code=code, target_unit=unit,
                resource_id=resource_id, resource_type="channel", request=self.request).allowed
        if not allowed:
            raise PermissionDenied("Tu asignación activa no permite esta acción en Slack.")
