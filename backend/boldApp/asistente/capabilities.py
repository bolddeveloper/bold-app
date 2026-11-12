"""Bounded allowlist. The model supplies values, never URLs, SQL or approval."""
import hashlib
import json
import re
from types import SimpleNamespace
from uuid import UUID, uuid4
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from .dispatch import call

READS = {'tasks.search', 'tasks.get', 'projects.search', 'projects.get', 'statuses.list',
         'sections.list', 'people.search', 'execution.get', 'calendars.list', 'events.list',
         'events.get', 'google.events', 'google.event', 'reports.catalog', 'reports.query'}
READS |= {'tasks.links','tasks.link','reports.list','reports.get'}
WRITES = {'tasks.create', 'tasks.update', 'projects.create', 'projects.update', 'tasks.organize',
          'execution.define', 'execution.advance', 'events.create', 'events.update',
          'google.create', 'google.update', 'reports.save'}
MODULES = {'tasks', 'projects', 'execution', 'calendars', 'reports'}
READ_ARGUMENTS = {
    'tasks.links':{'task':'UUID de tarea'},'tasks.link':{'id':'entero positivo de relación tarea-proyecto'},
    'reports.list':{'q':'nombre opcional','collection':'mine/shared'},'reports.get':{'id':'UUID'},
    'tasks.search':{'q':'texto opcional','unit':'UUID de departamento; predeterminado el activo','assignee':'UUID opcional','project':'UUID opcional','ids':'lista opcional de UUID'},
    'projects.search':{'q':'texto opcional','unit':'UUID de departamento; predeterminado el activo','ids':'lista opcional de UUID'},
    'people.search':{'q':'nombre','department':'nombre del departamento opcional'},
    'tasks.get':{'id':'UUID'},'projects.get':{'id':'UUID'},'execution.get':{'id':'UUID de tarea'},
    'statuses.list':{'unit':'UUID opcional'},'sections.list':{'project':'UUID'},
    'calendars.list':{},'events.list':{'calendar':'UUID','start':'ISO con zona','end':'ISO con zona'},
    'events.get':{'calendar':'UUID','id':'UUID'},'google.events':{'start':'ISO con zona','end':'ISO con zona'},
    'google.event':{'id':'ID de Google'},'reports.catalog':{'include_directory':'booleano opcional; false devuelve solo catálogo de métricas y límites'},
    'reports.query':{'metric':'ID de métrica','group_by':'none/day/week/month/project/department/employee/status/phase','from':'YYYY-MM-DD','to':'YYYY-MM-DD','timezone':'zona IANA','filters':'objeto de filtros','scope':'accessible/self/team','date_basis':'created/completed/due/activity/start','visualization':'number/bar/line/distribution/table','include_subtasks':'booleano'},
}
FIELDS = {
    'tasks.create': {'title','description','unit','status','priority','start_date','due_date','due_time','assignee_assignment','project','section','parent_task'},
    'tasks.update': {'title','description','unit','status','priority','start_date','due_date','due_time','assignee_assignment'},
    'projects.create': {'name','description','unit','owner_assignment','color_hex','status','priority','start_date','end_date','member_ids'},
    'projects.update': {'name','description','unit','owner_assignment','color_hex','status','priority','start_date','end_date','member_ids'},
    'tasks.organize': {'task','project','section','position'},
    'execution.define': {'phases','version'}, 'execution.advance': {'phase_id','action','reason','version'},
    'events.create': {'summary','description','start','end','color','attendees','location'},
    'events.update': {'summary','description','start','end','color','attendees','location'},
    'google.create': {'summary','description','start','end','attendees','location','reminders','addMeet'},
    'google.update': {'summary','description','start','end','attendees','location','reminders','addMeet','removeMeet'},
    'reports.save': {'id','version','name','definition','shared_with'},
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def identity(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise ValidationError('Selecciona un identificador válido de los datos autorizados.') from None


def external_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',value):
        raise ValidationError('Identificador de Google inválido.')
    return value


def link_id(value):
    text=str(value)
    if not text.isascii() or not text.isdecimal() or not 0<int(text)<2**63:raise ValidationError('Selecciona una relación tarea-proyecto válida.')
    return text


def module(cap):
    return 'calendars' if cap.startswith(('google.','events.','calendars.')) else 'tasks' if cap.startswith(('people.','statuses.','sections.')) else cap.split('.')[0]


def validate_queries(queries, modules):
    if not isinstance(queries,list) or len(queries)>12:
        raise ValidationError('La consulta admite hasta doce fuentes acotadas.')
    clean=[]
    for row in queries:
        if not isinstance(row,dict) or set(row)-{'capability','arguments'} or row.get('capability') not in READS:
            raise ValidationError('Consulta no admitida.')
        if module(row['capability']) not in modules or not isinstance(row.get('arguments',{}),dict):
            raise ValidationError('La consulta excede el alcance aprobado.')
        if set(row.get('arguments',{}))-set(READ_ARGUMENTS[row['capability']]):
            raise ValidationError('Hay filtros que no pertenecen a esta consulta.')
        if len(json.dumps(row))>6000:
            raise ValidationError('Acota los filtros de consulta.')
        clean.append({'capability':row['capability'],'arguments':row.get('arguments',{})})
    return clean


def validate_steps(steps, modules):
    if not isinstance(steps,list) or len(steps)>25:
        raise ValidationError('Una propuesta admite hasta 25 acciones.')
    if len(json.dumps(steps))>128*1024:raise ValidationError('La propuesta supera 128 KB; divide la petición.')
    known=set();clean=[]
    for row in steps:
        if not isinstance(row,dict) or set(row)-{'id','capability','target','arguments','depends_on'}:
            raise ValidationError('Acción inválida.')
        cap=row.get('capability');key=row.get('id','')
        if cap not in WRITES or module(cap) not in modules or not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}',key) or key in known:
            raise ValidationError('La acción no pertenece al catálogo aprobado.')
        args=row.get('arguments',{});deps=row.get('depends_on',[])
        if not isinstance(args,dict) or set(args)-FIELDS[cap] or not isinstance(deps,list) or any(not isinstance(v,str) for v in deps) or not set(deps)<=known:
            raise ValidationError('Revisa campos y dependencias de la propuesta.')
        if cap=='execution.advance' and args.get('action') not in {'start','block','resume','complete','reopen','review'}:
            raise ValidationError('Las excepciones de etapas se realizan manualmente.')
        if cap.startswith(('tasks.','projects.')) and any(isinstance(v,str) and '<img' in v.lower() for v in args.values()):
            raise ValidationError('Los adjuntos se añaden desde los controles de Drive.')
        target=row.get('target','')
        if not isinstance(target,str) or len(target)>240:
            raise ValidationError('Destino inválido.')
        references=([target[1:]] if target.startswith('$') else [])+[v[1:] for v in args.values() if isinstance(v,str) and v.startswith('$')]
        if not set(references)<=known:raise ValidationError('Las referencias deben pertenecer a pasos anteriores.')
        deps=list(dict.fromkeys(deps+references))
        clean.append({'id':key,'capability':cap,'target':target,'arguments':args,'depends_on':deps})
        known.add(key)
    return clean


def search(job, kind, args):
    from boldApp.tareas.models import Task,Project
    from boldApp.tareas.views import AssignmentScopedViewSetMixin
    if set(args)-{'q','unit','ids','assignee','project'}:
        raise ValidationError('Filtros de búsqueda no admitidos.')
    unit=identity(args.get('unit',job.assignment.position.unit_id))
    model=Task if kind=='tasks' else Project
    qs=model.objects.all() if kind=='tasks' and args.get('project') and not args.get('unit') else model.objects.filter(unit_id=unit)
    text=args.get('q','')
    if not isinstance(text,str) or len(text)>180:
        raise ValidationError('Acota el nombre buscado.')
    if text:qs=qs.filter(**{('title' if kind=='tasks' else 'name')+'__icontains':text})
    if args.get('ids'):
        if not isinstance(args['ids'],list) or len(args['ids'])>50:raise ValidationError('Selecciona hasta 50 registros.')
        qs=qs.filter(pk__in=[identity(v) for v in args['ids']])
    if kind=='tasks' and args.get('assignee'):qs=qs.filter(assignee_assignment_id=identity(args['assignee']))
    if kind=='tasks' and args.get('project'):
        from boldApp.tareas.models import TaskProject
        call(job,'GET',f'/api/v2/projects/{identity(args["project"])}/')
        qs=qs.filter(pk__in=TaskProject.objects.filter(project_id=identity(args['project'])).values('task_id'))
    candidates=list(qs.order_by('pk').values_list('pk',flat=True)[:1001])
    if len(candidates)>1000:raise ValidationError('Acota la consulta por nombre o responsable.')
    view=AssignmentScopedViewSetMixin()
    view.request=SimpleNamespace(assignment=job.assignment,auth=job.session,user=job.account,query_params={})
    qs=(view.visible_tasks if kind=='tasks' else view.visible_projects)(model.objects.filter(pk__in=candidates))
    fields=['id','title','status_id','status__is_final','due_date','assignee_assignment_id','unit_id','updated_at'] if kind=='tasks' else ['id','name','unit_id','updated_at']
    rows=list(qs.order_by('pk').values(*fields)[:51])
    from django.core.serializers.json import DjangoJSONEncoder
    return json.loads(json.dumps({'results':rows[:50],'partial':len(rows)>50},cls=DjangoJSONEncoder))


def read(job, spec):
    from .access import require
    require(SimpleNamespace(assignment=job.assignment,auth=job.session,user=job.account,META={}))
    cap=spec['capability'];args=dict(spec.get('arguments',{}))
    if cap in {'tasks.search','projects.search'}:return search(job,cap.split('.')[0],args)
    if cap=='people.search':
        from boldApp.tareas.team import active_assignments
        q=args.get('q','')
        if set(args)-{'q','department'} or not isinstance(q,str) or len(q)>120:raise ValidationError('Revisa la búsqueda de personas.')
        people=active_assignments().filter(employee__full_name__icontains=q)
        if args.get('department'):people=people.filter(position__unit__name__iexact=args['department'])
        rows=list(people.select_related('employee','position__unit').order_by('employee__full_name','pk')[:51])
        return {'results':[{'id':str(p.pk),'name':p.employee.full_name,'unit':str(p.position.unit_id),'department':p.position.unit.name} for p in rows[:50]],'partial':len(rows)>50}
    if cap in {'tasks.get','projects.get','execution.get'}:
        if set(args)!={'id'}:raise ValidationError('Indica el registro que se consultará.')
        stem={'tasks.get':'tasks','projects.get':'projects','execution.get':'task-execution'}[cap]
        return call(job,'GET',f'/api/v2/{stem}/{identity(args["id"])}/')
    if cap=='tasks.links':return call(job,'GET','/api/v2/task-projects/',query={'tasks':identity(args['task'])})
    if cap=='tasks.link':return call(job,'GET',f'/api/v2/task-projects/{link_id(args["id"])}/')
    if cap in {'reports.list','reports.get'}:
        if cap=='reports.get':
            key=identity(args['id'])
            for tab in ('mine','shared'):
                result=call(job,'GET','/api/v2/reports/',query={'collection':tab})
                found=next((r for r in result['results'] if r['id']==key),None)
                if found:return found
            from rest_framework.exceptions import NotFound
            raise NotFound()
        result=call(job,'GET','/api/v2/reports/',query={'collection':args.get('collection','mine')})
        text=args.get('q','').casefold()
        return {'results':[r for r in result['results'] if text in r['name'].casefold()][:20],'partial':len(result['results'])>20}
    if cap=='statuses.list':return call(job,'GET','/api/v2/task-statuses/',query={'unit':identity(args.get('unit',job.assignment.position.unit_id))})
    if cap=='sections.list':return call(job,'GET','/api/v2/sections/',query={'project':identity(args['project'])})
    if cap=='calendars.list':return call(job,'GET','/api/v2/calendar/local/')
    if cap in {'events.list','events.get'}:
        calendar=identity(args.pop('calendar'))
        if cap=='events.get':
            from boldApp.calendario.local import calendar_for, public_event
            from django.shortcuts import get_object_or_404
            row=get_object_or_404(calendar_for(job.account,calendar).events,pk=identity(args.pop('id')))
            return public_event(row,editable=False)
        event=''
        if set(args)-{'start','end'}:raise ValidationError('Filtros de calendario inválidos.')
        return call(job,'GET',f'/api/v2/calendar/local/{calendar}/events{event}/',query=args)
    if cap=='google.events':
        from .google import events
        return events(job,args)
    if cap=='google.event':
        event='/'+external_id(args.pop('id')) if cap=='google.event' else ''
        if set(args)-{'start','end'}:raise ValidationError('Filtros de Google inválidos.')
        return call(job,'GET',f'/api/v2/calendar/events{event}/',query=args)
    if cap=='reports.catalog':
        value=call(job,'GET','/api/v2/reports/catalog/')
        if args.get('include_directory') is True:return value
        return {key:value[key] for key in ('metrics','limits','meeting_coverage','team_units')}
    if cap=='reports.query':return call(job,'POST','/api/v2/reports/preview/',{'definition':args})
    raise ValidationError('Consulta no admitida.')


def write(job, step, results):
    cap=step['capability'];args=dict(step['arguments']);target=step['target']
    if target.startswith('$'):
        target=str(results[target[1:]]['id'])
    # References may only name prior approved steps and only substitute their IDs.
    for key,value in list(args.items()):
        if isinstance(value,str) and value.startswith('$'):
            if value[1:] not in step['depends_on']:raise ValidationError('Referencia no aprobada.')
            args[key]=results[value[1:]]['id']
    if cap in {'tasks.create','projects.create'}:
        return call(job,'POST',f'/api/v2/{cap.split(".")[0]}/',args)
    if cap in {'tasks.update','projects.update'}:
        return call(job,'PATCH',f'/api/v2/{cap.split(".")[0]}/{identity(target)}/',args)
    if cap=='tasks.organize':return call(job,'PATCH' if target else 'POST',f'/api/v2/task-projects/{link_id(target)+"/" if target else ""}',args)
    if cap.startswith('execution.'):
        args['operation_id']=str(__import__('uuid').uuid5(job.execution_id,step['id']))
        return call(job,'PUT' if cap=='execution.define' else 'POST',f'/api/v2/task-execution/{identity(target)}/',args)
    if cap in {'events.create','events.update'}:
        parts=target.split(':');calendar=identity(parts[0]);suffix=''
        if cap=='events.update':suffix=identity(parts[1])+'/'
        return call(job,'POST' if cap.endswith('create') else 'PATCH',f'/api/v2/calendar/local/{calendar}/events/{suffix}',args)
    if cap.startswith('google.'):
        from .google import perform
        return perform(job,step,args,target)
    if cap=='reports.save':return call(job,'POST','/api/v2/reports/',args)
    raise ValidationError('Acción no admitida.')
