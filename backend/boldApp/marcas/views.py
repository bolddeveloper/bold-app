from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from boldApp.core.authorization import check_and_log
from boldApp.core.permissions import HasActiveAssignment
from boldApp.core.models import PositionAssignment
from boldApp.administrativo.services import record_system_event
from boldApp.tareas.workspace_library import WorkspaceConflict
from .models import Brand
from .serializers import BrandSerializer


class BrandViewSet(viewsets.ModelViewSet):
    permission_classes = [HasActiveAssignment]
    serializer_class = BrandSerializer

    def require_capability(self, action):
        # Role capability in the active unit AND explicit brand membership;
        # neither of these confers task/project permissions.
        result = check_and_log(assignment=self.request.assignment, permission_code=f"brands.brand.{action}",
                               target_unit=self.request.assignment.position.unit, request=self.request)
        if not result.allowed:
            raise PermissionDenied("Tu cargo no permite esta acción sobre marcas.")

    def get_queryset(self):
        self.require_capability("read")
        rows = Brand.objects.filter(archived_at__isnull=True).select_related("owner__employee", "unit").prefetch_related("members")
        if not self.request.user.is_superuser:
            rows = rows.filter(Q(owner=self.request.user) | Q(members=self.request.assignment)).distinct()
        search = self.request.query_params.get("search", "")[:120]
        return rows.filter(Q(name__icontains=search) | Q(description__icontains=search)) if search else rows

    def perform_create(self, serializer):
        self.require_capability("create")
        row = serializer.save(owner=self.request.user, unit=self.request.assignment.position.unit, revision=1)
        record_system_event("brand.created", self.request, module_code="brands", target_type="brand", target_id=row.pk)

    def locked_object(self):
        # PostgreSQL cannot lock a DISTINCT membership join. Lock only the
        # brand, then recheck visibility after waiting: a concurrent removal or
        # archive must not retain the access observed before acquiring the lock.
        requested = self.get_object()
        row = Brand.objects.select_for_update().get(pk=requested.pk)
        if not self.get_queryset().filter(pk=row.pk).exists():
            raise NotFound("La marca no existe o ya no tienes acceso.")
        return row

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        self.require_capability("manage")
        row = self.locked_object()
        serializer = self.get_serializer(row, data=request.data, partial=kwargs.get("partial", False)); serializer.is_valid(raise_exception=True)
        if serializer.validated_data["revision"] != row.revision:
            raise WorkspaceConflict()
        serializer.save(revision=row.revision + 1)
        record_system_event("brand.updated", request, module_code="brands", target_type="brand", target_id=row.pk)
        return Response(serializer.data)

    def require_creator(self, row):
        if row.owner_id != self.request.user.pk and not self.request.user.is_superuser:
            raise PermissionDenied("Solo el creador o el propietario gestiona las personas y archiva la marca.")

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self.require_capability("manage")
        row = self.locked_object(); self.require_creator(row)
        revision = serializers.IntegerField(min_value=1).run_validation(request.query_params.get("revision"))
        if revision != row.revision:
            raise WorkspaceConflict()
        row.archived_at = timezone.now(); row.revision += 1; row.save(update_fields=["archived_at", "revision", "updated_at"])
        record_system_event("brand.archived", request, module_code="brands", target_type="brand", target_id=row.pk)
        return Response(status=204)

    @action(detail=True, methods=["put"])
    @transaction.atomic
    def members(self, request, pk=None):
        self.require_capability("share")
        row = self.locked_object(); self.require_creator(row)
        revision = serializers.IntegerField(min_value=1).run_validation(request.data.get("revision"))
        ids = serializers.ListField(child=serializers.UUIDField(), max_length=200).run_validation(request.data.get("member_ids"))
        members = PositionAssignment.objects.filter(pk__in=ids, is_active=True, released_at__isnull=True, employee__is_active=True, employee__user_account__is_active=True)
        if set(ids) != set(members.values_list("pk", flat=True)):
            raise serializers.ValidationError("Selecciona empleados activos.")
        if revision != row.revision:
            raise WorkspaceConflict()
        row.members.set(members); row.revision += 1; row.save(update_fields=["revision", "updated_at"])
        record_system_event("brand.members_updated", request, module_code="brands", target_type="brand", target_id=row.pk)
        return Response(self.get_serializer(row).data)
