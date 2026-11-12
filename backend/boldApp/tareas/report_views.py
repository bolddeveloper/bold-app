"""Saved definitions never grant access to their source data."""
from copy import deepcopy
from uuid import uuid4
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, ValidationError
from boldApp.core.models import PositionAssignment
from .views import AssignmentScopedViewSetMixin
from .models import SavedReport, Task, Project, MeetingWorkLink
from .execution_validation import identity, ObjectRequestMixin
from .execution_service import ExecutionConflict
from .report_validation import validate_report
from .report_metrics import METRICS
from .report_engine import ReportQuery


class ReportsView(ObjectRequestMixin, AssignmentScopedViewSetMixin, APIView):
    def require_reporting(self, manage=False):
        self.require_permission('reports.report.manage' if manage else 'reports.analytics.run',self.request.assignment.position.unit)

    def saved(self, report_id, *, own=False, lock=False):
        qs=SavedReport.objects.filter(pk=identity(report_id,'id'),archived_at__isnull=True)
        if own:qs=qs.filter(owner=self.request.assignment)
        else:qs=qs.filter(Q(owner=self.request.assignment)|Q(shared_with=self.request.assignment)).distinct()
        if lock:qs=qs.select_for_update()
        row=qs.first()
        if not row:raise NotFound()
        return row

    def effective_definition(self,row):
        definition=deepcopy(row.definition)
        # "My work" remains the creator's cohort when another employee opens
        # the shared definition, including its controls and explicit previews.
        if definition.get('scope')=='self' and row.owner_id!=self.request.assignment.pk:
            definition['scope']='accessible'
            definition.setdefault('filters',{})['assignments']=[str(row.owner_id)]
        return definition

    def pack(self,row):
        return {'id':str(row.pk),'name':row.name,'definition':self.effective_definition(row),'version':row.version,
                'owner':str(row.owner_id),'can_manage':row.owner_id==self.request.assignment.pk,
                'shared_with':list(map(str,row.shared_with.values_list('pk',flat=True))),
                'updated_at':row.updated_at}

    def get(self, request):
        self.require_reporting()
        rows=SavedReport.objects.filter(Q(owner=request.assignment)|Q(shared_with=request.assignment),archived_at__isnull=True).distinct()
        tab=request.query_params.get('collection','mine')
        if tab not in {'mine','shared'}:raise ValidationError('Selecciona Mis informes o Compartidos conmigo.')
        rows=rows.filter(owner=request.assignment) if tab=='mine' else rows.exclude(owner=request.assignment)
        return Response({'results':[self.pack(row) for row in rows[:100]],'limit':100})

    @transaction.atomic
    def post(self, request):
        self.require_reporting(manage=True)
        data=request.data
        if set(data)-{'id','version','name','definition','shared_with','archive'}:
            raise ValidationError('El informe incluye campos no admitidos.')
        key=identity(data.get('id') or uuid4(),'id')
        # Serialize same-owner creation and quota checks without a second store.
        PositionAssignment.objects.select_for_update().get(pk=request.assignment.pk)
        row=SavedReport.objects.select_for_update().filter(pk=key).first()
        if row:
            previous_readers=set(row.shared_with.values_list('pk',flat=True))|{row.owner_id}
            if row.owner_id!=request.assignment.pk:raise NotFound()
            if type(data.get('version')) is not int or row.version!=data['version']:raise ExecutionConflict()
        else:
            previous_readers=set()
            if data.get('version',0)!=0:raise ExecutionConflict()
            if SavedReport.objects.filter(owner=request.assignment).count()>=100:
                raise ValidationError('Puedes conservar hasta 100 informes propios.')
            row=SavedReport(id=key,owner=request.assignment,version=0)
        if data.get('archive') is True:
            row.archived_at=timezone.now()
        else:
            name=data.get('name','')
            if not isinstance(name,str) or not 1<=len(name.strip())<=120:
                raise ValidationError('Escribe un nombre de hasta 120 caracteres.')
            row.name=name.strip();row.definition=validate_report(data.get('definition'))
            # Validate reporting scope before persisting a misleading team definition.
            ReportQuery(self,row.definition)
        recipients=data.get('shared_with',[])
        if not isinstance(recipients,list) or len(recipients)>100:
            raise ValidationError('Selecciona hasta 100 cargos para compartir.')
        ids={identity(value,'shared_with') for value in recipients}
        people=PositionAssignment.objects.filter(pk__in=ids,is_active=True,released_at__isnull=True,
            employee__is_active=True,employee__user_account__is_active=True)
        if people.count()!=len(ids):raise ValidationError('Selecciona personas activas.')
        row.version+=1;row.save();row.shared_with.set(people)
        from .report_realtime import publish_reports_changed
        publish_reports_changed(recipients=previous_readers|set(people.values_list('pk',flat=True))|{row.owner_id})
        return Response(self.pack(row))


class ReportPreviewView(ReportsView):
    def post(self, request):
        self.require_reporting()
        if set(request.data)-{'id','definition','group_key','offset','download','detail_snapshot'}:
            raise ValidationError('La consulta incluye campos no admitidos.')
        if request.data.get('id'):
            saved=self.saved(request.data['id'])
            definition=self.effective_definition(saved)
        else:definition=request.data.get('definition',{})
        group=request.data.get('group_key');offset=request.data.get('offset',0)
        if (group is not None and (not isinstance(group,str) or len(group)>200)) or type(offset) is not int or not 0<=offset<=10000:
            raise ValidationError('Revisa la agrupación y la página de detalle.')
        download=request.data.get('download',False)
        if type(download) is not bool:raise ValidationError('Formato de descarga inválido.')
        snapshot=request.data.get('detail_snapshot')
        if snapshot is not None and (not isinstance(snapshot,str) or len(snapshot)!=64):raise ValidationError('La referencia de paginación no es válida.')
        result=ReportQuery(self,definition).run(detail_group=group,offset=0 if download else offset,detail_limit=10000 if download else 50,detail_snapshot=snapshot)
        if download:
            import csv,io
            from django.http import HttpResponse
            content=io.StringIO();writer=csv.writer(content)
            def safe(value):
                text=str(value if value is not None else '')
                return "'"+text if text.lstrip().startswith(('=','+','-','@')) else text
            writer.writerow(['Informe BOLD',result['label']]);writer.writerow(['Fórmula',result['formula']])
            writer.writerow(['Desde',result['definition']['from'],'Hasta',result['definition']['to']])
            writer.writerow(['Fecha de referencia',result['definition']['date_basis'],'Zona horaria',result['definition']['timezone']])
            writer.writerow(['Registros',result['detail_count']]);writer.writerow(['Nombre','Departamento','Responsable','Fecha de referencia','Estado','Valor','Unidad'])
            for row in result['details']:
                writer.writerow([safe(row.get(key)) for key in ('title','department','employee','at','status','value')]+[result['unit']])
            response=HttpResponse('\ufeff'+content.getvalue(),content_type='text/csv; charset=utf-8')
            response['Content-Disposition']='attachment; filename="informe-bold.csv"'
            response['Cache-Control']='no-store'
            return response
        return Response(result)


class ReportsCatalogView(ReportsView):
    def get(self,request):
        self.require_reporting()
        from boldApp.calendario.local import accessible
        query=ReportQuery(self,{})
        projects=self.visible_projects().select_related('unit')[:500]
        assignments=PositionAssignment.objects.select_related('employee','position__unit').filter(
            is_active=True,released_at__isnull=True,employee__is_active=True,employee__user_account__is_active=True)[:1000]
        return Response({'metrics':[{'id':key,'label':label,'unit':unit,'formula':formula} for key,(label,unit,formula) in METRICS.items()],
            'projects':[{'id':str(p.pk),'name':p.name,'unit':str(p.unit_id)} for p in projects],
            'units':[{'id':str(u.pk),'name':u.name} for u in self.authorization_units().values()],
            'people':[{'id':str(p.pk),'employee_id':str(p.employee_id),'name':p.employee.full_name,
                       'unit':str(p.position.unit_id),'unit_name':p.position.unit.name} for p in assignments],
            'team_units':list(map(str,query.team_units)),
            'calendars':[{'id':str(c.pk),'name':c.name} for c in accessible(request.user)],
            'limits':{'range_days':366,'source_rows':10000,'saved_reports':100},
            'meeting_coverage':'Calendarios BOLD accesibles; no mide asistencia.'})


class ReportFilterChoicesView(ReportsView):
    def get(self,request):
        self.require_reporting()
        search=request.query_params.get('q','')
        if len(search)>120:raise ValidationError('La búsqueda admite hasta 120 caracteres.')
        tasks=Task.objects.filter(title__icontains=search) if search else Task.objects.all()
        if tasks.count()>10000:raise ValidationError('Refina la búsqueda para revisar hasta 10 000 tareas candidatas.')
        tasks=self.visible_tasks(tasks)
        from .models import TaskStatus,Tag,TaskPhase
        rows=list(tasks.order_by('title','id').values('id','title')[:101])
        return Response({'tasks':[{'id':str(row['id']),'name':row['title']} for row in rows[:100]],'has_more':len(rows)>100,
            'statuses':[{'id':str(row.pk),'name':row.name,'unit':str(row.unit_id)} for row in TaskStatus.objects.filter(tasks__in=tasks).distinct()],
            'tags':[{'id':str(row.pk),'name':row.name} for row in Tag.objects.filter(task_tags__task__in=tasks).distinct()],
            'phases':list(TaskPhase.objects.filter(execution_id__in=tasks.values('pk')).order_by('name').values_list('name',flat=True).distinct()[:500])})


class MeetingWorkLinksView(ReportsView):
    def get(self,request):
        self.require_reporting()
        meeting=self.calendar_event(request.query_params.get('event_id'))
        rows=MeetingWorkLink.objects.filter(event=meeting).select_related('task__unit','project__unit')[:100]
        task_ids=set(self.visible_tasks(Task.objects.filter(meeting_links__in=rows)).values_list('pk',flat=True))
        project_ids=set(self.visible_projects(Project.objects.filter(meeting_links__in=rows)).values_list('pk',flat=True))
        from boldApp.core.authorization import resolve_access,apply_session_assurance
        from boldApp.core.models import Permission
        permissions={p.code:p for p in Permission.objects.filter(code__in=['tasks.task.update','tasks.project.manage'])}
        def can_manage(row):
            target=row.task if row.task_id else row.project
            permission=permissions.get('tasks.task.update' if row.task_id else 'tasks.project.manage')
            return bool(permission and apply_session_assurance(resolve_access(request.assignment,permission,target.unit,resource_id=target.pk),permission,request).allowed)
        return Response({'results':[{'id':str(row.pk),'task_id':str(row.task_id) if row.task_id else None,'can_manage':can_manage(row),
            'project_id':str(row.project_id) if row.project_id else None,'name':row.task.title if row.task_id else row.project.name}
            for row in rows if row.task_id in task_ids or row.project_id in project_ids]})

    def calendar_event(self,key):
        from boldApp.calendario.local import accessible
        from boldApp.calendario.models import AppCalendarEvent
        row=AppCalendarEvent.objects.filter(pk=identity(key,'event_id'),calendar__in=accessible(self.request.user)).first()
        if not row:raise NotFound()
        return row

    def target(self,data):
        if bool(data.get('task_id'))==bool(data.get('project_id')):
            raise ValidationError('Selecciona una tarea o un proyecto.')
        if data.get('task_id'):
            task=self.visible_tasks(Task.objects.filter(pk=identity(data['task_id'],'task_id'))).first()
            if not task:raise NotFound()
            return task,'task'
        project=self.visible_projects(Project.objects.filter(pk=identity(data['project_id'],'project_id'))).first()
        if not project:raise NotFound()
        return project,'project'

    @transaction.atomic
    def post(self,request):
        self.require_reporting()
        if set(request.data)-{'event_id','task_id','project_id'}:
            raise ValidationError('El vínculo incluye campos no admitidos.')
        meeting=self.calendar_event(request.data.get('event_id'))
        target,kind=self.target(request.data)
        self.require_permission('tasks.task.update' if kind=='task' else 'tasks.project.manage',target.unit,target.pk)
        row,_=MeetingWorkLink.objects.get_or_create(event=meeting,**{kind:target},defaults={'created_by':request.assignment})
        from .report_realtime import publish_reports_changed
        publish_reports_changed(scope='calendar')
        return Response({'id':str(row.pk)})

    @transaction.atomic
    def delete(self,request):
        self.require_reporting()
        if set(request.data)-{'event_id','task_id','project_id'}:raise ValidationError('El vínculo incluye campos no admitidos.')
        meeting=self.calendar_event(request.data.get('event_id'));target,kind=self.target(request.data)
        self.require_permission('tasks.task.update' if kind=='task' else 'tasks.project.manage',target.unit,target.pk)
        MeetingWorkLink.objects.filter(event=meeting,**{kind:target}).delete()
        from .report_realtime import publish_reports_changed
        publish_reports_changed(scope='calendar')
        return Response(status=204)
