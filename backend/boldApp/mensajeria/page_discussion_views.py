"""Versioned, idempotent block comments. Channel lock never changes page text."""
import uuid
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from .page_views import PageView
from .page_discussion_models import PageDiscussion, PageDiscussionComment, PageDiscussionReceipt
from .page_discussions import require_comments, require_author, writable, can_manage_thread, comment_data, thread_data
from .page_content import digest
from .channel_events import publish_channel
from .serializers import StrictInputSerializer
from .views import Conflict


class CommentInput(StrictInputSerializer):
    client_id=serializers.UUIDField()
    body=serializers.CharField(max_length=4000)


class ThreadInput(CommentInput):
    block_id=serializers.UUIDField()


class EditInput(CommentInput):
    version=serializers.IntegerField(min_value=1)


class ActionInput(StrictInputSerializer):
    client_id=serializers.UUIDField()
    version=serializers.IntegerField(min_value=1)


class ResolveInput(ActionInput):
    resolved=serializers.BooleanField()


class ThreadsPagination(CursorPagination):
    page_size=25
    ordering=('-created_at','-id')


class CommentsPagination(CursorPagination):
    page_size=25
    ordering=('-created_at','-id')


class DiscussionView(PageView):
    def page(self,channel_id,page_id,*,lock=False):
        channel=self.scope(channel_id,lock=lock)
        page=get_object_or_404(channel.pages,pk=page_id)
        require_comments(self,channel,'read')
        return channel,page

    def require_mutation(self,channel,page,action):
        require_comments(self,channel,action)
        if not writable(page,channel):
            raise Conflict('La página o el canal está archivado; sus comentarios son de solo lectura.')

    def threads(self,page):
        return PageDiscussion.objects.filter(page=page).select_related('creator','root__author','resolved_by').annotate(comment_count=Count('comments'))

    def thread(self,page,identity):
        return get_object_or_404(self.threads(page),pk=identity)

    def form(self,serializer):
        form=serializer(data=self.request.data);form.is_valid(raise_exception=True)
        return form.validated_data

    def receipt(self,page,kind,values,target=''):
        encoded={key:str(value) if isinstance(value,uuid.UUID) else value for key,value in values.items()}
        hashed=digest({'kind':kind,'target':str(target),**encoded})
        previous=PageDiscussionReceipt.objects.filter(page=page,actor_id=self.actor(),client_id=values['client_id']).first()
        if previous and (previous.digest!=hashed or previous.kind!=kind):
            raise Conflict('Este intento ya fue confirmado con otro comentario o acción.')
        return hashed,previous

    def confirmed(self,page,kind,values,hashed,thread,comment=None):
        return PageDiscussionReceipt.objects.create(page=page,actor_id=self.actor(),client_id=values['client_id'],
            kind=kind,digest=hashed,thread=thread,comment=comment,version=comment.version if comment else thread.version)

    def result(self,page,channel,receipt,*,created=False):
        thread=self.thread(page,receipt.thread_id)
        comment=get_object_or_404(PageDiscussionComment.objects.select_related('author'),pk=receipt.comment_id,thread=thread) if receipt.comment_id else None
        return Response({'thread':thread_data(thread,page,channel,self.policy()),
            'comment':comment_data(comment,page,channel,self.policy()) if comment else None,
            'accepted_version':receipt.version,'created':created},status=201 if created else 200)


class PageDiscussionSummaryView(DiscussionView):
    def get(self,request,channel_id,page_id):
        channel,page=self.page(channel_id,page_id)
        if request.query_params:
            raise ValidationError('El resumen no admite filtros.')
        rows=page.discussions.values('block_id').annotate(open_count=Count('pk',filter=Q(resolved_at__isnull=True)),
            resolved_count=Count('pk',filter=Q(resolved_at__isnull=False)))
        return Response({'page_id':str(page.pk),'can_create':writable(page,channel) and self.policy().allows('slack.page_comment.create',channel.unit,channel.pk),
            'blocks':[{'id':str(row['block_id']),'open':row['open_count'],'resolved':row['resolved_count']} for row in rows]})


class PageDiscussionListView(DiscussionView):
    def get(self,request,channel_id,page_id):
        channel,page=self.page(channel_id,page_id)
        if set(request.query_params)-{'state','block','cursor'} or any(len(request.query_params.getlist(key))!=1 for key in request.query_params):
            raise ValidationError('Usa solo estado, bloque y cursor, sin repetir filtros.')
        state=request.query_params.get('state','open')
        if state not in ('open','resolved','all'):
            raise ValidationError('El estado de la conversación no es válido.')
        rows=self.threads(page)
        if state!='all':
            rows=rows.filter(resolved_at__isnull=state=='open')
        if 'block' in request.query_params:
            block=serializers.UUIDField().run_validation(request.query_params['block'])
            rows=rows.filter(block_id=block)
        pagination=ThreadsPagination();selected=pagination.paginate_queryset(rows,request)
        return pagination.get_paginated_response([thread_data(row,page,channel,self.policy()) for row in selected])

    @transaction.atomic
    def post(self,request,channel_id,page_id):
        channel,page=self.page(channel_id,page_id,lock=True)
        self.require_mutation(channel,page,'create');values=self.form(ThreadInput)
        hashed,previous=self.receipt(page,'thread.create',values)
        if previous:
            return self.result(page,channel,previous)
        if not any(row['id']==str(values['block_id']) for row in page.blocks):
            raise Conflict('El bloque ya no está en la página. Conservamos tu borrador; no se recreará automáticamente.')
        thread=PageDiscussion.objects.create(page=page,block_id=values['block_id'],creator_id=self.actor())
        comment=PageDiscussionComment.objects.create(thread=thread,author_id=self.actor(),body=values['body'])
        thread.root=comment;thread.save(update_fields=['root'])
        receipt=self.confirmed(page,'thread.create',values,hashed,thread,comment)
        publish_channel(channel,'page.comments_changed')
        return self.result(page,channel,receipt,created=True)


class PageDiscussionCommentsView(DiscussionView):
    def get(self,request,channel_id,page_id,thread_id):
        channel,page=self.page(channel_id,page_id);thread=self.thread(page,thread_id)
        if set(request.query_params)-{'cursor'} or any(len(request.query_params.getlist(key))!=1 for key in request.query_params):
            raise ValidationError('Esta conversación solo admite su cursor.')
        rows=thread.comments.select_related('author')
        pagination=CommentsPagination();selected=pagination.paginate_queryset(rows,request)
        response=pagination.get_paginated_response([comment_data(row,page,channel,self.policy()) for row in selected])
        response.data['thread']=thread_data(thread,page,channel,self.policy())
        return response

    @transaction.atomic
    def post(self,request,channel_id,page_id,thread_id):
        channel,page=self.page(channel_id,page_id,lock=True);thread=self.thread(page,thread_id)
        self.require_mutation(channel,page,'create');values=self.form(CommentInput)
        hashed,previous=self.receipt(page,'comment.create',values,thread.pk)
        if previous:
            return self.result(page,channel,previous)
        if thread.resolved_at:
            raise Conflict('La conversación está resuelta. Reábrela antes de responder; el borrador se conserva.')
        comment=PageDiscussionComment.objects.create(thread=thread,author_id=self.actor(),body=values['body'])
        receipt=self.confirmed(page,'comment.create',values,hashed,thread,comment)
        publish_channel(channel,'page.comments_changed')
        return self.result(page,channel,receipt,created=True)


class PageDiscussionResolveView(DiscussionView):
    @transaction.atomic
    def put(self,request,channel_id,page_id,thread_id):
        channel,page=self.page(channel_id,page_id,lock=True);thread=self.thread(page,thread_id)
        self.require_mutation(channel,page,'manage');values=self.form(ResolveInput)
        if not can_manage_thread(thread,page,channel,self.policy()):
            raise PermissionDenied({'detail':'Resolver requiere ser quien inició el hilo o tener edición de la página.','resource':'page_comments'})
        hashed,previous=self.receipt(page,'thread.resolve',values,thread.pk)
        if previous:
            return self.result(page,channel,previous)
        if thread.version!=values['version']:
            return Response({'detail':'El estado cambió. Revisa la conversación antes de resolverla o reabrirla.',
                'current_thread':thread_data(thread,page,channel,self.policy())},status=409)
        if bool(thread.resolved_at)!=values['resolved']:
            thread.resolved_at=timezone.now() if values['resolved'] else None
            thread.resolved_by_id=self.actor() if values['resolved'] else None
            thread.version+=1;thread.save(update_fields=['resolved_at','resolved_by','version'])
            publish_channel(channel,'page.comments_changed')
        receipt=self.confirmed(page,'thread.resolve',values,hashed,thread)
        return self.result(page,channel,receipt)


class PageDiscussionCommentView(DiscussionView):
    @transaction.atomic
    def put(self,request,channel_id,page_id,comment_id):
        return self.change(request,channel_id,page_id,comment_id,False)

    def change(self,request,channel_id,page_id,comment_id,deleting):
        channel,page=self.page(channel_id,page_id,lock=True)
        comment=get_object_or_404(PageDiscussionComment.objects.select_related('author','thread'),pk=comment_id,thread__page=page)
        # Hard authorship boundary precedes Core's owner/admin permission bypass.
        require_author(self,comment)
        self.require_mutation(channel,page,'delete' if deleting else 'update')
        values=self.form(ActionInput if deleting else EditInput)
        kind='comment.delete' if deleting else 'comment.edit'
        hashed,previous=self.receipt(page,kind,values,comment.pk)
        if previous:
            return self.result(page,channel,previous)
        if comment.version!=values['version']:
            return Response({'detail':'Tu comentario cambió en otra sesión. El texto local sigue conservado.',
                'current_comment':comment_data(comment,page,channel,self.policy())},status=409)
        if not deleting and comment.deleted_at:
            raise Conflict('El comentario está eliminado y no puede recuperarse mediante una edición.')
        if deleting and not comment.deleted_at:
            comment.body='';comment.deleted_at=timezone.now();comment.version+=1
            comment.save(update_fields=['body','deleted_at','version'])
            publish_channel(channel,'page.comments_changed')
        elif not deleting and comment.body!=values['body']:
            comment.body=values['body'];comment.edited_at=timezone.now();comment.version+=1
            comment.save(update_fields=['body','edited_at','version'])
            publish_channel(channel,'page.comments_changed')
        receipt=self.confirmed(page,kind,values,hashed,comment.thread,comment)
        return self.result(page,channel,receipt)


class PageDiscussionDeleteView(PageDiscussionCommentView):
    http_method_names=['post','options']

    @transaction.atomic
    def post(self,request,channel_id,page_id,comment_id):
        return self.change(request,channel_id,page_id,comment_id,True)
