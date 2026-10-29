"""Permission-filtered link discovery/backlinks before pagination and counts."""
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from .page_views import PageView, PageListPagination
from .page_models import ChannelPage, PageLink
from .page_links import PageReferences, readable_page_channels


def query(request, allowed):
    if set(request.query_params)-allowed or any(len(request.query_params.getlist(key))!=1 for key in request.query_params):
        raise ValidationError('Usa solo los filtros admitidos y el cursor, sin repetir parámetros.')
    term=request.query_params.get('q','').strip()
    if len(term)>80:
        raise ValidationError('La búsqueda admite hasta 80 caracteres.')
    return term


class PageLinkOptionsView(PageView):
    def get(self, request, channel_id, page_id):
        channel=self.scope(channel_id)
        self.require_write(channel,'slack.page.update')
        source=get_object_or_404(channel.pages,pk=page_id)
        if source.archived_at:
            raise ValidationError('Restaura la página antes de añadir enlaces.')
        term=query(request,{'q','cursor'})
        policy=self.policy()
        rows=ChannelPage.objects.filter(channel_id__in=readable_page_channels(policy),archived_at__isnull=True,
            channel__archived_at__isnull=True).exclude(pk=source.pk).defer('blocks','creation_digest')
        if term:
            rows=rows.filter(title__icontains=term)
        paginator=PageListPagination();selected=paginator.paginate_queryset(rows,request)
        refs=PageReferences(policy);refs.prime(row.pk for row in selected)
        return paginator.get_paginated_response([refs.data(row.pk) for row in selected])


class PageBacklinksView(PageView):
    def get(self, request, channel_id, page_id):
        channel=self.scope(channel_id)
        target=get_object_or_404(channel.pages,pk=page_id)
        query(request,{'cursor'})
        policy=self.policy()
        rows=ChannelPage.objects.filter(channel_id__in=readable_page_channels(policy),outbound_links__target=target).exclude(pk=target.pk).distinct().defer('blocks','creation_digest')
        paginator=PageListPagination();selected=paginator.paginate_queryset(rows,request)
        refs=PageReferences(policy);refs.prime(row.pk for row in selected)
        blocks={row.pk:[] for row in selected}
        for source,block in PageLink.objects.filter(target=target,source_id__in=blocks).order_by('block_id').values_list('source_id','block_id'):
            blocks[source].append(str(block))
        return paginator.get_paginated_response([{**refs.data(row.pk),'block_ids':blocks[row.pk]} for row in selected])
