"""Body-free invalidations over Core's existing authenticated session socket."""
from django.db import transaction
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def publish_reports_changed(*, recipients=None, scope='work'):
    # No task/calendar identifiers, names, counts or state are sent to clients.
    # A hint only invalidates a query; HTTP always rechecks source permissions.
    message={'type':'report.changed','recipients':list(map(str,recipients)) if recipients is not None else None,
             'scope':'definitions' if recipients is not None else scope}
    def send():
        layer=get_channel_layer()
        if layer:async_to_sync(layer.group_send)('reports_watch',message)
    transaction.on_commit(send,robust=True)


def report_assignment_allowed(assignment_id,session_id):
    from types import SimpleNamespace
    from boldApp.core.models import PositionAssignment,Permission
    from boldApp.autenticacion.models import AuthSession
    from boldApp.core.authorization import resolve_access,apply_session_assurance
    assignment=PositionAssignment.objects.select_related('employee__user_account','position__unit').filter(pk=assignment_id).first()
    from .report_pilot import reports_enabled
    if not reports_enabled(assignment):return False
    permission=Permission.objects.filter(code='reports.analytics.run',is_active=True).first()
    if not assignment or not permission:return False
    session=AuthSession.objects.filter(pk=session_id,user_account__employee_id=assignment.employee_id).first()
    return bool(session and apply_session_assurance(resolve_access(assignment,permission,assignment.position.unit),
        permission,SimpleNamespace(auth=session)).allowed)
