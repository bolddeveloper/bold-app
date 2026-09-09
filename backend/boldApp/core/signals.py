from functools import partial

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .events import (
    ACCESS_GRANT_CREATED,
    ACCESS_GRANT_REVOKED,
    PERMISSION_AUDIT_LOGGED,
    POSITION_ASSIGNMENT_ACTIVATED,
    POSITION_ASSIGNMENT_RELEASED,
    dispatch_core_event,
)
from .models import AccessGrant, PermissionAuditLog, PositionAssignment
from .serializers import AccessGrantSerializer, PermissionAuditLogSerializer, PositionAssignmentSerializer


# Guarda el estado previo de is_active antes de guardar la asignacion, para
# poder distinguir en post_save entre "recien activada" y "recien liberada".
@receiver(pre_save, sender=PositionAssignment)
def capture_previous_assignment_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_is_active = None
        return

    previous = PositionAssignment.objects.filter(pk=instance.pk).values("is_active").first()
    instance._previous_is_active = previous["is_active"] if previous else None


# Dispara el evento de nucleo correspondiente cuando una asignacion se activa
# (se crea activa) o se libera (pasa de activa a inactiva).
@receiver(post_save, sender=PositionAssignment)
def dispatch_position_assignment_events(sender, instance, created, **kwargs):
    payload = PositionAssignmentSerializer(instance).data

    if created and instance.is_active:
        transaction.on_commit(
            partial(dispatch_core_event, POSITION_ASSIGNMENT_ACTIVATED, "position_assignment", instance.id, payload)
        )
        return

    if not created and instance._previous_is_active and not instance.is_active:
        transaction.on_commit(
            partial(dispatch_core_event, POSITION_ASSIGNMENT_RELEASED, "position_assignment", instance.id, payload)
        )


# Guarda el status previo del AccessGrant para poder detectar en post_save
# la transicion exacta hacia "revoked" (y no volver a disparar el evento en
# guardados posteriores que no cambian el status).
@receiver(pre_save, sender=AccessGrant)
def capture_previous_access_grant_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status = None
        return

    previous = AccessGrant.objects.filter(pk=instance.pk).values("status").first()
    instance._previous_status = previous["status"] if previous else None


# Dispara el evento de nucleo cuando se crea un AccessGrant, y otro distinto
# cuando uno existente transiciona a revocado.
@receiver(post_save, sender=AccessGrant)
def dispatch_access_grant_events(sender, instance, created, **kwargs):
    payload = AccessGrantSerializer(instance).data

    if created:
        transaction.on_commit(
            partial(dispatch_core_event, ACCESS_GRANT_CREATED, "access_grant", instance.id, payload)
        )
        return

    became_revoked = (
        instance.status == AccessGrant.STATUS_REVOKED and instance._previous_status != AccessGrant.STATUS_REVOKED
    )
    if became_revoked:
        transaction.on_commit(
            partial(dispatch_core_event, ACCESS_GRANT_REVOKED, "access_grant", instance.id, payload)
        )


# Dispara el evento de nucleo cada vez que boldApp/core/authorization.py deja
# constancia de una decision de autorizacion (allow o deny).
@receiver(post_save, sender=PermissionAuditLog)
def dispatch_permission_audit_events(sender, instance, created, **kwargs):
    if not created:
        return

    payload = PermissionAuditLogSerializer(instance).data
    transaction.on_commit(
        partial(dispatch_core_event, PERMISSION_AUDIT_LOGGED, "permission_audit_log", instance.id, payload)
    )
