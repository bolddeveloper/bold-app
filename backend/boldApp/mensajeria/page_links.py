"""Live page references and transactional backlinks, never permission grants."""
import uuid
from django.db import transaction
from django.db.models.signals import pre_save, post_save
from rest_framework.exceptions import NotFound
from .channel_acl import readable_channels
from .page_models import ChannelPage, PageLink
from .channel_models import DepartmentChannel


def readable_page_channels(policy):
    rows=list(readable_channels(DepartmentChannel.objects.select_related('unit','creator'),
        policy.assignment.employee_id, policy.assignment.position.unit_id))
    policy.prime(rows)
    return [row.pk for row in rows if all(policy.allows(code,row.unit,row.pk)
        for code in ('slack.channel.read','slack.page.read'))]


class PageReferences:
    def __init__(self, policy):
        self.policy=policy
        self.rows={}

    def prime(self, identities):
        missing={str(identity) for identity in identities if identity}-self.rows.keys()
        if not missing:
            return
        rows=list(ChannelPage.objects.filter(pk__in=missing).select_related('channel__unit','channel__creator').defer('blocks','creation_digest'))
        self.rows.update(dict.fromkeys(missing))
        self.rows.update({str(row.pk):row for row in rows})
        self.policy.prime({row.channel_id:row.channel for row in rows}.values())

    def data(self, identity):
        self.prime([identity])
        row=self.rows.get(str(identity))
        if not row or not all(self.policy.allows(code,row.channel.unit,row.channel_id)
            for code in ('slack.channel.read','slack.page.read')):
            return {'available':False}
        return {'available':True,'id':str(row.pk),'title':row.title,'icon':row.icon,
                'channel_id':str(row.channel_id),'channel_name':row.channel.name,
                'archived':bool(row.archived_at),'channel_archived':bool(row.channel.archived_at)}

    def require(self, identity):
        if not self.data(identity)['available']:
            raise NotFound('Esta página no está disponible para tu asignación activa.')


def before_page_save(sender, instance, *, raw=False, update_fields=None, using='default', **kwargs):
    instance._link_metadata_changed=False
    if raw or update_fields is not None and not {'title','icon','archived_at'} & set(update_fields):
        return
    previous=sender.objects.using(using).filter(pk=instance.pk).values_list('title','icon','archived_at').first()
    instance._link_metadata_changed=previous is not None and previous!=(instance.title,instance.icon,instance.archived_at)


@transaction.atomic
def after_page_save(sender, instance, *, raw=False, update_fields=None, using='default', **kwargs):
    if raw:
        return
    from .channel_events import publish_page_link_hint
    if update_fields is None or 'blocks' in update_fields:
        wanted={uuid.UUID(row['id']):uuid.UUID(row['page_id']) for row in instance.blocks if row.get('type')=='page'}
        links=PageLink.objects.using(using).filter(source=instance)
        previous=dict(links.values_list('block_id','target_id'))
        if previous!=wanted:
            targets=set(previous.values()) | set(wanted.values())
            target_channels=set(ChannelPage.objects.using(using).filter(pk__in=targets).values_list('channel_id',flat=True))
            links.exclude(block_id__in=wanted).delete()
            PageLink.objects.using(using).bulk_create([PageLink(source=instance,block_id=block,target_id=target) for block,target in wanted.items()],
                update_conflicts=True,update_fields=['target'],unique_fields=['source','block_id'])
            for channel_id in target_channels:
                publish_page_link_hint(channel_id, instance.channel_id)
    if instance._link_metadata_changed:
        for channel_id in PageLink.objects.using(using).filter(target=instance).values_list('source__channel_id',flat=True).distinct():
            publish_page_link_hint(channel_id, instance.channel_id)


def connect():
    pre_save.connect(before_page_save,sender=ChannelPage,dispatch_uid='messaging_page_links:before',weak=False)
    post_save.connect(after_page_save,sender=ChannelPage,dispatch_uid='messaging_page_links:after',weak=False)
