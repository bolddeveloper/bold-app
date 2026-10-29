"""Restricted capability bridge. Phones cannot list/download media or send messages."""
import hashlib
import secrets
import uuid
from datetime import timedelta
from types import SimpleNamespace

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from boldApp.autenticacion.models import AuthSession
from boldApp.core.models import UserAccount
from boldApp.core.permissions import HasActiveAssignment
from .access import assignment_can_chat
from .channel_access import ChannelPolicy
from .channel_views import SlackView
from .media import BoundedUpload, prepare
from .models import PhoneImage, PhoneTransfer, MediaUploadQuota
from .presenters import people
from .views import Conflict

TTL = timedelta(minutes=10)
MAX_IMAGES = 10
MAX_TOTAL = 20 * 1024 * 1024
MAX_NORMALIZED = 2 * 1024 * 1024


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def secret(value):
    if not isinstance(value, str) or not 32 <= len(value) <= 128:
        raise PermissionDenied("El vínculo no es válido.")
    return value


def live(row):
    now = timezone.now()
    session, account, assignment = row.session, row.account, row.assignment
    if (row.expires_at <= now or session.revoked_at or session.expires_at <= now
            or session.idle_expires_at and session.idle_expires_at <= now
            or not account.is_active or account.must_change_password
            or settings.AUTH_MFA_REQUIRED and not account.mfa_methods.filter(is_active=True).exists()
            or account.credentials_version != session.credentials_version
            or assignment.employee_id != account.employee_id or not assignment_can_chat(assignment)):
        raise NotFound("La transferencia terminó. Solicita un QR nuevo en el ordenador.")
    if row.channel_id:
        policy = ChannelPolicy(assignment, SimpleNamespace(auth=session, user=account))
        if row.channel.archived_at or not all(policy.allows(code, row.channel.unit, row.channel_id)
                for code in ("slack.channel.read", "slack.message.create")):
            raise PermissionDenied("El canal ya no permite esta transferencia.")
    elif row.conversation_id:
        ids = (row.conversation.first_employee_id, row.conversation.second_employee_id)
        if account.employee_id not in ids or people().filter(pk__in=ids).count() != 2:
            raise PermissionDenied("La conversación ya no está disponible.")
    else:
        raise NotFound()
    return row


def rows():
    return PhoneTransfer.objects.select_related("session", "account", "assignment__employee",
        "assignment__position__unit", "channel__unit", "conversation")


def manifest(row):
    return {"id": str(row.pk), "expires_at": row.expires_at, "paired": bool(row.device_hash),
        "pairing_code": row.pairing_code, "approved": row.approved, "sealed": row.sealed, "max_images": row.max_images,
        "images": [{"id": str(image.pk), "size": image.size_bytes} for image in row.images.only("id", "size_bytes").order_by("created_at", "id")]}


@shared_task
def cleanup_phone_transfers():
    return PhoneTransfer.objects.filter(expires_at__lte=timezone.now()).delete()[0]


class PhoneOwnerView(SlackView):
    def owned(self, identity, *, lock=False):
        query = rows().filter(account=self.request.user, assignment=self.request.assignment, session=self.request.auth)
        if lock:
            query = query.select_for_update(of=("self",))
        return live(get_object_or_404(query, pk=identity))


class PhoneCreateView(PhoneOwnerView):
    parser_classes = [JSONParser]

    @transaction.atomic
    def post(self, request):
        if not isinstance(request.auth, AuthSession):
            raise PermissionDenied("Inicia sesión de nuevo para vincular el teléfono.")
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError("Envía un objeto con el destino de la transferencia.")
        if set(data) - {"conversation_id", "channel_id", "parent_id", "max_images"}:
            raise ValidationError("Parámetros no permitidos.")
        capacity = data.get("max_images", MAX_IMAGES)
        if type(capacity) is not int or not 1 <= capacity <= MAX_IMAGES:
            raise ValidationError("La cola debe tener espacio para entre una y diez imágenes.")
        conversation, channel, parent = None, None, None
        try:
            if bool(data.get("conversation_id")) == bool(data.get("channel_id")):
                raise ValueError()
            target = uuid.UUID(str(data.get("conversation_id") or data.get("channel_id")))
            if data.get("conversation_id"):
                conversation = self.conversation(target)
                if data.get("parent_id"):
                    raise ValueError()
            else:
                channel = self.channel(target)
                self.writable(channel)
                if data.get("parent_id"):
                    parent = get_object_or_404(channel.messages, pk=uuid.UUID(str(data["parent_id"])), parent__isnull=True)
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("Selecciona una conversación o un canal válido.")
        # Match staged reservations: container -> global quota -> account ->
        # transfer. Never wait for quota while holding a transfer/account lock.
        container = conversation or channel
        type(container).objects.select_for_update().get(pk=container.pk)
        MediaUploadQuota.objects.get_or_create(pk=1)
        MediaUploadQuota.objects.select_for_update().get(pk=1)
        # Serialize replacement: exactly one live capability per account.
        UserAccount.objects.select_for_update().get(pk=request.user.pk)
        PhoneTransfer.objects.filter(Q(account=request.user) | Q(expires_at__lte=timezone.now())).delete()
        token = secrets.token_urlsafe(32)
        row = PhoneTransfer.objects.create(account=request.user, session=request.auth, assignment=request.assignment,
            conversation=conversation, channel=channel, parent=parent, claim_hash=digest(token),
            max_images=capacity, expires_at=min(timezone.now() + TTL, request.auth.expires_at))
        return Response({**manifest(row), "claim_token": token}, status=201)


class PhoneDetailView(PhoneOwnerView):
    def get_permissions(self):
        # A person switching out of the pilot may still revoke their own link.
        # This grants no read/upload capability outside IT.
        if self.request.method == "DELETE":
            return [HasActiveAssignment()]
        return super().get_permissions()

    def get(self, request, identity):
        return Response(manifest(self.owned(identity)))

    @transaction.atomic
    def delete(self, request, identity):
        # Cancellation also works after expiry/revocation of the capability.
        PhoneTransfer.objects.filter(pk=identity, account=request.user).delete()
        return Response(status=204)


class PhoneApproveView(PhoneOwnerView):
    parser_classes = [JSONParser]

    @transaction.atomic
    def post(self, request, identity):
        row = self.owned(identity, lock=True)
        if not isinstance(request.data, dict) or not row.device_hash or request.data.get("pairing_code") != row.pairing_code:
            raise ValidationError("Confirma el código mostrado en tu teléfono.")
        row.approved = True
        row.save(update_fields=["approved"])
        return Response(manifest(row))


class PhoneDownloadView(PhoneOwnerView):
    def get(self, request, identity, image_id):
        row = self.owned(identity)
        image = get_object_or_404(row.images, pk=image_id)
        response = HttpResponse(bytes(image.content), content_type="image/webp")
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


class PhoneSealView(PhoneOwnerView):
    @transaction.atomic
    def post(self, request, identity):
        row = self.owned(identity, lock=True)
        if not row.approved or not row.images.exists():
            raise ValidationError("Todavía no hay imágenes para recibir.")
        row.sealed = True
        row.save(update_fields=["sealed"])
        return Response(manifest(row))


class PhoneThrottle(AnonRateThrottle):
    rate = "180/min"


class PhonePublicView(APIView):
    # Explicit bearer capability, never ambient employee cookies or assignment.
    authentication_classes = []
    permission_classes = []
    throttle_classes = [PhoneThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def capability(self, request, identity, field, *, lock=True):
        header = request.headers.get("Authorization", "")
        token = secret(header[7:] if header.startswith("Bearer ") else "")
        query = rows()
        if lock:
            query = query.select_for_update(of=("self",))
        row = live(get_object_or_404(query, pk=identity))
        if not secrets.compare_digest(getattr(row, field), digest(token)):
            raise PermissionDenied("El vínculo no es válido.")
        return row


class PhoneClaimView(PhonePublicView):
    parser_classes = [JSONParser]

    @transaction.atomic
    def post(self, request, identity):
        row = self.capability(request, identity, "claim_hash")
        if not isinstance(request.data, dict):
            raise ValidationError("Envía un objeto con la solicitud de vinculación.")
        device = digest(secret(request.data.get("device_token")))
        if row.device_hash and not secrets.compare_digest(row.device_hash, device):
            raise Conflict("Este QR ya está vinculado. Solicita otro en el ordenador.")
        if not row.device_hash:
            row.device_hash, row.pairing_code = device, f"{secrets.randbelow(1000000):06d}"
            row.save(update_fields=["device_hash", "pairing_code"])
        return Response({"pairing_code": row.pairing_code, "expires_at": row.expires_at, "max_images": row.max_images})


class PhoneUploadView(PhonePublicView):
    parser_classes = [MultiPartParser]

    def initialize_request(self, request, *args, **kwargs):
        request.upload_handlers.insert(0, BoundedUpload(request))
        return super().initialize_request(request, *args, **kwargs)

    @transaction.atomic
    def get(self, request, identity):
        row = self.capability(request, identity, "device_hash")
        return Response({"approved": row.approved, "sealed": row.sealed, "count": row.images.count(), "expires_at": row.expires_at})

    @transaction.atomic
    def post(self, request, identity):
        # Authenticate before touching a container lock, then revalidate the
        # capability/approval after the reservation locks (replacement may win).
        row = self.capability(request, identity, "device_hash", lock=False)
        if not row.approved:
            raise PermissionDenied("Primero aprueba la vinculación en el ordenador.")
        if row.sealed:
            raise Conflict("El ordenador está recibiendo las imágenes. Genera otro QR para añadir más.")
        try:
            client_id = uuid.UUID(str(request.data.get("client_id")))
        except (ValueError, TypeError):
            raise ValidationError("Identificador de imagen no válido.")
        upload = request.FILES.get("file")
        if not upload or not (upload.content_type or "").startswith("image/"):
            raise ValidationError("Selecciona una imagen PNG, JPEG o WebP.")
        prepared = prepare(upload)
        if prepared["size_bytes"] > MAX_NORMALIZED:
            raise ValidationError("La imagen preparada supera 2 MB. Reduce su tamaño.")
        container = row.conversation or row.channel
        type(container).objects.select_for_update().get(pk=container.pk)
        MediaUploadQuota.objects.get_or_create(pk=1)
        MediaUploadQuota.objects.select_for_update().get(pk=1)
        row = self.capability(request, identity, "device_hash")
        if not row.approved:
            raise PermissionDenied("Primero aprueba la vinculación en el ordenador.")
        if row.sealed:
            raise Conflict("El ordenador está recibiendo las imágenes. Genera otro QR para añadir más.")
        existing = row.images.filter(client_id=client_id).first()
        if existing:
            if existing.digest != prepared["digest"]:
                raise Conflict("El reintento no coincide con la imagen original.")
            return Response({"id": str(existing.pk)}, status=200)
        sizes = list(row.images.values_list("size_bytes", flat=True))
        if len(sizes) >= row.max_images or sum(sizes) + prepared["size_bytes"] > MAX_TOTAL:
            raise ValidationError(f"Esta cola admite {row.max_images} imágenes del teléfono y hasta 20 MB preparados.")
        from .upload_capacity import check_temporary_capacity
        check_temporary_capacity(row.account, prepared['size_bytes'])
        image = PhoneImage.objects.create(transfer=row, client_id=client_id,
            content=prepared["content"], digest=prepared["digest"], size_bytes=prepared["size_bytes"])
        return Response({"id": str(image.pk)}, status=201)
