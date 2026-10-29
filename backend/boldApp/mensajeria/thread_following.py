"""Personal thread opt-ins; these projections are never read grants."""
from .models import ChannelThreadSubscription


def thread_states(parent_ids, employee_id):
    ids = list(parent_ids)
    states = {str(pk): {"parent_id": str(pk), "following": False, "state_version": 0} for pk in ids}
    for parent, following, revision in ChannelThreadSubscription.objects.filter(
            parent_id__in=ids, employee_id=employee_id, parent__parent__isnull=True).values_list("parent_id", "following", "revision"):
        states[str(parent)].update(following=following, state_version=revision)
    return states


def prime_thread_states(messages, employee_id, policy):
    policy.thread_following = thread_states([row.pk for row in messages if not row.parent_id], employee_id)


def message_thread_state(message, employee_id, policy):
    if message.parent_id:
        return {}
    if not hasattr(policy, "thread_following"):
        policy.thread_following = {}
    if str(message.pk) not in policy.thread_following:
        policy.thread_following.update(thread_states([message.pk], employee_id))
    value = policy.thread_following[str(message.pk)]
    return {"thread_following": value["following"], "thread_state_version": value["state_version"]}
