from django.db import transaction
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, ValidationError, PermissionDenied
from boldApp.core.authorization import resolve_access, apply_session_assurance
from boldApp.core.models import Permission
from .views import AssignmentScopedViewSetMixin
from .models import Task, TaskExecution, TaskPhase, TaskTimelineEvent, ExecutionTemplate
from .execution_history import assignment_snapshot
from .execution_service import command, update_definition, transition, finish_command, execution_units
from .execution_validation import identity, validate_definition, ObjectRequestMixin


class ExecutionView(ObjectRequestMixin, AssignmentScopedViewSetMixin, APIView):
    def task(self, task_id, *, lock=False):
        qs=self.visible_tasks(Task.objects.filter(pk=task_id)).select_related('unit','status','assignee_assignment')
        if lock:
            qs=qs.select_for_update(of=('self',))
        task=qs.first()
        if not task:
            raise NotFound()
        self.require_permission('tasks.task.read',task.unit,task.pk)
        return task

    def allowed(self, code, task):
        permission=Permission.objects.filter(code=code,is_active=True).first()
        return bool(permission and apply_session_assurance(resolve_access(self.request.assignment,permission,
            task.unit,resource_id=task.pk),permission,self.request).allowed)

    def pack(self, task):
        execution=TaskExecution.objects.filter(task=task).first()
        can_manage=self.allowed('tasks.execution.manage',task)
        can_advance=self.allowed('tasks.execution.advance',task)
        can_override=self.allowed('tasks.execution.override',task)
        phases=[]
        if execution:
            for phase in (execution.phases.filter(archived_at__isnull=True).select_related('unit','lead__employee','lead__position__unit')
                    .prefetch_related('prerequisites','responsible__employee','responsible__position__unit')):
                people=list(phase.responsible.all())
                phases.append({'id':str(phase.pk),'name':phase.name,'description':phase.description,
                    'completion_criteria':phase.completion_criteria,'position':phase.position,'unit':str(phase.unit_id),
                    'unit_name':phase.unit.name,'lead':str(phase.lead_id),
                    'responsible':[str(p.pk) for p in people],'people':[assignment_snapshot(p) for p in people],
                    'prerequisites':[str(p.pk) for p in phase.prerequisites.all()],
                    'required':phase.required,'status':phase.status,'review_required':phase.review_required,
                    'block_reason':phase.block_reason,'due_at':phase.due_at,'estimated_minutes':phase.estimated_minutes,
                    'ready_at':phase.ready_at,'started_at':phase.started_at,'completed_at':phase.completed_at,
                    'can_act':can_advance and (can_manage or any(p.pk==self.request.assignment.pk for p in people))})
        required=[p for p in phases if p['required']]
        return {'task_id':str(task.pk),'version':execution.version if execution else 0,'phases':phases,
            'can_manage':can_manage,'can_override':can_override,'required_count':len(required),
            'completed_count':sum(p['status'] in {'completed','skipped'} and not p['review_required'] for p in required),
            'can_finish':all(p['status'] in {'completed','skipped'} and not p['review_required'] for p in required)
                and not any(p['review_required'] for p in phases)}

    def get(self, request, task_id):
        return Response(self.pack(self.task(task_id)))

    @transaction.atomic
    def put(self, request, task_id):
        task=self.task(task_id,lock=True)
        self.require_permission('tasks.execution.manage',task.unit,task.pk)
        if set(request.data)-{'version','operation_id','phases'}:
            raise ValidationError('La definición incluye campos no admitidos.')
        execution,_=TaskExecution.objects.get_or_create(task=task,defaults={'version':0})
        execution=TaskExecution.objects.select_for_update().get(pk=task.pk)
        execution.task=task
        if command(execution,request.assignment,request.data):
            previous_units=execution_units(execution)
            update_definition(execution,request.assignment,request.data)
            finish_command(execution,request.assignment,previous_units)
        return Response(self.pack(task))

    @transaction.atomic
    def post(self, request, task_id):
        task=self.task(task_id,lock=True)
        if set(request.data)-{'version','operation_id','phase_id','action','reason'}:
            raise ValidationError('La transición incluye campos no admitidos.')
        execution=TaskExecution.objects.select_for_update().filter(task=task).first()
        if not execution:
            raise NotFound()
        phase=TaskPhase.objects.filter(pk=identity(request.data.get('phase_id'),'phase_id'),execution=execution,archived_at__isnull=True).first()
        if not phase:
            raise NotFound()
        action=request.data.get('action')
        if not isinstance(action,str) or action not in {'start','block','resume','complete','reopen','review','skip','archive'}:
            raise ValidationError('Selecciona una transición válida.')
        override=action in {'skip','archive'}
        self.require_permission('tasks.execution.override' if override else 'tasks.execution.advance',task.unit,task.pk)
        if not override and not self.allowed('tasks.execution.manage',task) and not phase.responsible.filter(pk=request.assignment.pk).exists():
            raise PermissionDenied('Solo sus responsables o la coordinación pueden cambiar esta etapa.')
        execution.task=task
        if command(execution,request.assignment,request.data):
            previous_units=execution_units(execution)
            transition(execution,phase,request.assignment,action,request.data.get('reason',''),can_override=override)
            finish_command(execution,request.assignment,previous_units)
        task.refresh_from_db()
        return Response(self.pack(task))


class ExecutionTimelineView(ExecutionView):
    def get(self, request, task_id):
        task=self.task(task_id)
        rows=TaskTimelineEvent.objects.filter(task=task).order_by('-sequence')
        if request.query_params.get('before'):
            try:
                cursor=int(request.query_params['before'])
                if cursor<1:raise ValueError()
            except (ValueError,TypeError):
                raise ValidationError('El cursor debe ser un número de secuencia positivo.')
            rows=rows.filter(sequence__lt=cursor)
        rows=list(rows[:101]);next_row=rows[99] if len(rows)>100 else None
        return Response({'results':[{'id':str(row.pk),'kind':row.kind,'phase_id':str(row.phase_id) if row.phase_id else None,
            'actor':row.actor_snapshot,'responsible':row.responsibility_snapshot,'before':row.before,'after':row.after,
            'reason':row.reason,'occurred_at':row.occurred_at} for row in rows[:100]],
            'next':{'before':next_row.sequence} if next_row else None})


class ExecutionPeopleView(ExecutionView):
    def get(self,request,task_id):
        from boldApp.core.models import PositionAssignment, OrganizationalUnit
        task=self.task(task_id)
        self.require_permission('tasks.execution.manage',task.unit,task.pk)
        people=PositionAssignment.objects.filter(is_active=True,released_at__isnull=True,employee__is_active=True,
            employee__user_account__is_active=True).select_related('employee','position__unit')[:1000]
        return Response({'people':[{'id':str(p.pk),'name':p.employee.full_name,'unit':str(p.position.unit_id),
            'unit_name':p.position.unit.name} for p in people],
            'units':[{'id':str(unit.pk),'name':unit.name} for unit in OrganizationalUnit.objects.all()[:500]]})


class ExecutionTemplatesView(ObjectRequestMixin, AssignmentScopedViewSetMixin, APIView):
    def get(self, request):
        rows=ExecutionTemplate.objects.filter(Q(owner=request.assignment)|Q(shared_with=request.assignment),archived_at__isnull=True).prefetch_related('shared_with').distinct()[:100]
        return Response({'results':[{'id':str(r.pk),'name':r.name,'definition':r.definition,'version':r.version,
            'can_manage':r.owner_id==request.assignment.pk,'shared_with':[str(person.pk) for person in r.shared_with.all()]} for r in rows]})

    @transaction.atomic
    def post(self, request):
        from boldApp.core.models import PositionAssignment
        from .execution_service import ExecutionConflict
        data=request.data
        PositionAssignment.objects.select_for_update().get(pk=request.assignment.pk)
        if set(data)-{'id','name','definition','shared_with','version','archive'}:
            raise ValidationError('La plantilla incluye campos no admitidos.')
        if data.get('id'):
            row=ExecutionTemplate.objects.select_for_update().filter(pk=identity(data['id'],'id'),owner=request.assignment).first()
            if not row:
                raise NotFound()
            if type(data.get('version')) is not int or data['version']!=row.version:
                raise ExecutionConflict()
        else:
            if ExecutionTemplate.objects.filter(owner=request.assignment).count()>=100:
                raise ValidationError('Puedes conservar hasta 100 plantillas propias.')
            row=ExecutionTemplate(owner=request.assignment)
        if data.get('archive') is True:
            row.archived_at=timezone.now()
        else:
            name=data.get('name','')
            if not isinstance(name,str) or not 1<=len(name.strip())<=120:
                raise ValidationError('Escribe un nombre de hasta 120 caracteres.')
            definition=validate_definition(data.get('definition'))
            row.name=name.strip()
            row.definition=[{k:(v.isoformat() if hasattr(v,'isoformat') else v) for k,v in item.items() if k!='position'} for item in definition]
        shared=data.get('shared_with',[])
        if not isinstance(shared,list) or len(shared)>100:
            raise ValidationError('Selecciona hasta 100 cargos para compartir.')
        ids={identity(key,'shared_with') for key in shared}
        people=PositionAssignment.objects.filter(pk__in=ids,is_active=True,released_at__isnull=True,employee__is_active=True,employee__user_account__is_active=True)
        if people.count()!=len(ids):
            raise ValidationError('Selecciona personas activas.')
        row.version+=1;row.save();row.shared_with.set(people)
        return Response({'id':str(row.pk),'version':row.version})
