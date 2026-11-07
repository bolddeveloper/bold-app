"""Bounded, read-only BOLD context; never expand a reference into private data."""
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import F

from boldApp.tareas.models import TeamTaskShare
from boldApp.tareas.team import active_assignments, eligible, readable
from .models import ChannelMessage


MAX_PROMPT = 24000


def message_data(message):
    return {'id': str(message.pk), 'author': message.author.full_name[:120],
            'date': message.created_at, 'text': message.body[:700],
            'truncated': len(message.body) > 700,
            'is_bot': message.automation_kind == 'support'}


def shared_tasks(unit_id):
    publications = list(TeamTaskShare.objects.filter(
        employee_id=F('source_assignment__employee_id'),
        source_assignment__position__unit_id=unit_id,
        task__deleted_at__isnull=True).order_by('-task__updated_at', 'pk')[:21])
    rows = {}
    for assignment in active_assignments().filter(pk__in={row.source_assignment_id for row in publications[:20]}).order_by('pk'):
        ids = [row.task_id for row in publications[:20] if row.source_assignment_id == assignment.pk]
        tasks = readable(assignment, eligible(assignment).filter(pk__in=ids)).select_related(
            'status', 'assignee_assignment__employee')
        for task in tasks:
            rows[str(task.pk)] = {'id': str(task.pk), 'title': task.title,
                'status': task.status.name, 'completed': task.status.is_final,
                'due_date': task.due_date,
                'assignee': task.assignee_assignment.employee.full_name[:120] if task.assignee_assignment_id else None,
                'shared_by': assignment.employee.full_name[:120]}
    return [rows.pop(str(row.task_id)) for row in publications[:20] if str(row.task_id) in rows], len(publications) > 20


def prompt_for(message):
    unit = message.channel.unit or message.author_assignment.position.unit
    history = ChannelMessage.objects.filter(channel_id=message.channel_id,
        sequence__lt=message.sequence, thread_deleted_at__isnull=True,
        parent__isnull=True).select_related('author').order_by('-sequence')
    recent = list(history[:17])
    thread = []
    thread_partial = False
    if message.parent_id:
        root = ChannelMessage.objects.select_related('author').get(pk=message.parent_id)
        previous = list(ChannelMessage.objects.filter(channel_id=message.channel_id,
            parent_id=message.parent_id, sequence__lt=message.sequence).select_related('author').order_by('-sequence')[:9])
        thread = [message_data(root)] + [message_data(row) for row in reversed(previous[:8])]
        thread_partial = len(previous) > 8
    people = list(active_assignments().order_by('employee__full_name', 'pk')[:81])
    tasks, tasks_partial = shared_tasks(unit.pk)
    data = {'question': message.body[:5000], 'scope': {
        'channel': message.channel.name, 'channel_id': str(message.channel_id),
        'team': unit.name, 'team_id': str(unit.pk),
        'read_only': True, 'external_connections': False,
        'limits': 'Solo este canal e hilo, directorio de Mi equipo y tareas publicadas de este departamento. '
                  'Sin mensajes directos, otros canales, tareas sin compartir ni contenido de adjuntos.'},
        'channel_history': [message_data(row) for row in reversed(recent[:16])],
        'thread_history': thread,
        'people': [{'name': row.employee.full_name[:120], 'department': row.position.unit.name[:120]}
                   for row in people[:80]],
        'shared_tasks': tasks,
        'partial': {'channel_history': len(recent) > 16, 'thread_history': thread_partial,
                    'people': len(people) > 80, 'shared_tasks': tasks_partial}}
    encoded = json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False, sort_keys=True)
    while len(encoded) > MAX_PROMPT:
        key = max(('channel_history', 'thread_history', 'people', 'shared_tasks'),
                  key=lambda name: len(json.dumps(data[name], cls=DjangoJSONEncoder, ensure_ascii=False)))
        data[key].pop(0 if key in ('channel_history', 'thread_history') else -1)
        data['partial'][key] = True
        encoded = json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False, sort_keys=True)
    return encoded
