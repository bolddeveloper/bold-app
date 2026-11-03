from .views import Conflict


def require_thread_reply(parent):
    if parent and (parent.thread_closed_at or parent.thread_locked or parent.thread_deleted_at):
        raise Conflict("Este hilo está cerrado, bloqueado o en Eliminados. Su historial se conserva; vuelve a abrirlo antes de responder.")


def thread_permissions(message, policy):
    channel = message.channel
    manageable = not channel.archived_at and policy.allows("slack.channel.manage", channel.unit, channel.pk)
    writable = not channel.archived_at and policy.allows("slack.message.create", channel.unit, channel.pk)
    owner = policy.assignment.employee_id in (message.author_id, message.thread_starter_id)
    return {"can_manage_thread": manageable, "can_edit_thread": manageable or owner and writable,
        "can_close_thread": not message.thread_deleted_at and (manageable or writable and not message.thread_locked),
        "can_reply_thread": writable and not (message.thread_closed_at or message.thread_locked or message.thread_deleted_at)}
