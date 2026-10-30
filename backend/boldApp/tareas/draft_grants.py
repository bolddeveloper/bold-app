"""Fresh account/assignment grants for one's unsubmitted task creation draft.

This grants access to locally authored private text only. It grants no project
read access and never substitutes for task creation/assignment permissions.
"""
import base64
import hashlib
import hmac
import json
from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView
from boldApp.core.permissions import HasActiveAssignment


class DraftThrottle(UserRateThrottle):
    rate = "60/min"


@method_decorator(never_cache, name="dispatch")
class TaskDraftGrantView(APIView):
    permission_classes = [HasActiveAssignment]
    throttle_classes = [DraftThrottle]

    def post(self, request):
        if request.data != {"kind": "task-create", "resource_id": str(request.assignment.pk)}:
            raise serializers.ValidationError("El borrador debe pertenecer a tu asignación activa.")
        scope = {**request.data, "account_id": str(request.user.pk), "assignment_id": str(request.assignment.pk)}
        context = json.dumps({"scope": scope, "credentials": request.user.credentials_version, "version": 1},
            sort_keys=True, separators=(",", ":")).encode()
        secret = settings.AUTH_ENCRYPTION_KEY.strip()
        if not secret:
            if not settings.DEBUG:
                raise RuntimeError("AUTH_ENCRYPTION_KEY es obligatoria para recuperar borradores.")
            secret = settings.SECRET_KEY + ":task-drafts-debug-only"
        key = hmac.new(secret.encode(), b"bold-task-draft-v1\0" + context, hashlib.sha256).digest()
        return Response({"scope": scope, "key": base64.b64encode(key).decode(),
            "key_id": hashlib.sha256(key).hexdigest()[:32], "can_write": True, "retention_seconds": 7 * 86400})
