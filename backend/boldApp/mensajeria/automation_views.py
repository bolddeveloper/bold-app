"""Own automations only, under the current channel/pilot and Core permissions."""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from .automation_models import ChannelAutomation, AutomationAudit
from .automations import budget_lock, room, source, ScopeUnavailable, changed
from .channel_access import ChannelPolicy
from .channel_tasks import TaskReferences
from .channel_views import SlackView
from .page_content import digest
from .serializers import StrictInputSerializer
from .views import Conflict


class ExplicitDateTime(serializers.DateTimeField):
    def to_internal_value(self, value):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
            if not isinstance(parsed, datetime) or timezone.is_naive(parsed):
                raise ValueError()
        except (ValueError, TypeError):
            raise ValidationError('Indica fecha, hora y zona horaria explícitas.')
        return super().to_internal_value(value)


class AutomationInput(StrictInputSerializer):
    client_id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    kind = serializers.ChoiceField(choices=['task_status', 'reminder', 'recurring_page'])
    project_id = serializers.UUIDField(required=False)
    to_status_id = serializers.UUIDField(required=False)
    from_status_id = serializers.UUIDField(required=False, allow_null=True)
    template_id = serializers.UUIDField(required=False)
    template_version = serializers.IntegerField(required=False, min_value=1)
    body = serializers.CharField(required=False, max_length=2000)
    next_at = ExplicitDateTime(required=False)
    interval_days = serializers.IntegerField(required=False, min_value=1, max_value=365)
    share_confirmed = serializers.BooleanField()

    def validate(self, values):
        if not values['share_confirmed']:
            raise ValidationError('Confirma qué acción se publicará en el canal, sin ampliar los permisos de sus lectores.')
        kind = values['kind']
        common = {'client_id', 'name', 'kind', 'share_confirmed'}
        required = {'task_status':{'project_id', 'to_status_id'}, 'reminder':{'body', 'next_at'},
            'recurring_page':{'template_id', 'template_version', 'next_at', 'interval_days'}}[kind]
        optional = {'task_status':{'from_status_id'}, 'reminder':{'interval_days'}, 'recurring_page':set()}[kind]
        if required - set(values) or set(values) - common - required - optional:
            raise ValidationError('Indica únicamente los campos correspondientes al tipo de automatización.')
        if kind == 'task_status' and values.get('from_status_id') == values['to_status_id']:
            raise ValidationError('Los estados inicial y final deben ser distintos.')
        return values


class AutomationUpdate(AutomationInput):
    version = serializers.IntegerField(min_value=1)

    def validate(self, values):
        version = values.pop('version')
        result = super().validate(values)
        return {**result, 'version':version}


class AutomationAction(StrictInputSerializer):
    client_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    active = serializers.BooleanField()
    share_confirmed = serializers.BooleanField(required=False, default=False)


FIELDS = ('name', 'kind', 'project_id', 'to_status_id', 'from_status_id', 'template_id', 'template_version', 'body', 'next_at', 'interval_days')


def receipt_digest(values):
    return digest(json.loads(json.dumps(values, sort_keys=True, default=str)))


def future_schedule(values):
    if 'next_at' in values:
        now = timezone.now()
        if not now + timedelta(seconds=5) <= values['next_at'] <= now + timedelta(days=365):
            raise ValidationError('Programa la primera ejecución entre cinco segundos y 365 días en el futuro.')


def assign_values(row, values):
    for name in FIELDS:
        setattr(row, name, values.get(name, '' if name == 'body' else None))


def rule_data(row, request, policy):
    # Never cache source titles in the rule. Withdraw references after revocation.
    available = True
    try:
        source(row, request, policy, row.channel)
    except (ScopeUnavailable, serializers.ValidationError, APIException):
        available = False
    data = {'id':str(row.pk), 'name':row.name, 'kind':row.kind, 'version':row.version, 'active':row.active,
        'next_at':row.next_at, 'interval_days':row.interval_days, 'body':row.body, 'pause_reason':row.pause_reason,
        'created_at':row.created_at, 'source_available':available,
        'can_manage':policy.allows('slack.automation.manage', row.channel.unit, row.channel_id)}
    if available:
        data.update({key:str(getattr(row, key)) if getattr(row, key) is not None else None for key in
            ('project_id', 'to_status_id', 'from_status_id', 'template_id')})
        data['template_version'] = row.template_version
    return data


class AutomationPages(CursorPagination):
    page_size = 25
    ordering = ('-created_at', '-id')


class AutomationView(SlackView):
    def scope(self, channel_id, *, write=False):
        if not settings.MESSAGING_AUTOMATIONS_ENABLED:
            raise PermissionDenied('Las automatizaciones no están habilitadas en este entorno.')
        channel = self.channel(channel_id, lock=write)
        self.policy().require('slack.automation.read', channel.unit, channel.pk)
        if write:
            self.policy().require('slack.automation.manage', channel.unit, channel.pk)
            budget_lock()
        return channel

    def own(self, channel):
        return ChannelAutomation.objects.filter(channel=channel, account=self.request.user, assignment=self.request.assignment)

    def capacity(self):
        if not room(self.request.user.pk):
            raise Conflict('Se alcanzó el presupuesto del registro de automatizaciones. No se eliminó historial para hacer espacio.')


class AutomationListView(AutomationView):
    def get(self, request, channel_id):
        channel = self.scope(channel_id)
        if set(request.query_params) - {'cursor'}:
            raise ValidationError('Usa únicamente el cursor de tus automatizaciones.')
        pager = AutomationPages(); page = pager.paginate_queryset(self.own(channel).select_related('channel__unit'), request, view=self)
        return pager.get_paginated_response([rule_data(row, request, self.policy()) for row in page])

    @transaction.atomic
    def post(self, request, channel_id):
        channel = self.scope(channel_id, write=True)
        form = AutomationInput(data=request.data); form.is_valid(raise_exception=True)
        values = form.validated_data; receipt = receipt_digest({**values, 'channel':str(channel.pk)})
        old = ChannelAutomation.objects.filter(account=request.user, client_id=values['client_id']).first()
        if old:
            if old.channel_id != channel.pk or old.assignment_id != request.assignment.pk or old.creation_digest != receipt:
                raise Conflict('Este intento corresponde a otra automatización; no se duplicó ni se reasignó.')
            return Response(rule_data(old, request, self.policy()))
        if ChannelAutomation.objects.count() >= settings.MESSAGING_AUTOMATION_MAX_RULES or ChannelAutomation.objects.filter(account=request.user).count() >= settings.MESSAGING_AUTOMATION_ACCOUNT_RULES:
            raise Conflict('Se alcanzó el límite de automatizaciones. Las pausadas también conservan su espacio e historial.')
        self.capacity()
        future_schedule(values)
        row = ChannelAutomation(channel=channel, account=request.user, assignment=request.assignment,
            client_id=values['client_id'], creation_digest=receipt)
        assign_values(row, values)
        try:
            origin = source(row, request, self.policy(), channel)
        except ScopeUnavailable:
            raise ValidationError('La acción o su origen no están disponibles con tus permisos actuales.')
        if row.kind == 'task_status':
            row.source_unit_id = origin.unit_id
        row.save()
        AutomationAudit.objects.create(rule=row, client_id=values['client_id'], digest=receipt, action='created', version=1)
        changed(row)
        return Response(rule_data(row, request, self.policy()), status=201)


class AutomationDetailView(AutomationView):
    def get(self, request, channel_id, rule_id):
        channel = self.scope(channel_id)
        row = get_object_or_404(self.own(channel).select_related('channel__unit'), pk=rule_id)
        return Response(rule_data(row, request, self.policy()))

    @transaction.atomic
    def put(self, request, channel_id, rule_id):
        channel = self.scope(channel_id, write=True)
        row = get_object_or_404(self.own(channel).select_for_update(), pk=rule_id)
        form = AutomationUpdate(data=request.data); form.is_valid(raise_exception=True)
        values = form.validated_data; receipt = receipt_digest(values)
        if row.last_stop_client_id == values['client_id']:
            if row.last_stop_digest != receipt:
                raise Conflict('Este intento ya detuvo la regla con otros parámetros.')
            return Response(rule_data(row, request, self.policy()))
        old = row.audit.filter(client_id=values['client_id']).first()
        if old:
            if old.digest != receipt or old.action != 'updated':
                raise Conflict('Este intento ya tiene otra acción o contenido.')
            return Response(rule_data(row, request, self.policy()))
        if row.version != values['version'] or row.active:
            raise Conflict('Pausa la regla y revisa su versión actual antes de reemplazarla.')
        self.capacity(); future_schedule(values); assign_values(row, values); row.source_unit_id = None
        try:
            origin = source(row, request, self.policy(), channel)
        except ScopeUnavailable:
            raise ValidationError('La acción o su origen no están disponibles con tus permisos actuales.')
        if row.kind == 'task_status':
            row.source_unit_id = origin.unit_id
        row.version += 1; row.pause_reason = ''; row.save()
        AutomationAudit.objects.create(rule=row, client_id=values['client_id'], digest=receipt, action='updated', version=row.version)
        changed(row)
        return Response(rule_data(row, request, self.policy()))

    @transaction.atomic
    def patch(self, request, channel_id, rule_id):
        channel = self.scope(channel_id, write=True)
        row = get_object_or_404(self.own(channel).select_for_update(), pk=rule_id)
        form = AutomationAction(data=request.data); form.is_valid(raise_exception=True)
        values = form.validated_data; receipt = receipt_digest(values)
        if row.last_stop_client_id == values['client_id']:
            if row.last_stop_digest != receipt:
                raise Conflict('Este intento ya detuvo la regla con otros parámetros.')
            return Response(rule_data(row, request, self.policy()))
        old = row.audit.filter(client_id=values['client_id']).first()
        if old:
            if old.digest != receipt or old.action not in ('activated', 'paused'):
                raise Conflict('Este intento ya tiene otra acción o contenido.')
            return Response(rule_data(row, request, self.policy()))
        if row.version != values['version']:
            raise Conflict('La regla cambió. Revisa su versión antes de continuar.')
        can_record = room(request.user.pk)
        if values['active']:
            self.capacity()
            if not values['share_confirmed'] or channel.archived_at:
                raise ValidationError('Revisa y confirma la publicación automática en un canal activo.')
            # A captured HTTP MFA session must never be treated as permanent.
            unattended = SimpleNamespace(user=request.user, assignment=request.assignment, auth=None)
            try:
                source(row, unattended, ChannelPolicy(request.assignment, unattended), channel)
            except (ScopeUnavailable, APIException):
                raise ValidationError('No se puede activar sin acceso vigente y permisos que permitan ejecución desatendida. Revisa también la plantilla y su versión.')
            if row.kind != 'task_status' and (not row.next_at or row.next_at < timezone.now() + timedelta(seconds=5)):
                raise ValidationError('Programa una nueva fecha futura antes de activar; no se reproducen ejecuciones perdidas durante la pausa.')
            row.activated_at = timezone.now(); row.credentials_version = request.user.credentials_version
            row.assignment_unit_id = request.assignment.position.unit_id
        row.active = values['active']; row.pause_reason = '' if row.active else 'manual'
        if not row.active:
            row.last_stop_client_id = values['client_id']; row.last_stop_digest = receipt
            if not can_record:
                row.pause_reason = 'manual_capacity'
        row.version += 1; row.save()
        if can_record:
            AutomationAudit.objects.create(rule=row, client_id=values['client_id'], digest=receipt,
                action='activated' if row.active else 'paused', version=row.version)
        changed(row)
        return Response(rule_data(row, request, self.policy()))


class AutomationHistoryView(AutomationView):
    def get(self, request, channel_id, rule_id):
        channel = self.scope(channel_id)
        row = get_object_or_404(self.own(channel), pk=rule_id)
        if set(request.query_params) - {'cursor'}:
            raise ValidationError('Usa únicamente el cursor del registro.')
        pager = AutomationPages(); page = pager.paginate_queryset(row.runs.all(), request, view=self)
        refs = TaskReferences(request.assignment, request); refs.prime(run.task_id for run in page)
        return pager.get_paginated_response([{'id':str(run.pk), 'rule_version':run.rule_version,
            'state':run.state, 'reason':run.reason, 'attempts':run.attempts, 'created_at':run.created_at,
            'finished_at':run.finished_at, 'task':refs.data(run.task_id) if run.task_id else None,
            'message_id':str(run.message_id) if run.message_id else None,
            'page_id':str(run.page_id) if run.page_id and self.policy().allows('slack.page.read', channel.unit, channel.pk) else None}
            for run in page])


class AutomationAuditView(AutomationView):
    def get(self, request, channel_id, rule_id):
        channel = self.scope(channel_id)
        row = get_object_or_404(self.own(channel), pk=rule_id)
        if set(request.query_params) - {'cursor'}:
            raise ValidationError('Usa únicamente el cursor del registro.')
        pager = AutomationPages(); page = pager.paginate_queryset(row.audit.all(), request, view=self)
        return pager.get_paginated_response([{'id':str(item.pk), 'action':item.action,
            'version':item.version, 'created_at':item.created_at} for item in page])


class AutomationProjectsView(AutomationView):
    """Read-only source picker; neither project management nor a write grant."""
    def get(self, request, channel_id, project_id=None):
        self.scope(channel_id)
        from boldApp.tareas.models import Project, TaskStatus
        from boldApp.tareas.views import TaskViewSet
        from boldApp.core.authorization import apply_session_assurance, resolve_access
        from boldApp.core.models import Permission
        if set(request.query_params) - ({'q', 'cursor'} if not project_id else set()) or any(
                len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise ValidationError('Usa solo búsqueda y cursor, sin repetir parámetros.')
        view = TaskViewSet(); view.request = request
        candidates = Project.objects.filter(is_archived=False)
        if project_id:
            candidates = candidates.filter(pk=project_id)
        else:
            query = request.query_params.get('q', '').strip()
            if not 2 <= len(query) <= 120:
                raise ValidationError('Escribe entre 2 y 120 caracteres para buscar un proyecto.')
            candidates = candidates.filter(name__icontains=query)
        permission = Permission.objects.filter(code='tasks.project.read', is_active=True).first()
        rows = view.visible_projects(candidates).select_related('unit')
        allowed = [row.pk for row in rows if permission and apply_session_assurance(
            resolve_access(request.assignment, permission, row.unit, resource_id=row.pk), permission, request).allowed]
        rows = Project.objects.filter(pk__in=allowed).select_related('unit')
        if project_id:
            row = get_object_or_404(rows, pk=project_id)
            return Response({'id':str(row.pk), 'name':row.name, 'unit_name':row.unit.name,
                'statuses':[{'id':str(status.pk), 'name':status.name, 'is_final':status.is_final} for status in
                    TaskStatus.objects.filter(Q(unit=row.unit) | Q(unit__isnull=True)).order_by('position', 'pk')]})
        pager = AutomationPages(); pager.ordering = ('name', 'id')
        page = pager.paginate_queryset(rows, request, view=self)
        return pager.get_paginated_response([{'id':str(row.pk), 'name':row.name, 'unit_name':row.unit.name} for row in page])
