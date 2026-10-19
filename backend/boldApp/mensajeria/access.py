"""Fail-closed pilot boundary, independent of role/owner privileges."""
from django.conf import settings
from rest_framework.permissions import BasePermission


def assignment_can_chat(assignment):
    return bool(assignment and assignment.is_active and assignment.released_at is None
                and assignment.employee.is_active
                and (not settings.MESSAGING_PILOT_ENABLED
                     or str(assignment.position.unit_id) in settings.MESSAGING_PILOT_UNIT_IDS))


def eligible_people(queryset):
    if not settings.MESSAGING_PILOT_ENABLED:
        return queryset
    return queryset.filter(position_assignments__is_active=True,
        position_assignments__released_at__isnull=True,
        position_assignments__position__unit_id__in=settings.MESSAGING_PILOT_UNIT_IDS,
        is_active=True, user_account__is_active=True).distinct()


class CanUseChatPilot(BasePermission):
    message = "Chat está disponible temporalmente solo para el departamento de IT."

    def has_permission(self, request, view):
        return assignment_can_chat(getattr(request, "assignment", None))
