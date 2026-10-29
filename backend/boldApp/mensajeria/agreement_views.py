"""Deliberate, bounded selection -> reviewed ordinary page, with atomic retries."""
import uuid
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from boldApp.core.models import Employee
from .agreements import selected_sources
from .channel_acl import readable_channels
from .channel_search import channel_matches
from .channel_views import SlackView
from .models import AgreementSource, DepartmentChannel, MessageAgreement
from .page_content import digest
from .page_views import PageView, create_page
from .serializers import StrictInputSerializer
from .views import Conflict


class AgreementEntry(StrictInputSerializer):
    message_id = serializers.UUIDField()
    source_version = serializers.IntegerField(min_value=1)
    text = serializers.CharField(max_length=10000, allow_blank=True, trim_whitespace=False)


class AgreementInput(StrictInputSerializer):
    client_id = serializers.UUIDField()
    destination_channel_id = serializers.UUIDField()
    title = serializers.CharField(max_length=160)
    introduction = serializers.CharField(max_length=4000, allow_blank=True, default='', trim_whitespace=False)
    entries = AgreementEntry(many=True, min_length=1, max_length=20)
    share_confirmed = serializers.BooleanField()

    def validate(self, values):
        if not values['share_confirmed']:
            raise ValidationError('Revisa y confirma qué texto deseas compartir con quienes puedan leer la página del canal elegido.')
        identities = [row['message_id'] for row in values['entries']]
        if len(set(identities)) != len(identities):
            raise ValidationError('Selecciona cada mensaje una sola vez.')
        return values


class AgreementDestinationPages(CursorPagination):
    page_size = 25
    ordering = ('name', 'id')


class AgreementDestinationsView(SlackView):
    def get(self, request, channel_id=None):
        if channel_id:
            channel=self.channel(channel_id)
            self.policy().require('slack.page.read', channel.unit, channel.pk)
            self.policy().require('slack.page.create', channel.unit, channel.pk)
            if channel.archived_at:
                raise Conflict('El canal está archivado y no admite páginas nuevas.')
            return Response({'id':str(channel.pk), 'name':channel.name, 'visibility':channel.visibility,
                'department':channel.unit.name if channel.unit else 'Sin departamento'})
        if set(request.query_params) - {'q', 'cursor'} or any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError('Usa solo la búsqueda y el cursor, sin repetir parámetros.')
        query = request.query_params.get('q', '').strip()
        if len(query) > 80:
            raise ValidationError('La búsqueda admite hasta 80 caracteres.')
        rows = readable_channels(DepartmentChannel.objects.filter(archived_at__isnull=True).select_related('unit', 'creator'),
            self.actor(), request.assignment.position.unit_id)
        candidates = list(rows);policy = self.policy();policy.prime(candidates)
        allowed = [row.pk for row in candidates if channel_matches(row.name, query) and all(
            policy.allows(code, row.unit, row.pk) for code in ('slack.channel.read', 'slack.page.read', 'slack.page.create'))]
        pages = AgreementDestinationPages();page = pages.paginate_queryset(rows.filter(pk__in=allowed), request)
        return pages.get_paginated_response([{'id':str(row.pk), 'name':row.name, 'visibility':row.visibility,
            'department':row.unit.name if row.unit else 'Sin departamento'} for row in page])


class AgreementReviewView(SlackView):
    def get(self, request, kind, container_id):
        if set(request.query_params) != {'message_ids'} or len(request.query_params.getlist('message_ids')) != 1:
            raise ValidationError('Indica únicamente la selección de mensajes.')
        identities = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=20).run_validation(request.query_params['message_ids'].split(','))
        if len(set(identities)) != len(identities):
            raise ValidationError('Selecciona cada mensaje una sola vez.')
        rows = selected_sources(self, kind, container_id, identities)
        return Response({'results':[{'message_id':str(message.pk), 'source_version':message.version,
            'text':message.body, 'created_at':message.created_at} for _, message in rows], 'files_copied':False})


class AgreementCreateView(PageView):
    @transaction.atomic
    def post(self, request, kind, container_id):
        form = AgreementInput(data=request.data);form.is_valid(raise_exception=True);values = form.validated_data
        # Serialize retry intent per employee. Acquire all channel locks in one
        # global order: A -> B and B -> A must not deadlock for different actors.
        Employee.objects.select_for_update().get(pk=self.actor())
        channel_ids = {values['destination_channel_id'], *([container_id] if kind == 'channel' else [])}
        list(DepartmentChannel.objects.filter(pk__in=channel_ids).order_by('pk').select_for_update(of=('self',)).values_list('pk', flat=True))
        rows = selected_sources(self, kind, container_id, [row['message_id'] for row in values['entries']], lock=kind=='chat')
        receipt = digest({'kind':kind, 'container_id':str(container_id), **{**values,
            'client_id':str(values['client_id']), 'destination_channel_id':str(values['destination_channel_id']),
            'entries':[{**row, 'message_id':str(row['message_id'])} for row in values['entries']]}})
        previous = MessageAgreement.objects.filter(employee_id=self.actor(), client_id=values['client_id']).first()
        if previous:
            if previous.digest != receipt:
                raise Conflict('Este intento ya corresponde a otra página. No se ha creado una segunda.')
            return self.result(previous, created=False)
        if any(message.version != entry['source_version'] for (_, message), entry in zip(rows, values['entries'])):
            raise Conflict('Algún mensaje cambió desde la revisión. Actualiza el origen, revisa el texto y confirma de nuevo.')
        channel = self.scope(values['destination_channel_id'])
        blocks = []
        if values['introduction']:
            blocks.append({'id':str(uuid.uuid5(values['client_id'], 'introduction')), 'type':'paragraph', 'text':values['introduction']})
        bindings = []
        for index, ((document, message), entry) in enumerate(zip(rows, values['entries'])):
            text = entry['text'] or 'Mensaje multimedia sin texto. Consulta el origen si tienes acceso.'
            identities = []
            for part, offset in enumerate(range(0, len(text), 4000)):
                identity = str(uuid.uuid5(values['client_id'], f'message:{message.pk}:{part}'));identities.append(identity)
                blocks.append({'id':identity, 'type':'paragraph', 'text':text[offset:offset+4000]})
            bindings.append((document, message.version, identities, index))
        page, created = create_page(self, channel, {'client_id':values['client_id'], 'title':values['title'], 'icon':'checklist', 'blocks':blocks})
        if not created:
            raise Conflict('Ese identificador ya se utilizó para crear una página por otra vía. Revisa las páginas existentes.')
        agreement = MessageAgreement.objects.create(page=page, employee_id=self.actor(), assignment=request.assignment,
            client_id=values['client_id'], digest=receipt)
        AgreementSource.objects.bulk_create([AgreementSource(agreement=agreement, document=document, source_version=version,
            block_ids=identities, position=index) for document, version, identities, index in bindings])
        return self.result(agreement, created=True)

    def result(self, agreement, *, created):
        if not agreement.page_id:
            return Response({'created':created, 'page':{'available':False}}, status=201 if created else 200)
        channel = self.scope(agreement.page.channel_id)
        page = agreement.page
        return Response({'created':created, 'page':{'available':True, 'id':str(page.pk), 'channel_id':str(channel.pk),
            'title':page.title, 'archived':bool(page.archived_at)}, 'files_copied':False}, status=201 if created else 200)
