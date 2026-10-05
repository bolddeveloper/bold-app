"""Read published revisions and associate links without publishing or changing access."""
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit, parse_qs, urlencode

from rest_framework.exceptions import PermissionDenied, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import GoogleConnection, PublishedView
from .service import MIMES, google, metadata, file_id, Reconnect, GoogleUnavailable
from .views import audit


class IframeSource(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == "iframe":
            self.sources.extend(value for key, value in attrs if key == "src")


def published_url(value, kind):
    if not isinstance(value, str) or len(value) > 10000:
        raise ValidationError("Introduce un enlace publicado o su código iframe.")
    value = value.strip()
    if value.startswith("<"):
        parser = IframeSource()
        parser.feed(value)
        if len(parser.sources) != 1:
            raise ValidationError("Pega un único iframe con un enlace publicado.")
        value = parser.sources[0]
    try:
        url = urlsplit(value)
        valid = len(value) <= 2048 and url.scheme == "https" and url.netloc == "docs.google.com" and not url.fragment
    except ValueError:
        valid = False
    prefix, endings, endpoint = {
        "docs": ("document", "pub", "pub"),
        "sheets": ("spreadsheets", "pub|pubhtml", "pubhtml"),
        "slides": ("presentation", "pub|embed", "embed"),
    }[kind]
    match = re.fullmatch(rf"/{prefix}/d/(?:e/)?[A-Za-z0-9_-]+/({endings})", url.path) if valid else None
    if not match:
        raise ValidationError("Usa un enlace HTTPS publicado de Google compatible con este tipo de archivo.")
    query = parse_qs(url.query)
    allowed = {"docs": {"embedded"}, "sheets": {"gid", "single", "widget", "headers"}, "slides": {"start", "loop", "delayms"}}[kind]
    clean = {key: values[0] for key, values in query.items() if key in allowed and re.fullmatch(r"[0-9]+|true|false", values[0])}
    if kind == "docs":
        clean["embedded"] = "true"
    path = url.path[:url.path.rfind("/") + 1] + endpoint
    return "https://docs.google.com" + path + ("?" + urlencode(clean) if clean else "")


class PublishedViewView(APIView):
    def scope(self, request, identity):
        identity = file_id(identity)
        connection = GoogleConnection.objects.filter(user=request.user).first()
        if not connection:
            raise Reconnect()
        item = metadata(request.user, identity)
        kind = next((key for key in ("docs", "sheets", "slides") if MIMES[key] == item.get("mimeType")), None)
        if not kind or item.get("trashed"):
            raise ValidationError("Selecciona un archivo nativo de Google disponible.")
        return {"user": request.user, "google_subject": connection.subject, "file_id": identity}, kind

    def get(self, request, identity):
        scope, kind = self.scope(request, identity)
        association = PublishedView.objects.filter(**scope).first()
        state, detected, page = "unknown", "", ""
        known = False
        try:
            # Bound latency; incomplete pagination remains unknown, never falsely unpublished.
            for _ in range(10):
                result = google(request.user, "GET", f"/files/{identity}/revisions", params={"fields": "nextPageToken,revisions(id,published,publishedLink)", "pageSize": 100, **({"pageToken": page} if page else {})})
                for revision in result.get("revisions", []):
                    known = known or "published" in revision
                    if revision.get("published"):
                        state = "published"
                        if revision.get("publishedLink"):
                            try:
                                detected = published_url(revision["publishedLink"], kind)
                            except ValidationError:
                                pass
                page = result.get("nextPageToken", "")
                if not page:
                    # Only explicit published fields establish a known unpublished status.
                    if state != "published" and known:
                        state = "unpublished"
                    break
        except (PermissionDenied, NotFound, GoogleUnavailable, ValidationError):
            state, detected = "unknown", ""
        manual = association.embed_url if association else ""
        response = Response({"state": state, "embed_url": detected or (manual if state != "unpublished" else ""), "associated_url": manual, "source": "google" if detected else "manual" if manual else "none", "verified": bool(detected), "kind": kind})
        response["Cache-Control"] = "private, no-store"
        return response

    def put(self, request, identity):
        scope, kind = self.scope(request, identity)
        if not isinstance(request.data, dict):
            raise ValidationError("Envía un enlace publicado.")
        url = published_url(request.data.get("url"), kind)
        PublishedView.objects.update_or_create(**scope, defaults={"embed_url": url})
        audit(request, "published_view_associated", identity)
        return self.get(request, identity)

    def delete(self, request, identity):
        scope, _ = self.scope(request, identity)
        PublishedView.objects.filter(**scope).delete()
        audit(request, "published_view_removed", identity)
        return Response(status=204)
