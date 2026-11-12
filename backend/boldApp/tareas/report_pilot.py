"""Rollout boundary, separate from data permissions and organization hierarchy."""
from django.conf import settings


def reports_enabled(assignment):
    if not assignment or not assignment.is_active or assignment.released_at or not assignment.employee.is_active:
        return False
    return not settings.REPORTS_PILOT_ENABLED or str(assignment.position.unit_id).lower() in settings.REPORTS_PILOT_UNIT_IDS
