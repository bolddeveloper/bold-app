from django.db import models, transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from boldApp.core.authorization import build_authorization_context, check_and_log, resolve_access
from boldApp.core.models import OrganizationalUnit, Permission
from boldApp.core.permissions import HasActiveAssignment

from .models import Suggestion, SuggestionEvent
from .serializers import SuggestionAuthorUpdateSerializer, SuggestionReviewSerializer, SuggestionSerializer


class SuggestionViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet,
):
    permission_classes = [HasActiveAssignment]
    serializer_class = SuggestionSerializer

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
        permission = Permission.objects.filter(code=code, is_active=True).first()
        if not permission:
            return False
        context = build_authorization_context(self.request.assignment, permission)
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
        return base.filter(deleted_at__isnull=True).filter(
            models.Q(author_assignment=self.request.assignment) | models.Q(unit_id__in=readable_units)
        ).distinct()

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
        return Response(SuggestionSerializer(suggestion).data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        suggestion = self.get_object()
        fields = set(request.data)
        author_fields = {"category", "message", "source_module", "source_view"}
        review_fields = {"status", "internal_note"}
        is_author = suggestion.author_assignment_id == request.assignment.id
        if fields and fields <= author_fields and is_author:
            before = {field: getattr(suggestion, field) for field in fields}
            serializer = SuggestionAuthorUpdateSerializer(suggestion, data=request.data, partial=True)
            event_type = "suggestion.updated"
            save_kwargs = {}
        elif fields and fields <= review_fields and self._can(
            "suggestions.feedback.manage", suggestion.unit, suggestion.id, log=True
        ):
            before = {field: getattr(suggestion, field) for field in fields}
            serializer = SuggestionReviewSerializer(suggestion, data=request.data, partial=True)
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
        SuggestionEvent.objects.create(
            suggestion=suggestion, actor_assignment=request.assignment,
            event_type=event_type,
            changes={"before": before, "after": serializer.validated_data},
        )
        return Response(SuggestionSerializer(suggestion).data)

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
