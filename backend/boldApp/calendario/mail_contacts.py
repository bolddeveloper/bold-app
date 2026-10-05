"""Suggest addresses from the current user's Gmail headers, without reading message bodies."""
import json
import time
from email.header import decode_header, make_header
from email.utils import getaddresses
from urllib.parse import quote
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as InvalidEmail
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from boldApp.workspace.google_config import public_connection
from boldApp.workspace.service import google, Reconnect
from .service import CalendarReconnect


class CalendarMailContactSearchView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "calendar_contacts"

    def get(self, request):
        connection = public_connection(request.user)
        if connection["services"]["gmail"]["status"] != "available":
            raise CalendarReconnect("Conecta los servicios de Google y autoriza Gmail para buscar direcciones de mensajes.")
        query = request.query_params.get("q", "").strip()
        if len(query) > 100 or any(ord(char) < 32 for char in query):
            raise ValidationError("La búsqueda no es válida.")
        if len(query) < 2:
            return Response({"contacts": []})
        term = json.dumps(query, ensure_ascii=False)
        expression = "{" + " ".join(f"{field}:{term}" for field in ("from", "to", "cc", "bcc")) + "}"
        start = time.monotonic()
        result = google(request.user, "GET", "/users/me/messages", api="gmail", params={"q": expression, "maxResults": 5, "includeSpamTrash": "false", "fields": "messages(id)"}, timeout=3)
        contacts, partial = {}, False
        # ponytail: inspect five matching messages; paginate if broader recipient coverage is needed.
        for message in result.get("messages", [])[:5]:
            remaining = 8 - (time.monotonic() - start)
            if remaining <= 0:
                partial = True
                break
            try:
                metadata = google(request.user, "GET", "/users/me/messages/" + quote(message["id"], safe=""), api="gmail", params={"format": "metadata", "metadataHeaders": ["From", "To", "Cc", "Bcc"], "fields": "payload(headers)"}, timeout=min(3, remaining))
            except Reconnect:
                raise
            except APIException:
                partial = True
                break
            headers = [row.get("value", "") for row in metadata.get("payload", {}).get("headers", []) if row.get("name", "").lower() in ("from", "to", "cc", "bcc")]
            for name, email in getaddresses(headers):
                email = email.strip().lower()
                try:
                    validate_email(email)
                except InvalidEmail:
                    continue
                if email == connection["email"].lower():
                    continue
                try:
                    name = str(make_header(decode_header(name)))
                except (LookupError, UnicodeError):
                    name = ""
                contacts[email] = {"email": email, "name": (name or contacts.get(email, {}).get("name", ""))[:200], "source": "gmail"}
        return Response({"contacts": list(contacts.values())[:40], "warning": "Gmail respondió parcialmente. Puedes reintentar." if partial else ""})
