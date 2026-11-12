"""Transactional task phases; every write locks task then execution."""
import hashlib
import json
from functools import partial
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from .models import Task, TaskExecution, TaskPhase, TaskTimelineEvent, ExecutionCommand, TaskStatus
from .execution_history import event
from .execution_validation import identity, validate_definition

TERMINAL = {'completed', 'skipped'}


class ExecutionConflict(APIException):
    status_code = 409
    default_detail = 'La tarea cambió. Recarga las etapas antes de guardar.'


def guard_task_completion(task, update_fields=None):
    if update_fields is not None and not {'status','status_id','completed_at'} & set(update_fields):
        return
    if task.status.is_final:
        unfinished = TaskPhase.objects.filter(execution_id=task.pk, archived_at__isnull=True).filter(
            Q(review_required=True) | (Q(required=True) & ~Q(status__in=TERMINAL)))
        if unfinished.exists():
            raise ValidationError({'status': 'Completa las etapas obligatorias y revisiones antes de finalizar la tarea.'})
        previous = Task.all_objects.filter(pk=task.pk).values('completed_at','status__is_final').first()
        task.completed_at = previous['completed_at'] if previous and previous['status__is_final'] else timezone.now()
    else:
        task.completed_at = None


def phase_state(phase):
    return {'status': phase.status, 'review_required': phase.review_required,
            'name': phase.name, 'unit_id': str(phase.unit_id), 'block_reason': phase.block_reason,
            'lead_id':str(phase.lead_id),'required':phase.required,
            'due_at':phase.due_at.isoformat() if phase.due_at else None,
            'estimated_minutes':phase.estimated_minutes}


def ready_notice(phase_id, revision, recipients=None):
    # Revalidate at delivery, including a responsibility removed before commit.
    from boldApp.core.authorization import resolve_access
    from boldApp.core.models import Permission
    from boldApp.notificaciones.services import create_notification
    phase = TaskPhase.objects.select_related('execution__task__unit').filter(pk=phase_id,
        archived_at__isnull=True, status='available', execution__task__deleted_at__isnull=True).first()
    permission = Permission.objects.filter(code='tasks.task.read', is_active=True).first()
    if not phase or not permission:
        return
    task = phase.execution.task
    people=phase.responsible.select_related('employee__user_account','position__unit').filter(
            is_active=True,released_at__isnull=True,employee__is_active=True,employee__user_account__is_active=True)
    if recipients is not None:people=people.filter(pk__in=recipients)
    for person in people:
        if resolve_access(person,permission,task.unit,resource_id=task.pk).allowed:
            create_notification(recipient=person,event_type='tasks.phase.available',task=task,
                title='Una etapa está lista para comenzar',body='Consulta las etapas de la tarea asignada.',
                route={'module':'tasks','task_id':str(task.pk)},metadata={'phase_id':str(phase.pk)},
                dedupe_key=f'phase.ready:{phase.pk}:{revision}',robust_dispatch=True)


def change_phase(execution, phase, status, actor, *, reason='', review=None, kind='phase.transition'):
    before = phase_state(phase)
    phase.status = status
    if review is not None:
        phase.review_required = review
    phase.block_reason = reason if status == 'blocked' else ''
    if status == 'available':
        phase.ready_at = timezone.now()
    if status == 'in_progress':
        phase.started_at = phase.started_at or timezone.now()
    phase.completed_at = (phase.completed_at or timezone.now()) if status in TERMINAL else None
    phase.save(update_fields=['status','block_reason','review_required','ready_at','started_at','completed_at'])
    event(execution.task,kind,actor=actor,phase=phase,before=before,after=phase_state(phase),reason=reason)
    if status == 'available' and before['status'] != status:
        transaction.on_commit(partial(ready_notice,phase.pk,execution.version+1),robust=True)


def reconcile_dependencies(execution, actor):
    phases = list(execution.phases.filter(archived_at__isnull=True).prefetch_related('prerequisites'))
    by_id = {phase.pk:phase for phase in phases}
    dependencies = {phase.pk:[p.pk for p in phase.prerequisites.all()] for phase in phases}
    # Bounded fixed-point evaluation handles both sequential and parallel branches.
    for _ in range(len(phases)+1):
        changed = False
        for phase in phases:
            prerequisites = [by_id.get(key) for key in dependencies[phase.pk]]
            satisfied = all(p and p.status in TERMINAL and not p.review_required and not p.archived_at for p in prerequisites)
            if not satisfied and phase.status in TERMINAL and not phase.review_required:
                change_phase(execution,phase,phase.status,actor,reason='Una dependencia requiere revisión.',review=True,kind='phase.review_required'); changed=True
            elif not satisfied and phase.status in {'available','in_progress','blocked'}:
                change_phase(execution,phase,'pending',actor,reason='Una dependencia volvió a estar pendiente.'); changed=True
            elif satisfied and phase.status == 'pending':
                change_phase(execution,phase,'available',actor); changed=True
        if not changed:
            return


def command(execution, actor, payload):
    operation = identity(payload.get('operation_id'),'operation_id')
    fingerprint = hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    previous = ExecutionCommand.objects.filter(execution=execution,operation_id=operation).first()
    if previous:
        if previous.actor_id != actor.pk or previous.fingerprint != fingerprint:
            raise ExecutionConflict('El identificador de intento pertenece a otra operación.')
        return False
    if type(payload.get('version')) is not int or payload['version'] != execution.version:
        raise ExecutionConflict()
    if execution.commands.count() >= 20000:
        raise ValidationError('Se alcanzó el límite de operaciones de esta tarea.')
    ExecutionCommand.objects.create(execution=execution,operation_id=operation,actor=actor,fingerprint=fingerprint)
    return True


def update_definition(execution, actor, payload):
    definition = validate_definition(payload.get('phases'))
    current = {str(p.pk):p for p in execution.phases.filter(archived_at__isnull=True)
        .select_related('lead__employee','lead__position__unit','unit').prefetch_related('prerequisites','responsible__employee','responsible__position__unit')}
    incoming = {item['id'] for item in definition}
    removed = [p for key,p in current.items() if key not in incoming]
    work_started=any(p.started_at or p.status in TERMINAL or p.status=='blocked' for p in current.values())
    if any(p.started_at or p.status in TERMINAL or p.status=='blocked' or (p.required and work_started) for p in removed):
        raise ValidationError('No puedes retirar etapas con trabajo registrado; conserva su historial o tramita una excepción.')
    if execution.task.status.is_final:
        raise ValidationError('Reabre la tarea antes de modificar sus etapas.')
    for phase in removed:
        phase.archived_at = timezone.now(); phase.save(update_fields=['archived_at'])
        event(execution.task,'phase.archived',actor=actor,phase=phase,before=phase_state(phase))
    saved = {}
    for item in definition:
        key = item['id']; phase = current.get(key)
        if not phase and TaskPhase.objects.filter(pk=key).exists():
            raise ValidationError('El identificador de etapa ya está en uso.')
        previous = phase_state(phase) if phase else {}
        if phase:
            from .execution_history import assignment_snapshot
            previous['definition']={key:getattr(phase,key) for key in ('name','description','completion_criteria','position','required','estimated_minutes')}
            previous['definition'].update(unit=str(phase.unit_id),lead=str(phase.lead_id),
                due_at=phase.due_at.isoformat() if phase.due_at else None,
                responsible=[str(person.pk) for person in phase.responsible.all()],
                prerequisites=[str(p.pk) for p in phase.prerequisites.all()])
            previous['people']=[assignment_snapshot(person) for person in phase.responsible.all()]
        if phase and phase.required and not item['required'] and phase.status not in TERMINAL:
            raise ValidationError('Una etapa obligatoria pendiente requiere una excepción explícita para omitirse.')
        phase = phase or TaskPhase(id=key,execution=execution)
        for field in ('name','description','completion_criteria','position','required','due_at','estimated_minutes'):
            setattr(phase,field,item[field])
        phase.unit_id=item['unit'];phase.lead_id=item['lead'];phase.save()
        previous['responsible'] = [str(person.pk) for person in phase.responsible.all()]
        phase.responsible.set(item['responsible'])
        added=set(item['responsible'])-set(previous['responsible'])
        if previous.get('status')=='available' and added:
            transaction.on_commit(partial(ready_notice,phase.pk,execution.version+1,tuple(added)),robust=True)
        after={**phase_state(phase),'definition':{k:(v.isoformat() if hasattr(v,'isoformat') else v) for k,v in item.items()}}
        event(execution.task,'phase.definition',actor=actor,phase=phase,before=previous,after=after)
        saved[key]=phase
    for item in definition:
        saved[item['id']].prerequisites.set([saved[key] for key in item['prerequisites']])
    reconcile_dependencies(execution,actor)


def transition(execution, phase, actor, action, reason='', *, can_override=False):
    if not isinstance(reason,str) or len(reason.strip())>1000:
        raise ValidationError('Revisa el motivo (máximo 1000 caracteres).')
    reason=reason.strip()
    prerequisites=list(phase.prerequisites.all())
    ready=all(p.status in TERMINAL and not p.review_required for p in prerequisites)
    if action in {'skip','archive'}:
        if not can_override or not reason:
            raise PermissionDenied('La excepción exige permiso específico y un motivo.')
        if action=='skip':
            change_phase(execution,phase,'skipped',actor,reason=reason,review=False,kind='phase.exception')
        else:
            if phase.successors.filter(archived_at__isnull=True).exists():
                raise ValidationError('Revisa primero las dependencias de esta etapa.')
            phase.archived_at=timezone.now();phase.save(update_fields=['archived_at'])
            event(execution.task,'phase.archived',actor=actor,phase=phase,before=phase_state(phase),reason=reason)
    elif action=='review':
        if not phase.review_required or phase.status not in TERMINAL or not ready or not reason:
            raise ValidationError('Completa sus dependencias y explica la revisión antes de confirmar.')
        change_phase(execution,phase,phase.status,actor,reason=reason,review=False,kind='phase.reviewed')
    elif action=='reopen':
        if phase.status not in TERMINAL or not reason:
            raise ValidationError('Solo puedes reabrir una etapa terminada, indicando el motivo.')
        change_phase(execution,phase,'available' if ready else 'pending',actor,reason=reason,review=False,kind='phase.reopened')
    else:
        target={'start':'in_progress','block':'blocked','resume':'in_progress','complete':'completed'}.get(action)
        allowed={'start':{'available'},'block':{'available','in_progress'},'resume':{'blocked'},'complete':{'in_progress'}}
        if not target or phase.status not in allowed[action] or not ready or phase.review_required:
            raise ValidationError('La transición no está disponible desde el estado actual.')
        if action=='block' and not reason:
            raise ValidationError('Indica qué impide continuar.')
        change_phase(execution,phase,target,actor,reason=reason)
    reconcile_dependencies(execution,actor)
    # Reopening does not erase completed downstream work. It does reopen the
    # parent task and requires an explicit review of dependent completed stages.
    if execution.task.status.is_final and execution.phases.filter(archived_at__isnull=True).filter(
            Q(review_required=True)|(Q(required=True)&~Q(status__in=TERMINAL))).exists():
        from .pipelines import aggregate_status
        task=execution.task
        aggregate_status(task,'in_progress')
        task._pipeline_sync=True;task._notification_actor_assignment_id=actor.pk
        task.save(update_fields=['status','completed_at','updated_at'])


def execution_units(execution):
    rows=execution.phases.filter(archived_at__isnull=True).values_list('unit_id','responsible__position__unit_id')
    return {execution.task.unit_id,*[unit for row in rows for unit in row if unit]}


def finish_command(execution, actor, previous_units=()):
    execution.version+=1;execution.save(update_fields=['version','updated_at'])
    from .report_realtime import publish_reports_changed
    publish_reports_changed()
    from .webhook_events import dispatch_resource_invalidation
    # Removed participants must receive the same body-free invalidation so their
    # task loader purges a task that is no longer readable in their department.
    units=execution_units(execution)|set(previous_units)
    transaction.on_commit(partial(dispatch_resource_invalidation,[u for u in units if u],
        'task.execution.changed','task',execution.task_id,{}),robust=True)
