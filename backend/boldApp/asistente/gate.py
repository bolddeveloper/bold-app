"""Shared lease across legacy support and operational inferences; no automatic replay."""
from datetime import timedelta
from uuid import uuid4
from django.db import transaction
from django.utils import timezone
from .models import InferenceGate


@transaction.atomic
def acquire():
    InferenceGate.objects.get_or_create(pk=1)
    gate=InferenceGate.objects.select_for_update().get(pk=1)
    now=timezone.now()
    if gate.owner and gate.expires_at and gate.expires_at>now:return None
    gate.owner=uuid4();gate.expires_at=now+timedelta(minutes=3)
    gate.save(update_fields=['owner','expires_at'])
    return gate.owner


def release(owner):
    InferenceGate.objects.filter(pk=1,owner=owner).update(owner=None,expires_at=None)


def renew(owner):
    return bool(InferenceGate.objects.filter(pk=1,owner=owner,expires_at__gt=timezone.now()).update(
        expires_at=timezone.now()+timedelta(minutes=3)))
