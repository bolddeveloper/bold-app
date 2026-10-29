"""Current source authorization and opaque message-to-page references."""
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from .models import AgreementSource, SearchDocument
from .task_conversions import readable_sources, source_target


def source_parent(view, kind, container_id, *, lock=False):
    return view.conversation(container_id, lock=lock) if kind == 'chat' else view.channel(container_id, lock=lock)


def selected_sources(view, kind, container_id, identities, *, lock=False):
    parent = source_parent(view, kind, container_id, lock=lock)
    messages = {row.pk:row for row in parent.messages.filter(pk__in=identities)}
    field = 'direct_id' if kind == 'chat' else 'channel_message_id'
    documents = {getattr(row, field):row for row in SearchDocument.objects.filter(**{field+'__in':identities}).only('id', field)}
    if len(messages) != len(identities) or len(documents) != len(identities):
        raise NotFound('La selección contiene mensajes que ya no están disponibles en esta conversación.')
    return [(documents[identity], messages[identity]) for identity in identities]


def page_origins(request, page, blocks=None):
    from .access import assignment_can_chat
    if request is None or not assignment_can_chat(getattr(request, 'assignment', None)):
        return []
    rows = list(AgreementSource.objects.filter(agreement__page=page, document__isnull=False).select_related('document').only(
        'id', 'document_id', 'document__id', 'document__direct_id', 'document__channel_message_id', 'block_ids', 'position').order_by('position', 'pk'))
    if not rows:
        return []
    present = {row['id'] for row in (page.blocks if blocks is None else blocks)}
    rows = [row for row in rows if present.intersection(row.block_ids)]
    if not rows:
        return []
    scope = 'chat' if all(row.document.direct_id for row in rows) else 'slack' if all(row.document.channel_message_id for row in rows) else 'all'
    docs = {row.pk:row for row in readable_sources(request, [row.document_id for row in rows], scope).select_related('direct', 'channel_message')}
    return [{'id':str(row.pk), 'block_ids':[identity for identity in row.block_ids if identity in present],
             'target':source_target(docs[row.document_id])} for row in rows if row.document_id in docs]
