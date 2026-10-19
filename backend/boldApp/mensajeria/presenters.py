from django.db.models import Prefetch
from boldApp.core.models import Employee, PositionAssignment


def people():
    return Employee.objects.select_related("user_account").prefetch_related(
        Prefetch("position_assignments", queryset=PositionAssignment.objects.filter(
            is_active=True, released_at__isnull=True
        ).select_related("position__unit"), to_attr="chat_assignments")
    )


def available(employee):
    account = getattr(employee, "user_account", None)
    return bool(employee.is_active and account and account.is_active and employee.chat_assignments)


def person_data(employee):
    account = getattr(employee, "user_account", None)
    return {"employee_id": str(employee.pk), "name": employee.full_name,
            "avatar_url": account.avatar_url if account else None, "available": available(employee),
            "departments": sorted({row.position.unit.name for row in employee.chat_assignments})}


def message_data(message, actor_id, now):
    return {"id": str(message.pk), "conversation_id": str(message.conversation_id),
            "author_id": str(message.author_id), "client_id": str(message.client_id),
            "body": message.body, "created_at": message.created_at,
            "edited_at": message.edited_at, "version": message.version,
            "editable_until": message.editable_until,
            "can_edit": str(message.author_id) == str(actor_id) and now < message.editable_until,
            "delivered_at": message.delivered_at, "read_at": message.read_at}
