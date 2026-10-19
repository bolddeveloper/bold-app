"""Recipient-only unread projections; versions prevent late socket/HTTP rollback."""
from django.db.models import Count, OuterRef, Subquery, IntegerField, Value
from django.db.models.functions import Coalesce
from .models import DirectMessage


def summaries(conversations, employee_id):
    unread = DirectMessage.objects.filter(conversation_id=OuterRef("pk"), read_at__isnull=True).exclude(
        author_id=employee_id).order_by().values("conversation_id").annotate(total=Count("pk")).values("total")
    rows = conversations.order_by().annotate(unread_count=Coalesce(Subquery(unread, output_field=IntegerField()), Value(0)))
    return [{"conversation_id": str(row.pk),
             "employee_id": str(row.second_employee_id if str(row.first_employee_id) == str(employee_id) else row.first_employee_id),
             "count": row.unread_count, "version": row.activity_version}
            for row in rows]
