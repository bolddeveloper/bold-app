import uuid

from django.db import models, transaction
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from boldApp.core.authorization import build_authorization_context, check_and_log, resolve_access
from boldApp.core.models import OrganizationalUnit, Permission
from boldApp.core.permissions import HasActiveAssignment

from .models import Suggestion, SuggestionEvent
from .serializers import SuggestionAuthorUpdateSerializer, SuggestionReviewSerializer, SuggestionSerializer
from .screenshots import screenshot_response


class SuggestionPagination(PageNumberPagination):
    page_size = 25


class SuggestionViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    permission_classes = [HasActiveAssignment]
    serializer_class = SuggestionSerializer
    pagination_class = SuggestionPagination

    @action(detail=True, methods=["get"], url_path="screenshots")
    def screenshots(self, request, pk=None):
        return screenshot_response(self.get_object().screenshots, request.query_params.get("image"), request)

    def get_throttles(self):
        if self.action == "create":
            self.throttle_scope = "suggestions_create"
            return [ScopedRateThrottle()]
        return []

    def _can(self, code, unit, resource_id=None, *, log=False):
        if log:
            return check_and_log(
                assignment=self.request.assignment, permission_code=code,
                target_unit=unit, resource_id=resource_id,
                resource_type="feedback", request=self.request,
            ).allowed
        if not hasattr(self, "_authorization"):
            self._authorization = {}
        if code not in self._authorization:
            permission = Permission.objects.filter(code=code, is_active=True).first()
            self._authorization[code] = (permission, build_authorization_context(self.request.assignment, permission) if permission else None)
        permission, context = self._authorization[code]
        if permission is None:
            return False
        return resolve_access(
            self.request.assignment, permission, unit,
            resource_id=resource_id, context=context,
        ).allowed

    def get_queryset(self):
        base = Suggestion.objects.select_related(
            "author_assignment__employee", "unit", "reviewed_by_assignment__employee"
        )
        readable_units = [
            unit.id for unit in OrganizationalUnit.objects.select_related("parent_unit")
            if self._can("suggestions.feedback.read", unit)
        ]
        queryset = base.filter(deleted_at__isnull=True).filter(
            models.Q(author_assignment=self.request.assignment) | models.Q(unit_id__in=readable_units)
        ).distinct()
        if self.action != "list":
            return queryset
        params = self.request.query_params
        for field, choices in (("status", dict(Suggestion.STATUS_CHOICES)), ("category", dict(Suggestion.CATEGORY_CHOICES)), ("priority", {"low", "medium", "high"})):
            value = params.get(field)
            if value:
                if value not in choices:
                    raise ValidationError({field: "Filtro inválido."})
                queryset = queryset.filter(**{field: value})
        for field in ("source_module", "unit", "author_assignment"):
            value = params.get(field)
            if value:
                if field != "source_module":
                    try:
                        uuid.UUID(value)
                    except ValueError:
                        raise ValidationError({field: "Identificador inválido."})
                queryset = queryset.filter(**{field: value})
        dates = {}
        for field, lookup in (("from", "gte"), ("to", "lte")):
            if value := params.get(field):
                try:
                    dates[field] = parse_date(value)
                except ValueError:
                    dates[field] = None
                if dates[field] is None:
                    raise ValidationError({field: "Fecha inválida."})
                queryset = queryset.filter(**{f"created_at__date__{lookup}": dates[field]})
        if dates.get("from") and dates.get("to") and dates["from"] > dates["to"]:
            raise ValidationError({"to": "La fecha final debe ser posterior a la inicial."})
        search = params.get("search", "").strip()
        if len(search) > 120:
            raise ValidationError({"search": "Busca con un máximo de 120 caracteres."})
        for word in search.split():
            queryset = queryset.filter(models.Q(title__icontains=word) | models.Q(message__icontains=word) | models.Q(id__icontains=word.lstrip("#"))
                | models.Q(author_assignment__employee__full_name__icontains=word) | models.Q(unit__name__icontains=word))
        order = params.get("order", "newest")
        if order == "priority":
            queryset = queryset.annotate(priority_order=models.Case(models.When(priority="high", then=0), models.When(priority="medium", then=1), default=2, output_field=models.IntegerField()))
            return queryset.order_by("priority_order", "-created_at", "pk")
        if order not in ("newest", "oldest"):
            raise ValidationError({"order": "Orden inválido."})
        return queryset.order_by("-created_at" if order == "newest" else "created_at", "pk")

    def get_serializer_class(self):
        return SuggestionSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        unit = request.assignment.position.unit
        if not self._can("suggestions.feedback.create", unit, log=True):
            raise PermissionDenied("No tienes permiso para enviar sugerencias desde esta unidad.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        suggestion = serializer.save(author_assignment=request.assignment, unit=unit)
        SuggestionEvent.objects.create(
            suggestion=suggestion, actor_assignment=request.assignment,
            event_type="suggestion.created",
            changes={"category": suggestion.category, "source_module": suggestion.source_module},
        )
        return Response(self.get_serializer(suggestion).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        suggestion = self.get_object()
        fields = set(request.data)
        author_fields = {"category", "message", "source_module", "source_view", "title", "priority", "environment", "screenshots"}
        review_fields = {"status", "internal_note", "priority"}
        is_author = suggestion.author_assignment_id == request.assignment.id
        if fields and fields <= author_fields and is_author:
            before = {field: getattr(suggestion, field) for field in fields}
            serializer = SuggestionAuthorUpdateSerializer(suggestion, data=request.data, partial=True, context=self.get_serializer_context())
            event_type = "suggestion.updated"
            save_kwargs = {}
        elif fields and fields <= review_fields and self._can(
            "suggestions.feedback.manage", suggestion.unit, suggestion.id, log=True
        ):
            before = {field: getattr(suggestion, field) for field in fields}
            serializer = SuggestionReviewSerializer(suggestion, data=request.data, partial=True, context=self.get_serializer_context())
            event_type = "suggestion.reviewed"
            save_kwargs = {"reviewed_by_assignment": request.assignment, "reviewed_at": timezone.now()}
        elif fields & author_fields:
            raise PermissionDenied("Solo la persona que creó la sugerencia puede editar su contenido.")
        elif fields & review_fields:
            raise PermissionDenied("No tienes permiso para gestionar el estado de esta sugerencia.")
        else:
            raise ValidationError("No se enviaron campos editables de la sugerencia.")
        serializer.is_valid(raise_exception=True)
        suggestion = serializer.save(**save_kwargs)
        after = dict(serializer.validated_data)
        for field in ("message", "screenshots", "internal_note"):
            if field in after:
                after[field] = getattr(suggestion, field)
        # Audit attachment metadata without duplicating the private image bytes.
        if "screenshots" in before:
            before["screenshots"] = [{"id": item["id"], "name": item["name"]} for item in before["screenshots"]]
            after["screenshots"] = [{"id": item["id"], "name": item["name"]} for item in after["screenshots"]]
        SuggestionEvent.objects.create(
            suggestion=suggestion, actor_assignment=request.assignment,
            event_type=event_type,
            changes={"before": before, "after": after},
        )
        return Response(self.get_serializer(suggestion).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        suggestion = self.get_object()
        if suggestion.author_assignment_id != request.assignment.id:
            raise PermissionDenied("Solo la persona que creó la sugerencia puede eliminarla.")
        suggestion.deleted_at = timezone.now()
        suggestion.save(update_fields=["deleted_at", "updated_at"])
        SuggestionEvent.objects.create(
            suggestion=suggestion, actor_assignment=request.assignment,
            event_type="suggestion.deleted", changes={},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
