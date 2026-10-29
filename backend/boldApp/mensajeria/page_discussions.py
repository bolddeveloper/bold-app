"""Current page ACL plus strict authorship; owner/admin never edits another body."""
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from .page_discussion_models import PageDiscussion, PageDiscussionComment


def require_comments(view, channel, action):
    try:
        view.policy().require('slack.page_comment.'+action,channel.unit,channel.pk)
    except PermissionDenied:
        raise PermissionDenied({'detail':'Tu asignación no permite esta acción en los comentarios de páginas.','resource':'page_comments','action':action})


def require_author(view, comment):
    if comment.author_id!=view.request.assignment.employee_id:
        raise PermissionDenied({'detail':'Solo el autor puede editar o eliminar este comentario.','resource':'page_comments'})


def writable(page,channel):
    return not page.archived_at and not channel.archived_at


def can_manage_thread(thread,page,channel,policy):
    return writable(page,channel) and policy.allows('slack.page_comment.manage',channel.unit,channel.pk) and (
        thread.creator_id==policy.assignment.employee_id or policy.allows('slack.page.update',channel.unit,channel.pk))


def author_data(employee):
    return {'id':str(employee.pk),'name':employee.full_name}


def comment_data(comment,page,channel,policy):
    own=comment.author_id==policy.assignment.employee_id and not comment.deleted_at and writable(page,channel)
    return {'id':str(comment.pk),'thread_id':str(comment.thread_id),'body':'' if comment.deleted_at else comment.body,
        'version':comment.version,'author':author_data(comment.author),'created_at':comment.created_at,
        'edited_at':comment.edited_at,'deleted_at':comment.deleted_at,
        'can_edit':bool(own and policy.allows('slack.page_comment.update',channel.unit,channel.pk)),
        'can_delete':bool(own and policy.allows('slack.page_comment.delete',channel.unit,channel.pk))}


def thread_data(thread,page,channel,policy):
    return {'id':str(thread.pk),'page_id':str(page.pk),'block_id':str(thread.block_id),'version':thread.version,
        'creator':author_data(thread.creator),'created_at':thread.created_at,'resolved_at':thread.resolved_at,
        'resolved_by':author_data(thread.resolved_by) if thread.resolved_by_id else None,
        'anchor_present':any(row['id']==str(thread.block_id) for row in page.blocks),
        'can_reply':writable(page,channel) and not thread.resolved_at and policy.allows('slack.page_comment.create',channel.unit,channel.pk),
        'can_resolve':can_manage_thread(thread,page,channel,policy),
        'root':comment_data(thread.root,page,channel,policy) if thread.root_id else None,
        'reply_count':max(0,getattr(thread,'comment_count',1)-1)}


def discussion_draft(view,scope):
    channel=view.channel(scope['channel_id'])
    view.policy().require('slack.page.read',channel.unit,channel.pk)
    page=get_object_or_404(channel.pages,pk=scope['resource_id'])
    require_comments(view,channel,'read')
    mode=scope['mode'];parent=scope['parent_id'];policy=view.policy()
    if mode=='root':
        # An author may recover their own private text after a remote block
        # deletion, but this key never grants authority to recreate that block.
        return writable(page,channel) and any(row['id']==parent for row in page.blocks) and policy.allows('slack.page_comment.create',channel.unit,channel.pk)
    if mode=='reply':
        thread=get_object_or_404(PageDiscussion,page=page,pk=parent)
        return writable(page,channel) and not thread.resolved_at and policy.allows('slack.page_comment.create',channel.unit,channel.pk)
    comment=get_object_or_404(PageDiscussionComment,thread__page=page,pk=parent,author_id=view.actor())
    return writable(page,channel) and not comment.deleted_at and policy.allows('slack.page_comment.update',channel.unit,channel.pk)
