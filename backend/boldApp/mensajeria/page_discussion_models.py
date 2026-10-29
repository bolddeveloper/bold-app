"""Block conversations live outside page content, revisions and the CRDT."""
from django.db import models
from boldApp.core.models.mixins import UUIDPrimaryKeyModel


class PageDiscussion(UUIDPrimaryKeyModel):
    page=models.ForeignKey('boldApp_mensajeria.ChannelPage',on_delete=models.PROTECT,related_name='discussions')
    block_id=models.UUIDField()
    creator=models.ForeignKey('boldApp_core.Employee',on_delete=models.PROTECT)
    root=models.OneToOneField('boldApp_mensajeria.PageDiscussionComment',null=True,on_delete=models.PROTECT,related_name='root_for')
    version=models.PositiveIntegerField(default=1)
    resolved_at=models.DateTimeField(null=True)
    resolved_by=models.ForeignKey('boldApp_core.Employee',null=True,on_delete=models.PROTECT,related_name='+')
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table='messaging_page_discussions'
        indexes=[models.Index(fields=['page','-created_at','-id'],name='slack_discussion_list')]


class PageDiscussionComment(UUIDPrimaryKeyModel):
    thread=models.ForeignKey(PageDiscussion,on_delete=models.PROTECT,related_name='comments')
    author=models.ForeignKey('boldApp_core.Employee',on_delete=models.PROTECT)
    body=models.TextField()
    version=models.PositiveIntegerField(default=1)
    created_at=models.DateTimeField(auto_now_add=True)
    edited_at=models.DateTimeField(null=True)
    deleted_at=models.DateTimeField(null=True)

    class Meta:
        db_table='messaging_page_discussion_comments'
        indexes=[models.Index(fields=['thread','created_at','id'],name='slack_discussion_comments')]


class PageDiscussionReceipt(UUIDPrimaryKeyModel):
    page=models.ForeignKey('boldApp_mensajeria.ChannelPage',on_delete=models.PROTECT)
    actor=models.ForeignKey('boldApp_core.Employee',on_delete=models.PROTECT)
    client_id=models.UUIDField()
    kind=models.CharField(max_length=24)
    digest=models.CharField(max_length=64)
    thread=models.ForeignKey(PageDiscussion,on_delete=models.PROTECT)
    comment=models.ForeignKey(PageDiscussionComment,null=True,on_delete=models.PROTECT)
    version=models.PositiveIntegerField()
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table='messaging_page_discussion_receipts'
        constraints=[models.UniqueConstraint(fields=['page','actor','client_id'],name='slack_discussion_receipt')]
