"""Conversation references preserve both independent read boundaries."""
from django.shortcuts import get_object_or_404
from .models import SearchDocument
from .search_views import HistorySearchView


def source_target(document):
    if document.direct_id:
        return {"kind":"chat", "conversation_id":str(document.direct.conversation_id), "message_id":str(document.direct_id)}
    message = document.channel_message
    return {"kind":"channel", "channel_id":str(message.channel_id), "message_id":str(message.pk),
        "parent_id":str(message.parent_id) if message.parent_id else None}


def readable_sources(request, candidates, scope="all"):
    view = HistorySearchView();view.request = request
    return view.visible_documents({"scope":scope, "kind":"all", "archived":True}).filter(pk__in=candidates)


def source_document(view, values, *, lock=False):
    # Bind to the exact parent before taking a content snapshot. The same locks
    # serialize edits/reactions/receipts; owner status never grants DM membership.
    if values["kind"] == "chat":
        parent = view.conversation(values["container_id"], lock=lock)
        message = get_object_or_404(parent.messages, pk=values["message_id"])
        field = "direct"
    else:
        parent = view.channel(values["container_id"], lock=lock)
        message = get_object_or_404(parent.messages, pk=values["message_id"])
        field = "channel_message"
    document = get_object_or_404(SearchDocument.objects.only("id"), **{field:message})
    return document, message


def task_origins(request, task):
    from .access import assignment_can_chat
    if not assignment_can_chat(getattr(request, "assignment", None)):
        return []
    rows = list(task.message_conversions.filter(document__isnull=False).select_related("document").only(
        "id", "created_at", "document_id", "document__id", "document__direct_id", "document__channel_message_id").order_by("created_at", "pk"))
    if not rows:
        return []
    # Do not disclose even the existence/count of another person's private DM.
    scope = "chat" if all(row.document.direct_id for row in rows) else "slack" if all(row.document.channel_message_id for row in rows) else "all"
    visible = readable_sources(request, [row.document_id for row in rows], scope)
    documents = {row.pk:row for row in visible.select_related("direct", "channel_message")}
    return [{"id":str(row.pk), "created_at":row.created_at, "target":source_target(documents[row.document_id])}
        for row in rows if row.document_id in documents]
