from rest_framework.response import Response
from django.conf import settings
from boldApp.autenticacion.services import issue_ws_ticket
from .page_views import PageView


class PageTicketView(PageView):
    def post(self, request, channel_id, page_id):
        from django.shortcuts import get_object_or_404
        channel = self.scope(channel_id)
        page = get_object_or_404(channel.pages, pk=page_id)
        ticket = issue_ws_ticket(request.user, request.auth, request.assignment.pk, page.pk, "slack_pages")
        return Response({"ticket": ticket, "expires_in": settings.AUTH_WEBSOCKET_TICKET_TTL_SECONDS})
