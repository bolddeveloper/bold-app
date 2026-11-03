"""Personal thread opt-ins; these projections are never read grants."""
from .models import ChannelThreadSubscription
from boldApp.core.models import Employee


def preference_data(row=None, parent_id=None):
    return {"parent_id": str(row.parent_id if row else parent_id), "following": row.following if row else False,
        "state_version": row.revision if row else 0, "favorite": row.favorite if row else False,
        "left": row.left if row else False, "notifications": row.notification_level if row else "inherit",
        "muted_until": row.muted_until if row else None, "muted_forever": row.muted_forever if row else False}


def thread_states(parent_ids, employee_id):
    ids = list(parent_ids)
    states = {str(pk): preference_data(parent_id=pk) for pk in ids}
    for row in ChannelThreadSubscription.objects.filter(parent_id__in=ids, employee_id=employee_id, parent__parent__isnull=True):
        states[str(row.parent_id)] = preference_data(row)
    return states


def prime_thread_states(messages, employee_id, policy):
    policy.thread_following = thread_states([row.pk for row in messages if not row.parent_id], employee_id)
    ids = {row.thread_starter_id for row in messages if row.thread_starter_id}
    policy.thread_starters = {str(pk): name for pk, name in Employee.objects.filter(pk__in=ids).values_list("pk", "full_name")} if ids else {}


def message_thread_state(message, employee_id, policy):
    if message.parent_id:
        return {}
    if not hasattr(policy, "thread_following"):
        policy.thread_following = {}
    if str(message.pk) not in policy.thread_following:
        policy.thread_following.update(thread_states([message.pk], employee_id))
    value = policy.thread_following[str(message.pk)]
    starters = getattr(policy, "thread_starters", {})
    starter_id = str(message.thread_starter_id) if message.thread_starter_id else None
    if starter_id and starter_id not in starters:
        starters[starter_id] = Employee.objects.filter(pk=starter_id).values_list("full_name", flat=True).first()
        policy.thread_starters = starters
    return {"thread_following": value["following"], "thread_state_version": value["state_version"], "thread_starter_name": starters.get(starter_id),
        **{"thread_" + key: value[key] for key in ("favorite", "left", "notifications", "muted_until", "muted_forever")}}
