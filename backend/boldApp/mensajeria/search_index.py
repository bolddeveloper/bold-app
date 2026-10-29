"""Synchronous projections share the source transaction; no polling/index service."""
from django.db.models.signals import post_save
from .models import DirectMessage, ChannelMessage, ChannelPage, MessageMedia, ChannelMedia, SearchDocument
from .search_text import message_text, normalized_text, page_text
from .resource_links_v1 import resource_links


def index_source(sender, instance, *, raw=False, using="default", **kwargs):
    if raw:
        return
    source = instance.message if sender in (MessageMedia, ChannelMedia) else instance
    field = "direct" if isinstance(source, DirectMessage) else "channel_message" if isinstance(source, ChannelMessage) else "page"
    text = page_text(source) if field == "page" else message_text(source)
    SearchDocument.objects.using(using).update_or_create(**{field: source}, defaults={
        "text": normalized_text(text), "created_at": source.created_at,
        "has_links": field != "page" and bool(resource_links(source.body)),
    })


def connect():
    for model in (DirectMessage, ChannelMessage, ChannelPage, MessageMedia, ChannelMedia):
        post_save.connect(index_source, sender=model, dispatch_uid="messaging_search:" + model._meta.label, weak=False)
