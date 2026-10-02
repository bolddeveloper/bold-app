from uuid import UUID
from django.core import signing
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound
from rest_framework.pagination import BasePagination
from rest_framework.response import Response
from rest_framework.utils.urls import replace_query_param


class RecentCommentPagination(BasePagination):
    """Signed composite keyset; authorization and count are re-evaluated per page."""
    page_size = 25
    salt = "bold.comments.recent.v1"

    def paginate_queryset(self, queryset, request, view=None):
        self.request = request
        self.total = queryset.count()
        cursor = request.query_params.get("cursor")
        if cursor:
            try:
                if len(cursor) > 1024:
                    raise ValueError()
                date, identifier = signing.loads(cursor, salt=self.salt)
                date, identifier = parse_datetime(date), UUID(identifier)
                if date is None or date.tzinfo is None:
                    raise ValueError()
            except (signing.BadSignature, ValueError, TypeError):
                raise NotFound("Cursor de comentarios no válido.")
            queryset = queryset.filter(Q(created_at__lt=date) | Q(created_at=date, pk__lt=identifier))
        rows = list(queryset.order_by("-created_at", "-pk")[:self.page_size + 1])
        self.has_more = len(rows) > self.page_size
        self.page = rows[:self.page_size]
        return self.page

    def get_paginated_response(self, data):
        next_link = None
        if self.has_more:
            last = self.page[-1]
            cursor = signing.dumps([last.created_at.isoformat(), str(last.pk)], salt=self.salt, compress=True)
            next_link = replace_query_param(self.request.build_absolute_uri(), "cursor", cursor)
        return Response({"count": self.total, "next": next_link,
                         "previous": None, "results": data})
