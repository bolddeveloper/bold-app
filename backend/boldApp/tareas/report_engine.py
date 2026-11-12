"""Authorized, bounded reporting over operational facts and explicit cohorts."""
from collections import defaultdict
import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone as utc_timezone
from zoneinfo import ZoneInfo
from django.db.models import Q, Max
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from boldApp.core.authorization import check_and_log
from boldApp.core.models import OrganizationalUnit
from .models import Task, Project, TaskPhase, TaskTimelineEvent
from .report_validation import validate_report, report_period
from .report_metrics import METRICS, distribution, phase_intervals

MAX_ROWS=10000


def bounded(queryset, limit=MAX_ROWS):
    rows=list(queryset[:limit+1])
    if len(rows)>limit:
        raise ValidationError('El conjunto supera el límite del informe. Reduce el período o selecciona proyectos y departamentos.')
    return rows


class ReportQuery:
    def __init__(self,view,definition):
        self.view=view;self.request=view.request;self.assignment=self.request.assignment
        self.definition=validate_report(definition)
        self.filters=self.definition['filters'];self.metric=self.definition['metric']
        self.start,self.end=report_period(self.definition)
        self.now=timezone.now();self.zone=ZoneInfo(self.definition['timezone'])
        self.source=self.metric.split('.')[0]
        self.team_units=self.allowed_team_units()
        selected_people=self.filters.get('assignments',[])
        if self.definition['scope']=='team' or self.definition['group_by']=='employee' or selected_people:
            from boldApp.core.models import PositionAssignment
            other=PositionAssignment.objects.filter(pk__in=selected_people).exclude(employee_id=self.assignment.employee_id)
            if (self.definition['scope']=='team' or self.definition['group_by']=='employee' or other.exists()) and not self.team_units:
                raise PermissionDenied('La comparación de empleados requiere supervisión o un permiso explícito de Informes.')
            if other.exclude(position__unit_id__in=self.team_units).exists():
                raise PermissionDenied('La selección incluye empleados fuera de tu alcance de supervisión.')
        self.coverage={'historical_unknown':0,'sample_size':0,'clock_anomalies':0}

    def allowed_team_units(self):
        return set(self.view.allowed_unit_ids('reports.team.read'))

    def task_candidates(self, projects=None):
        rows=Task.objects.all()
        if projects is not None:rows=rows.filter(task_projects__project__in=projects)
        historical=self.metric in {'tasks.completed','tasks.reopened','tasks.lead_hours','tasks.on_time'}
        if historical and self.definition['date_basis'] in {'completed','activity'}:
            kind='task.reopened' if self.metric=='tasks.reopened' else 'task.completed'
            event_tasks=TaskTimelineEvent.objects.filter(kind=kind,occurred_at__gte=self.start,occurred_at__lt=self.end).values('task_id')
            cohort=Q(pk__in=event_tasks)
            if self.metric in {'tasks.completed','tasks.lead_hours','tasks.on_time'}:
                cohort|=Q(completed_at__gte=self.start,completed_at__lt=self.end)
            rows=rows.filter(cohort)
        if not self.definition['include_subtasks']:rows=rows.filter(parent_task__isnull=True)
        for key,field in [('tasks','pk__in'),('projects','task_projects__project_id__in'),
                          ('units','unit_id__in'),('statuses','status_id__in'),('tags','task_tags__tag_id__in')]:
            if not self.filters.get(key):continue
            if key=='units':
                if self.source!='tasks' or historical:continue
                rows=rows.filter(Q(assignee_assignment__position__unit_id__in=self.filters[key])|
                    Q(assignee_assignment__isnull=True,unit_id__in=self.filters[key]))
            else:rows=rows.filter(**{field:self.filters[key]})
        # Historical facts are filtered by their frozen assignment below. Current
        # workload uses the current assignment instead.
        if not historical and self.source=='tasks':
            if self.filters.get('assignments'):rows=rows.filter(assignee_assignment_id__in=self.filters['assignments'])
            if self.definition['scope']=='self':rows=rows.filter(assignee_assignment__employee_id=self.assignment.employee_id)
            if self.definition['scope']=='team':rows=rows.filter(assignee_assignment__position__unit_id__in=self.team_units)
        if self.source=='tasks' and self.definition['date_basis']=='created':rows=rows.filter(created_at__gte=self.start,created_at__lt=self.end)
        elif self.source=='tasks' and self.definition['date_basis']=='due':rows=rows.filter(due_date__gte=self.definition['from'],due_date__lte=self.definition['to'])
        elif self.source=='tasks' and self.definition['date_basis']=='activity' and not historical:
            rows=rows.filter(Q(created_at__lt=self.end)&(Q(completed_at__isnull=True)|Q(completed_at__gte=self.start)))
        # Count authorization candidates before loading resource contexts; never
        # silently truncate or derive totals from frontend pagination.
        if rows.distinct().count()>MAX_ROWS:
            raise ValidationError('Selecciona un conjunto de hasta 10 000 tareas para verificar sus permisos.')
        return self.view.visible_tasks(rows.distinct())

    def task_records(self):
        tasks=bounded(self.task_candidates().order_by('-created_at','pk').select_related('status','unit','assignee_assignment__employee',
            'assignee_assignment__position__unit','tracking').prefetch_related('task_projects__project'))
        visible_projects=set(self.view.visible_projects(Project.objects.filter(task_projects__task_id__in=[t.pk for t in tasks]).distinct()).values_list('pk',flat=True))
        facts={}
        kind='task.reopened' if self.metric=='tasks.reopened' else 'task.completed'
        if self.metric in {'tasks.completed','tasks.reopened','tasks.lead_hours','tasks.on_time'}:
            events=TaskTimelineEvent.objects.filter(task_id__in=[t.pk for t in tasks],kind=kind,occurred_at__lte=self.now)
            if self.definition['date_basis'] in {'completed','activity'}:
                events=events.filter(occurred_at__gte=self.start,occurred_at__lt=self.end)
            if self.filters.get('assignments'):events=events.filter(responsible_assignment_id__in=self.filters['assignments'])
            if self.filters.get('units'):events=events.filter(responsible_unit_id__in=self.filters['units'])
            if self.definition['scope']=='self':events=events.filter(responsible_employee_id=self.assignment.employee_id)
            if self.definition['scope']=='team':events=events.filter(responsible_unit_id__in=self.team_units)
            for row in bounded(events.order_by('task_id','sequence')):facts[row.task_id]=row
        records=[]
        for task in tasks:
            person=task.assignee_assignment
            fact=facts.get(task.pk)
            historical=self.metric in {'tasks.completed','tasks.reopened','tasks.lead_hours','tasks.on_time'}
            if historical and not fact:
                # Legacy timestamps are usable only when the requested metric
                # does not need a responsibility/deadline history we never had.
                tracking=getattr(task,'tracking',None)
                if (tracking and tracking.complete_history) or self.metric not in {'tasks.completed','tasks.lead_hours','tasks.on_time'} or not task.completed_at:
                    continue
                if self.definition['date_basis'] in {'completed','activity'} and not self.start<=task.completed_at<self.end:
                    continue
                if self.definition['scope']!='accessible' or self.filters.get('assignments') or self.filters.get('units') or self.definition['group_by'] in {'employee','department'}:
                    continue
                self.coverage['historical_unknown']+=1
            if self.metric=='tasks.active' and (task.status.is_final or task.status.category!='in_progress'):continue
            if self.metric in {'tasks.aging_hours','tasks.overdue'} and task.status.is_final:continue
            if self.metric=='tasks.overdue' and (not task.due_date or task.due_date>=self.now.astimezone(self.zone).date()):continue
            instant=fact.occurred_at if fact else task.completed_at if historical else task.created_at
            completed_instant=instant
            if self.definition['date_basis']=='created':instant=task.created_at
            if self.definition['date_basis']=='completed' and not historical:
                if not task.completed_at or not self.start<=task.completed_at<self.end:continue
                instant=task.completed_at
            if self.definition['date_basis']=='due' and task.due_date:
                from datetime import datetime,time
                instant=datetime.combine(task.due_date,time.min,tzinfo=self.zone)
            responsible=next((p for p in fact.responsibility_snapshot if p.get('assignment_id')==str(fact.responsible_assignment_id)),{}) if fact else {}
            current_unit=person.position.unit if person else task.unit
            unit=responsible.get('unit_id') or ((fact.after.get('unit_id') or 'unassigned') if fact else 'unknown' if historical else str(current_unit.pk))
            if self.definition['group_by']=='employee' and (responsible or person) and unit not in {str(u) for u in self.team_units}:
                continue
            value=1;denominator=1
            if self.metric=='tasks.progress':value=int(task.status.is_final)
            elif self.metric=='tasks.lead_hours':
                seconds=(completed_instant-task.created_at).total_seconds()
                value=seconds/3600 if seconds>=0 else None
                self.coverage['clock_anomalies']+=int(seconds<0)
            elif self.metric=='tasks.aging_hours':value=max(0,(self.now-task.created_at).total_seconds())/3600
            elif self.metric=='tasks.on_time':
                due=(fact.after or {}).get('due_date') if fact else None
                value=int(completed_instant.astimezone(self.zone).date()<=date.fromisoformat(due)) if due else None
            records.append({'id':str(task.pk),'task_id':str(task.pk),'title':task.title,'value':value,'denominator':denominator,
                'at':instant,'status':task.status.name,'department_id':unit,
                'department':responsible.get('unit_name') or ((fact.after.get('unit_name') or 'Sin departamento registrado') if fact else 'Sin atribución histórica' if historical else current_unit.name),
                'employee_id':responsible.get('employee_id') or (str(person.employee_id) if person and not historical else 'unassigned'),
                'employee':responsible.get('name') or (person.employee.full_name if person and not historical else 'Sin atribución histórica'),
                'projects':[(str(link.project_id),link.project.name) for link in task.task_projects.all() if link.project_id in visible_projects]})
        return records

    def phase_records(self):
        tasks=self.task_candidates()
        historical=self.metric in {'phases.completed','phases.on_time','phases.reopened','phases.cycle_hours'} or self.definition['date_basis']=='completed'
        phases=TaskPhase.objects.filter(execution_id__in=tasks.values('pk'))
        if not historical:phases=phases.filter(archived_at__isnull=True)
        if self.filters.get('units') and not historical:phases=phases.filter(unit_id__in=self.filters['units'])
        if self.filters.get('assignments') and not historical:phases=phases.filter(responsible__id__in=self.filters['assignments'])
        if self.filters.get('phases'):phases=phases.filter(name__in=self.filters['phases'])
        if self.filters.get('phase_states'):phases=phases.filter(status__in=self.filters['phase_states'])
        if self.definition['scope']=='self' and not historical:phases=phases.filter(responsible__employee_id=self.assignment.employee_id)
        if self.definition['scope']=='team' and not historical:phases=phases.filter(responsible__position__unit_id__in=self.team_units)
        basis=self.definition['date_basis']
        if basis=='created':phases=phases.filter(created_at__gte=self.start,created_at__lt=self.end)
        elif basis=='due':phases=phases.filter(due_at__gte=self.start,due_at__lt=self.end)
        elif basis=='activity':phases=phases.filter(created_at__lt=self.end).filter(Q(completed_at__isnull=True)|Q(completed_at__gte=self.start))
        phases=bounded(phases.distinct().select_related('execution__task','lead__employee','lead__position__unit','unit').prefetch_related('responsible__employee','responsible__position__unit','execution__task__task_projects__project'))
        visible_projects=set(self.view.visible_projects(Project.objects.filter(task_projects__task_id__in=[p.execution_id for p in phases]).distinct()).values_list('pk',flat=True))
        events=defaultdict(list)
        event_end=min(self.now,self.end) if basis in {'completed','activity'} else self.now
        for row in bounded(TaskTimelineEvent.objects.filter(phase_id__in=[p.pk for p in phases],occurred_at__lte=event_end).order_by('task_id','sequence'),50000):
            events[row.phase_id].append(row)
        records=[]
        for phase in phases:
            completed=[e for e in events[phase.pk] if e.kind=='phase.transition' and e.after.get('status')=='completed'
                and (basis not in {'completed','activity'} or self.start<=e.occurred_at<self.end)]
            reopened=[e for e in events[phase.pk] if e.kind=='phase.reopened' and (basis not in {'completed','activity'} or self.start<=e.occurred_at<self.end)]
            if (basis=='completed' or self.metric=='phases.completed') and not completed:continue
            if self.metric=='phases.reopened' and not reopened:continue
            fact=(reopened if self.metric=='phases.reopened' else completed)[-1] if (reopened if self.metric=='phases.reopened' else completed) else None
            people=fact.responsibility_snapshot if fact else []
            if historical:
                if not fact:continue
                if self.filters.get('assignments') and not any(p.get('assignment_id') in self.filters['assignments'] for p in people):continue
                if self.filters.get('units') and str(fact.responsible_unit_id) not in self.filters['units']:continue
                if self.definition['scope']=='self' and not any(p.get('employee_id')==str(self.assignment.employee_id) for p in people):continue
                if self.definition['scope']=='team' and not any(p.get('unit_id') in {str(u) for u in self.team_units} for p in people):continue
            timing_end=fact.occurred_at if basis=='completed' and fact else event_end
            timing=phase_intervals(events[phase.pk],timing_end,self.start if basis=='activity' else None)
            self.coverage['clock_anomalies']+=int(timing['clock_anomaly'])
            if not timing['observed']:self.coverage['historical_unknown']+=1
            value=1
            if self.metric=='phases.progress':
                if not phase.required:continue
                value=int(phase.status in {'completed','skipped'} and not phase.review_required)
            elif self.metric.startswith('phases.') and self.metric.endswith('_hours'):
                value=timing[self.metric.split('.')[1]] if timing['observed'] else None
                if timing['clock_anomaly']:value=None
                if self.metric=='phases.cycle_hours' and not completed:value=None
            elif self.metric=='phases.on_time':
                deadline=(fact.after or {}).get('due_at') if fact else None
                from django.utils.dateparse import parse_datetime
                value=int(fact.occurred_at<=parse_datetime(deadline)) if deadline else None
            lead=next((p for p in people if p.get('assignment_id')==str(fact.responsible_assignment_id)),{}) if fact else {}
            if not people:
                from .execution_history import assignment_snapshot
                people=[assignment_snapshot(p) for p in phase.responsible.all()]
            department_id=lead.get('unit_id') or str(phase.unit_id)
            if self.definition['group_by']=='employee' and not any(p.get('unit_id') in {str(u) for u in self.team_units} for p in people):continue
            records.append({'id':str(phase.pk),'task_id':str(phase.execution_id),'title':phase.execution.task.title+' · '+phase.name,
                'phase':phase.name,'value':value,'denominator':1,'at':phase.created_at if basis=='created' else phase.due_at if basis=='due' else fact.occurred_at if fact else phase.created_at,
                'status':phase.status,'status_label':phase.get_status_display()+(' · Requiere revisión' if phase.review_required else ''),'department_id':department_id,'department':lead.get('unit_name') or phase.unit.name,
                'employee_id':lead.get('employee_id') or str(phase.lead.employee_id),
                'employee':', '.join(dict.fromkeys(p.get('name','') for p in people)),
                'employees':[(p['employee_id'],p['name']) for p in people if p.get('employee_id') and p.get('unit_id') in {str(u) for u in self.team_units}],
                'projects':[(str(link.project_id),link.project.name) for link in phase.execution.task.task_projects.all() if link.project_id in visible_projects],
                'exception':phase.status=='skipped','review_required':phase.review_required})
        return records

    def project_records(self):
        projects=Project.objects.all()
        if self.filters.get('projects'):projects=projects.filter(pk__in=self.filters['projects'])
        if self.filters.get('units'):projects=projects.filter(unit_id__in=self.filters['units'])
        if self.filters.get('assignments'):projects=projects.filter(owner_assignment_id__in=self.filters['assignments'])
        if any(self.filters.get(key) for key in ('tasks','statuses','tags')):
            projects=projects.filter(task_projects__task__in=self.task_candidates(projects)).distinct()
        if self.definition['scope']=='self':projects=projects.filter(owner_assignment__employee_id=self.assignment.employee_id)
        if self.definition['scope']=='team':projects=projects.filter(unit_id__in=self.team_units)
        basis=self.definition['date_basis']
        if basis=='created':projects=projects.filter(created_at__gte=self.start,created_at__lt=self.end)
        else:projects=projects.filter(end_date__gte=self.definition['from'],end_date__lte=self.definition['to'])
        if projects.count()>MAX_ROWS:raise ValidationError('Selecciona hasta 10 000 proyectos candidatos.')
        projects=bounded(self.view.visible_projects(projects.distinct()).order_by('created_at','pk').select_related('unit','owner_assignment__employee','owner_assignment__position__unit'))
        tasks=self.task_candidates(Project.objects.filter(pk__in=[p.pk for p in projects])).distinct()
        from django.db.models import Count
        counts={str(row['task_projects__project_id']):row for row in tasks.order_by().values('task_projects__project_id').annotate(
            total=Count('pk',distinct=True),completed=Count('pk',filter=Q(status__is_final=True),distinct=True))}
        self.project_totals=tasks.aggregate(total=Count('pk',distinct=True),completed=Count('pk',filter=Q(status__is_final=True),distinct=True))
        work=defaultdict(set);self.project_done=set()
        for row in bounded(tasks.filter(task_projects__project_id__in=[p.pk for p in projects]).order_by()
                .values('pk','task_projects__project_id','status__is_final').distinct(),50000):
            work[row['task_projects__project_id']].add(str(row['pk']))
            if row['status__is_final']:self.project_done.add(str(row['pk']))
        rows=[]
        for project in projects:
            if self.definition['group_by']=='employee' and project.owner_assignment.position.unit_id not in self.team_units:continue
            count=counts.get(str(project.pk),{})
            rows.append({'id':str(project.pk),'title':project.name,'value':count.get('completed',0) if self.metric=='projects.progress' else 1,
                'denominator':count.get('total',0) if self.metric=='projects.progress' else 1,'at':project.created_at,
                'status':project.status,'department_id':str(project.unit_id),'department':project.unit.name,
                'employee_id':str(project.owner_assignment.employee_id),'employee':project.owner_assignment.employee.full_name,
                'projects':[(str(project.pk),project.name)],'work_items':work[project.pk]})
        return rows

    def meeting_records(self):
        from boldApp.calendario.local import accessible
        from boldApp.calendario.models import AppCalendarEvent
        from .models import MeetingWorkLink
        calendars=accessible(self.request.user)
        if self.filters.get('calendars'):calendars=calendars.filter(pk__in=self.filters['calendars'])
        events=AppCalendarEvent.objects.filter(calendar__in=calendars,start_at__lt=self.end,end_at__gt=self.start)
        if self.filters.get('tasks'):
            visible=self.view.visible_tasks(Task.objects.filter(pk__in=self.filters['tasks']))
            events=events.filter(work_links__task__in=visible)
        if self.filters.get('projects'):
            visible=self.view.visible_projects().filter(pk__in=self.filters['projects'])
            events=events.filter(work_links__project__in=visible)
        events=bounded(events.distinct().order_by('start_at','pk').select_related('calendar'))
        allowed_projects=set(self.view.visible_projects(Project.objects.filter(meeting_links__event_id__in=[e.pk for e in events]).distinct()).values_list('pk',flat=True))
        project_links=defaultdict(list)
        for link in MeetingWorkLink.objects.filter(event_id__in=[e.pk for e in events],project_id__in=allowed_projects).select_related('project'):
            project_links[link.event_id].append((str(link.project_id),link.project.name))
        rows=[];seen=set()
        for item in events:
            data=item.data
            from boldApp.calendario.service import is_task_mirror
            if data.get('status')=='cancelled' or data.get('kind')=='task' or is_task_mirror(data) or (data.get('start') or {}).get('date'):
                continue
            canonical=(data.get('iCalUID') or item.source_key or str(item.pk),item.start_at,item.end_at)
            if canonical in seen:continue
            seen.add(canonical)
            begin=max(item.start_at,self.start);end=min(item.end_at,self.end)
            duration=max(0,(end.astimezone(utc_timezone.utc)-begin.astimezone(utc_timezone.utc)).total_seconds())/3600
            # A supervisor never acquires a subordinate's private calendar here.
            record={'id':str(item.pk),'event_id':str(item.pk),'title':str(data.get('summary') or 'Reunión sin título'),
                'value':duration if self.metric=='meetings.scheduled_hours' else 1,'denominator':1,
                'at':begin,'scheduled_start':item.start_at,'status':'Programada','department_id':'calendar','department':'Calendario accesible',
                'employee_id':'calendar','employee':'No mide asistencia','projects':project_links[item.pk]}
            grain=self.definition['group_by']
            if self.metric=='meetings.scheduled_hours' and grain in {'day','week','month'}:
                cursor=begin
                while cursor<end:
                    local=cursor.astimezone(self.zone);day=local.date()
                    if grain=='month':next_day=day.replace(year=day.year+1,month=1,day=1) if day.month==12 else day.replace(month=day.month+1,day=1)
                    else:next_day=day+timedelta(days=1 if grain=='day' else 7-day.weekday())
                    boundary=datetime.combine(next_day,time.min,tzinfo=self.zone)
                    finish=min(end,boundary)
                    hours=(finish.astimezone(utc_timezone.utc)-cursor.astimezone(utc_timezone.utc)).total_seconds()/3600
                    rows.append({**record,'id':str(item.pk)+'@'+day.isoformat(),'at':cursor,'value':hours,'interval_end':finish})
                    cursor=finish
                    if len(rows)>MAX_ROWS:raise ValidationError('Hay demasiados intervalos de reuniones. Reduce el período o los calendarios.')
            else:rows.append(record)
        return rows

    def group_keys(self,row):
        group=self.definition['group_by']
        if group=='none':return [('all','Total')]
        if group=='project':return row['projects'] or [('unlinked','Sin proyecto accesible')]
        if group=='employee' and 'employees' in row:return list(dict.fromkeys(row['employees']))
        if group in {'department','employee'}:return [(row[group+'_id'],row[group])]
        if group in {'status','phase'}:return [(row.get(group,'Sin etapa'),row.get('status_label',row.get(group,'Sin etapa')) if group=='status' else row.get(group,'Sin etapa'))]
        day=row['at'].astimezone(self.zone).date()
        if group=='week':day-=timedelta(days=day.weekday())
        if group=='month':day=day.replace(day=1)
        return [(day.isoformat(),day.isoformat())]

    def measure(self,rows):
        unit=METRICS[self.metric][1]
        known=[row['value'] for row in rows if row['value'] is not None]
        if self.metric=='projects.progress':
            ids=set().union(*(row['work_items'] for row in rows)) if rows else set()
            done=len(ids&self.project_done)
            return {'value':round(100*done/len(ids),2) if ids else None,
                **distribution([100*row['value']/row['denominator'] if row['denominator'] else None for row in rows]),
                'distinct_tasks':len(ids),'completed_tasks':done}
        if unit=='percent':
            denominator=sum(row['denominator'] for row in rows if row['value'] is not None)
            value=round(100*sum(known)/denominator,2) if denominator else None
        elif unit=='hours' and self.source!='meetings':
            value=distribution([row['value'] for row in rows])['mean']
        else:value=round(sum(known),4)
        return {'value':value,**distribution([row['value'] for row in rows])}

    def run(self, *, detail_group=None, offset=0, detail_limit=50, detail_snapshot=None):
        if self.source=='tasks':rows=self.task_records()
        elif self.source=='phases':rows=self.phase_records()
        elif self.source=='projects':rows=self.project_records()
        else:rows=self.meeting_records()
        buckets=defaultdict(list);labels={}
        for row in rows:
            for key,label in self.group_keys(row):buckets[key].append(row);labels[key]=label
        self.coverage['sample_size']=len(rows)
        summary=self.measure(rows)
        if self.source=='meetings':summary['distinct_meetings']=len({row['event_id'] for row in rows})
        details=rows if detail_group is None else [row for row in rows if any(key==detail_group for key,_ in self.group_keys(row))]
        snapshot=hashlib.sha256(json.dumps([self.definition,detail_group,[row['id'] for row in details]],sort_keys=True).encode()).hexdigest()
        if offset and snapshot!=detail_snapshot:
            from .execution_service import ExecutionConflict
            raise ExecutionConflict('Los registros del conjunto cambiaron. Actualiza el informe antes de continuar con otra página.')
        return {'definition':self.definition,'label':METRICS[self.metric][0],'unit':METRICS[self.metric][1],
            'formula':METRICS[self.metric][2],'calculated_at':self.now,'coverage':self.coverage,
            'summary':summary,'groups':[{'key':key,'label':labels[key],**self.measure(items)} for key,items in sorted(buckets.items())],
            'details':[{**{k:v for k,v in row.items() if k not in {'projects','employees','work_items'}},
                'value':round(100*row['value']/row['denominator'],2) if METRICS[self.metric][1]=='percent' and row['value'] is not None and row['denominator'] else None if METRICS[self.metric][1]=='percent' else row['value']}
                for row in details[offset:offset+detail_limit]],
            'detail_count':len(details),'detail_group':detail_group,'total_source_count':len(rows),
            'detail_snapshot':snapshot,
            'details_next':offset+detail_limit if len(details)>offset+detail_limit else None,
            'details_has_more':len(details)>offset+detail_limit,
            'notice':'Resultados según tus permisos actuales. Los tiempos de estado no equivalen a horas de trabajo efectivo.'+
                (' Una etapa con varias personas aparece en cada responsable; el total conserva las etapas únicas.' if self.source=='phases' and self.definition['group_by']=='employee' else '')+
                (' El trabajo compartido aparece en cada proyecto relacionado; los totales generales conservan las tareas únicas.' if self.definition['group_by']=='project' else '')}
