from django.db import models, transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from boldApp.core.authorization import build_authorization_context, check_and_log, resolve_access
from boldApp.core.models import OrganizationalUnit, Permission
from boldApp.core.permissions import HasActiveAssignment

from .models import Suggestion, SuggestionEvent
from .serializers import SuggestionReviewSerializer, SuggestionSerializer


class SuggestionViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, viewsets.GenericViewSet,
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
        return base.filter(
            models.Q(author_assignment=self.request.assignment) | models.Q(unit_id__in=readable_units)
        ).distinct()

    def get_serializer_class(self):
        return SuggestionReviewSerializer if self.action in {"update", "partial_update"} else SuggestionSerializer

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
        if not self._can("suggestions.feedback.manage", suggestion.unit, suggestion.id, log=True):
            raise PermissionDenied("No tienes permiso para gestionar esta sugerencia.")
        before = {"status": suggestion.status, "internal_note": suggestion.internal_note}
        serializer = self.get_serializer(suggestion, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        suggestion = serializer.save(
            reviewed_by_assignment=request.assignment, reviewed_at=timezone.now()
        )
        SuggestionEvent.objects.create(
            suggestion=suggestion, actor_assignment=request.assignment,
            event_type="suggestion.reviewed",
            changes={"before": before, "after": serializer.validated_data},
        )
        return Response(SuggestionSerializer(suggestion).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)
