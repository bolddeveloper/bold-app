"""Personal channel attention, not read receipts exposed to other employees."""
from django.db.models import Count, F, OuterRef, PositiveBigIntegerField, Q, Subquery, Value
from django.db.models.functions import Coalesce

from .models import ChannelMessage, ChannelReadState, ChannelSubscription, ChannelThreadReadState


def unread_messages(employee_id, channel_ids=None):
    roots = ChannelReadState.objects.filter(employee_id=employee_id, channel_id=OuterRef("channel_id"))
    threads = ChannelThreadReadState.objects.filter(employee_id=employee_id, parent_id=OuterRef("parent_id"))
    rows = ChannelMessage.objects.exclude(author_id=employee_id)
    if channel_ids is not None:
        rows = rows.filter(channel_id__in=channel_ids)
    return rows.annotate(
        root_cursor=Coalesce(Subquery(roots.values("sequence")[:1]), Value(0), output_field=PositiveBigIntegerField()),
        thread_cursor=Coalesce(Subquery(threads.values("sequence")[:1]), Value(0), output_field=PositiveBigIntegerField()),
    ).filter(Q(parent__isnull=True, sequence__gt=F("root_cursor")) | Q(parent__isnull=False, sequence__gt=F("thread_cursor")))


def channel_states(channels, employee_id):
    ids = [row.pk for row in channels]
    result = {str(value): {"unread_count": 0, "following": False, "state_version":0} for value in ids}
    for row in unread_messages(employee_id, ids).order_by().values("channel_id").annotate(total=Count("pk")):
        result[str(row["channel_id"])]["unread_count"] = row["total"]
    for value,following,revision in ChannelSubscription.objects.filter(employee_id=employee_id, channel_id__in=ids).values_list("channel_id", "following", "revision"):
        result[str(value)].update(following=following,state_version=revision)
    return result


def thread_counts(parent_ids, employee_id):
    return {str(row["parent_id"]): row["total"] for row in unread_messages(employee_id)
        .filter(parent_id__in=parent_ids).order_by().values("parent_id").annotate(total=Count("pk"))}
