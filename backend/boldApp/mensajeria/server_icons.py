import base64
from io import BytesIO
from PIL import Image, UnidentifiedImageError
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from boldApp.administrativo.services import record_system_event
from boldApp.core.avatar import validate_avatar
from boldApp.core.models import OrganizationalUnit
from boldApp.workspace.image_storage import image_id, persist_image
from boldApp.workspace.image_views import StoredImageView
from .models import PrivateServer, ServerIcon
from .channel_views import SlackView
from .serializers import StrictInputSerializer
from .views import Conflict


def prime_icons(policy, *, units=(), servers=()):
    cache = getattr(policy, 'server_icons', {})
    for unit in units:
        cache[('department', unit)] = None
    for server in servers:
        cache[('private', server)] = None
    for row in ServerIcon.objects.filter(Q(unit_id__in=units) | Q(server_id__in=servers)).values('unit_id', 'server_id', 'version').annotate(has_image=~Q(image__isnull=True)):
        key = ('department', row['unit_id']) if row['unit_id'] else ('private', row['server_id'])
        cache[key] = (row['version'], row['has_image'])
    policy.server_icons = cache


def icon_allowed(policy, *, unit=None, server=None):
    assignment = policy.assignment
    if not policy.allows('slack.channel.manage', unit):
        return False
    if assignment.position.unit.is_control_plane:
        return True
    if server:
        return server.creator.employee_id == assignment.employee_id
    return bool(unit and unit.pk == assignment.position.unit_id and assignment.position.direct_reports.filter(unit_id=unit.pk).exists())


def icon_data(policy, *, unit=None, server=None):
    kind, identity = ('department', unit.pk) if unit else ('private', server.pk)
    cache = getattr(policy, 'server_icons', {})
    if (kind, identity) not in cache:
        prime_icons(policy, units=[identity] if unit else [], servers=[identity] if server else [])
        cache = policy.server_icons
    version, has_image = cache.get((kind, identity)) or (0, False)
    return {'avatar_url': f'/api/v2/messaging/server-icons/{kind}/{identity}/image/?v={version}' if has_image else None,
        'icon_version': version, 'can_edit_icon': icon_allowed(policy, unit=unit, server=server)}


class IconInput(StrictInputSerializer):
    image = serializers.CharField(max_length=410000, allow_null=True)
    version = serializers.IntegerField(min_value=0)

    def validate_image(self, value):
        value = validate_avatar(value, 'servidor')
        if not value:
            return None
        try:
            with Image.open(BytesIO(base64.b64decode(value.split(',', 1)[1]))) as image:
                if image.format != 'WEBP' or max(image.size) > 1024 or getattr(image, 'n_frames', 1) != 1:
                    raise ValidationError('Usa una imagen WebP estática de hasta 1024 × 1024 píxeles.')
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError):
            raise ValidationError('No se pudo leer la imagen del servidor.')
        return value


class ServerIconView(SlackView):
    def target(self, kind, identity, *, lock=False):
        if kind == 'department':
            rows = OrganizationalUnit.objects.all()
            if lock:
                rows = rows.select_for_update()
            unit, server = get_object_or_404(rows, pk=identity), None
        elif kind == 'private':
            rows = PrivateServer.objects.filter(deleted_at__isnull=True).select_related('creator')
            if lock:
                rows = rows.select_for_update(of=('self',))
            server = get_object_or_404(rows, pk=identity)
            if not server.members.filter(employee_id=self.actor()).exists():
                raise NotFound('Servidor no disponible.')
            unit = None
        else:
            raise NotFound('Servidor no disponible.')
        self.policy().require('slack.channel.read', unit)
        return unit, server

    def get(self, request, kind, identity, image=False):
        unit, server = self.target(kind, identity)
        if not image:
            return Response(icon_data(self.policy(), unit=unit, server=server))
        icon = get_object_or_404(ServerIcon, unit=unit, server=server)
        if not icon.image:
            raise NotFound('Este servidor no tiene imagen.')
        reference = image_id(icon.image)
        if not reference:
            raise Conflict('Esta imagen necesita migrarse a Drive. Su original se conserva para completar la migración.')
        return StoredImageView().get(request, reference)

    @transaction.atomic
    def patch(self, request, kind, identity):
        unit, server = self.target(kind, identity, lock=True)
        if not icon_allowed(self.policy(), unit=unit, server=server):
            raise PermissionDenied('Solo el jefe de esta área o Dirección pueden cambiar su imagen; en privados, también su creador.')
        form = IconInput(data=request.data)
        form.is_valid(raise_exception=True)
        icon = ServerIcon.objects.filter(unit=unit, server=server).first()
        if (icon.version if icon else 0) != form.validated_data['version']:
            raise Conflict('La imagen cambió. Vuelve a abrir su configuración antes de guardar.')
        if not icon:
            icon = ServerIcon(unit=unit, server=server, version=0)
        value = form.validated_data['image']
        icon.image = persist_image(value, icon, 'image', request) if value else None
        icon.version += 1
        icon.save()
        self.policy().server_icons = {}
        record_system_event('slack.server.icon_updated', request, module_code='slack', unit=unit, target_type='slack_server', target_id=identity)
        return Response(icon_data(self.policy(), unit=unit, server=server))
