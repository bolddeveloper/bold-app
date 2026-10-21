"""Bounded, deduplicated invitation identities; never a grant to the pilot."""
from django.db.models import Prefetch
from boldApp.core.models import PositionAssignment
from .channel_views import department_data


def with_identity(rows):
    return rows.select_related("user_account").prefetch_related(Prefetch("position_assignments",
        queryset=PositionAssignment.objects.filter(is_active=True, released_at__isnull=True)
            .select_related("position__unit").order_by("position__unit__name", "position__unit_id"), to_attr="invitation_assignments"))


def person_data(person):
    account = getattr(person, "user_account", None)
    units = {str(row.position.unit_id): department_data(row.position.unit) for row in person.invitation_assignments}
    return {"employee_id": str(person.pk), "name": person.full_name,
        "avatar_url": account.avatar_url if account else None, "email": account.email if account else "",
        "departments": list(units.values())}
