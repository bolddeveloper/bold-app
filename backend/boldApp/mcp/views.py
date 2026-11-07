import secrets
import uuid
from datetime import timedelta

from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from django.views.decorators.cache import never_cache
from mcp.server.auth.provider import construct_redirect_uri
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import APIView

from boldApp.administrativo.services import record_system_event
from boldApp.autenticacion.authentication import CookieSessionAuthentication
from boldApp.autenticacion.services import token_hash
from boldApp.core.models import PositionAssignment
from .authentication import validate_authorization
from .catalog import MODULES
from .models import McpAuthorization
from .oauth import grant_queryset


@require_http_methods(["GET", "POST"])
@csrf_protect
@never_cache
def consent(request):
    from django.conf import settings
    from django.http import Http404
    if not settings.MCP_ENABLED:
        raise Http404
    context = {"modules": list(MODULES.values()), "request_id": request.GET.get("request", "")}
    authorization = get_object_or_404(
        grant_queryset(), request_hash=token_hash(context["request_id"]),
        expires_at__gt=timezone.now(), code_hash__isnull=True, revoked_at__isnull=True,
    )
    context["client_name"] = authorization.client.metadata.get("client_name", "Aplicación MCP")
    try:
        identity = CookieSessionAuthentication().authenticate(request)
        if not identity:
            context["login_required"] = True
            return render(request, "bold_mcp/consent.html", context)
        user, session = identity
        assignments = PositionAssignment.objects.filter(
            employee_id=user.employee_id, employee__is_active=True,
            is_active=True, released_at__isnull=True,
        ).select_related("position__unit", "position__job_role")
        context.update(user=user, assignments=assignments, write_requested="bold.write" in authorization.scopes)
        if request.method == "POST":
            with transaction.atomic():
                authorization = grant_queryset().select_for_update(of=("self",)).get(pk=authorization.pk)
                if authorization.code_hash or authorization.revoked_at or authorization.expires_at <= timezone.now():
                    context["error"] = "La solicitud ya se utilizó o expiró. Inicia de nuevo la conexión."
                    return render(request, "bold_mcp/consent.html", context, status=400)
                parameters = authorization.parameters
                if request.POST.get("decision") != "allow":
                    authorization.revoked_at = timezone.now()
                    authorization.save(update_fields=["revoked_at"])
                    return HttpResponseRedirect(construct_redirect_uri(
                        parameters["redirect_uri"], error="access_denied", state=parameters.get("state"),
                    ))
                try:
                    assignment_id = uuid.UUID(request.POST.get("assignment", ""))
                except (ValueError, TypeError):
                    context["error"] = "Selecciona una asignación válida."
                    return render(request, "bold_mcp/consent.html", context, status=400)
                assignment = get_object_or_404(assignments, pk=assignment_id)
                authorization.session = session
                authorization.assignment = assignment
                validate_authorization(authorization)
                if request.POST.get("write") != "yes":
                    authorization.scopes = ["bold.read"]
                code = secrets.token_urlsafe(32)
                authorization.code_hash = token_hash(code)
                authorization.expires_at = timezone.now() + timedelta(minutes=5)
                authorization.save()
                request.user = user
                record_system_event(
                    "mcp.authorization.approved", request, module_code="mcp", actor=user,
                    target_type="mcp_authorization", target_id=authorization.pk,
                    metadata={"scopes": authorization.scopes, "assignment": str(assignment.pk)},
                )
                return HttpResponseRedirect(construct_redirect_uri(
                    parameters["redirect_uri"], code=code, state=parameters.get("state"),
                ))
    except APIException as error:
        context["error"] = str(error.detail)
    response = render(request, "bold_mcp/consent.html", context)
    response["Cache-Control"] = "no-store"
    response["Referrer-Policy"] = "same-origin"
    return response


class ConnectionsView(APIView):
    def get(self, request):
        rows = McpAuthorization.objects.filter(session__user_account=request.user, consumed_at__isnull=False)
        return Response({"results": [{
            "id": str(row.pk), "client_name": row.client.metadata.get("client_name", "Aplicación MCP"),
            "assignment_id": str(row.assignment_id), "scopes": row.scopes,
            "created_at": row.created_at, "revoked_at": row.revoked_at,
            "expires_at": row.session.expires_at,
        } for row in rows.select_related("client", "session").order_by("-created_at")[:100]]})

    def delete(self, request, authorization_id):
        row = get_object_or_404(McpAuthorization, pk=authorization_id, session__user_account=request.user)
        row.revoked_at = timezone.now()
        row.save(update_fields=["revoked_at"])
        record_system_event(
            "mcp.authorization.revoked", request, module_code="mcp",
            target_type="mcp_authorization", target_id=row.pk,
        )
        return Response(status=204)
