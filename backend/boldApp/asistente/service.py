import json
from copy import copy
from datetime import timedelta
from types import SimpleNamespace
from uuid import UUID
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.http import Http404
from rest_framework.exceptions import APIException, ValidationError, PermissionDenied
from boldApp.core.models import UserAccount
from .models import AssistantRequest, Proposal, ActionReceipt, InferenceAttempt, Approval, ACTIVE
from .access import require, validate_session
from .capabilities import READS, WRITES, MODULES, validate_queries, validate_steps, read, write, digest
from . import planner, gate


def load(pk):
    return AssistantRequest.objects.select_related('account','session','assignment__employee','assignment__position__unit','assignment__position__job_role').get(pk=pk)


def actor_request(job):
    return SimpleNamespace(assignment=job.assignment,auth=job.session,user=job.account,META={},data={})


def notify(job):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    assignment=str(job.assignment_id)
    transaction.on_commit(lambda: async_to_sync(get_channel_layer().group_send)(f'assignment_{assignment}',
        {'type':'assistant.changed','request_id':str(job.pk)}))


def fail(job, message, state='failed'):
    AssistantRequest.objects.filter(pk=job.pk).update(state=state,error=message[:240],finished_at=timezone.now())
    InferenceAttempt.objects.filter(request=job,state='processing').update(state='failed',finished_at=timezone.now())
    notify(job)


def action_error(error):
    def text(value):
        if isinstance(value,dict):return '; '.join(f'{key}: {text(item)}' for key,item in value.items())
        if isinstance(value,list):return '; '.join(text(item) for item in value)
        return str(value)
    return text(error.detail)[:240] if isinstance(error,APIException) else 'La operación se interrumpió. Comprueba su resultado antes de continuar.'


def ensure_version(job, value):
    if type(value) is not int or value!=job.version:
        error=APIException('La solicitud cambió. Vuelve a revisar su versión actual.');error.status_code=409;raise error


@transaction.atomic
def create(request, data):
    require(request)
    if set(data)-{'text','client_id','context'}:raise ValidationError('Campos no admitidos.')
    text=data.get('text','')
    if not isinstance(text,str) or not 1<=len(text.strip())<=5000:raise ValidationError('Escribe una petición de hasta 5.000 caracteres.')
    try:client_id=UUID(str(data['client_id']))
    except (KeyError,ValueError,TypeError):raise ValidationError('Falta un identificador de petición válido.') from None
    UserAccount.objects.select_for_update().get(pk=request.user.pk)
    old=AssistantRequest.objects.filter(account=request.user,client_id=client_id).first()
    if old:
        if old.text!=text.strip() or old.assignment_id!=request.assignment.pk:raise ValidationError('El identificador ya pertenece a otra petición.')
        return old
    if AssistantRequest.objects.filter(account=request.user,state__in=ACTIVE).exists():
        raise ValidationError('Completa o cancela tu solicitud activa antes de crear otra.')
    context=data.get('context',{})
    if not isinstance(context,dict) or set(context)-{'task_id','project_id','channel_id'} or any(not isinstance(v,str) or len(v)>100 for v in context.values()):
        raise ValidationError('Contexto de origen inválido.')
    job=AssistantRequest.objects.create(account=request.user,assignment=request.assignment,session=request.auth,
        client_id=client_id,text=text.strip(),context=context)
    notify(job);return job


def current(job):
    return job.proposals.filter(version=job.version).first()


def revision_digest(query,value):
    if isinstance(value,dict):
        if query['capability'] in {'tasks.get','projects.get'} and value.get('updated_at'):
            return digest({'id':value.get('id'),'updated_at':value['updated_at']})
        if query['capability']=='execution.get':return digest({'task':value['task_id'],'version':value['version']})
    return digest(value)


def source_digest(query,value):
    if query['capability']=='reports.query' and isinstance(value,dict):
        # Calculation time changes on every read, without any source changing.
        value={key:item for key,item in value.items() if key!='calculated_at'}
    return digest(value)


def inspect_sources(job, proposal, strict=True):
    """Reauthorize every source before showing any derived content, including history."""
    values=[]
    for source in proposal.sources:
        data=read(job,source['query'])
        guard_sources(job,source.get('guards',[]))
        if (strict or source['query']['capability']=='reports.query') and source_digest(source['query'],data)!=source['digest']:
            raise ValidationError('Las fuentes cambiaron. Prepara y aprueba una propuesta nueva.')
        values.append(data)
    return values


def guard_sources(job,guards):
    from boldApp.tareas.models import Task,Project
    from boldApp.tareas.views import AssignmentScopedViewSetMixin
    view=AssignmentScopedViewSetMixin();view.request=actor_request(job)
    for guard in guards:
        if guard['kind']=='calendars':
            from boldApp.calendario.local import calendar_for
            for key in guard['ids']:calendar_for(job.account,key)
            continue
        if guard['kind']=='reports':
            for key in guard['ids']:read(job,{'capability':'reports.get','arguments':{'id':key}})
            continue
        ids=set(guard['ids']);model=Task if guard['kind']=='tasks' else Project
        scoped=(view.visible_tasks if guard['kind']=='tasks' else view.visible_projects)(model.objects.filter(pk__in=ids))
        if set(map(str,scoped.values_list('pk',flat=True)))!=ids:raise PermissionDenied('Una fuente ya no está disponible.')


def pack(job, request=None):
    if request:require(request)
    proposal=current(job);visible=True
    if proposal:
        authority=copy(job)
        if request:authority.session=request.auth
        try:values=inspect_sources(authority,proposal,strict=not bool(job.execution_id))
        except (APIException,Http404,ValueError,KeyError):visible=False
    result={'id':str(job.pk),'version':job.version,'state':job.state,'text':job.text,
        'summary':job.summary if visible else '', 'scope':job.scope if visible else {},
        'clarification':job.clarification if visible else '', 'error':job.error if visible else 'Los datos de esta propuesta ya no están disponibles. Revisa su acceso y vuelve a prepararla.',
        'created_at':job.created_at,'updated_at':job.updated_at,'sources_available':visible,'proposal':None,'receipts':[]}
    result['execution_started']=bool(job.execution_id)
    if proposal and visible:
        result['proposal']={'version':proposal.version,'summary':proposal.summary,'steps':proposal.steps,
            'digest':proposal.digest,'answer':proposal.answer,'approved_at':proposal.approved_at,
            'sources':[{'query':s['query']} for s in proposal.sources]}
        actor={'value':str(job.assignment_id),'label':job.assignment.employee.full_name}
        options={key:[actor] for key in ('assignee_assignment','lead','owner_assignment','responsible')}
        options['unit']=[{'value':str(job.assignment.position.unit_id),'label':job.assignment.position.unit.name}]
        labels={actor['value']:actor['label']}
        for source,value in zip(proposal.sources,values):
            cap=source['query']['capability']
            if isinstance(value,dict):
                items=value.get('results',[]) if 'results' in value else [value] if value.get('id') else []
                if cap=='reports.catalog':
                    for name,keys in [('people',['assignee_assignment','lead','owner_assignment','shared_with','member_ids','responsible']),('units',['unit']),('projects',['project'])]:
                        if value.get(name):options.update({key:[{'value':str(r['id']),'label':r['name']} for r in value[name]] for key in keys})
            elif isinstance(value,list):items=value
            else:items=[]
            for item in items:
                if isinstance(item,dict) and item.get('id'):
                    labels[str(item['id'])]=item.get('title') or item.get('name') or item.get('summary') or 'Registro seleccionado'
            keys={'statuses.list':['status'],'sections.list':['section'],'people.search':['assignee_assignment','lead','owner_assignment','shared_with','member_ids','responsible'],'projects.search':['project']}.get(cap,[])
            for key in keys:options[key]=[{'value':str(r['id']),'label':(r.get('name') or r.get('title') or 'Registro seleccionado')+(' · '+r['department'] if r.get('department') else '')} for r in items]
            if cap=='people.search':
                options['unit']=list({r['value']:r for r in options['unit']+[{'value':r['unit'],'label':r['department']} for r in items]}.values())
        before={}
        for step in proposal.steps:
            value=next((v for s,v in zip(proposal.sources,values) if s['query']['arguments'].get('id')==step['target']),{})
            if isinstance(value,dict):before[step['id']]={key:value.get(key) for key in step['arguments'] if key in value}
        result['proposal'].update(options=options,labels=labels,before=before)
        result['proposal']['reports']=[{'index':index,'data':value} for index,(source,value) in enumerate(zip(proposal.sources,values)) if source['query']['capability']=='reports.query']
        result['receipts']=[{'step_id':r.step_id,'capability':r.capability,'state':r.state,
            'result':r.result,'error':r.error,'finished_at':r.finished_at} for r in job.receipts.filter(proposal=proposal).order_by('pk')]
    if request:require(request)
    return result


@transaction.atomic
def change(request, job, data):
    require(request);ensure_version(job,data.get('version'))
    if job.state in {'executing','execute_queued'}:raise ValidationError('Cancela los pasos pendientes; una ejecución iniciada no puede editarse.')
    if job.execution_id:raise ValidationError('Conserva este comprobante. Para los pasos pendientes crea una solicitud nueva y explícita.')
    if set(data)-{'version','text','steps'}:raise ValidationError('Campos no admitidos.')
    old=current(job)
    job.version+=1;job.error='';job.clarification='';job.execution_id=None;job.cancel_requested=False;job.finished_at=None
    if 'steps' in data and 'text' not in data and old and job.state=='awaiting_approval':
        inspect_sources(job,old)
        steps=validate_steps(data['steps'],job.scope['modules'])
        # Editing cannot introduce new resource targets or capabilities without a new preparation.
        by_id={s['id']:s for s in old.steps}
        if any(s['id'] not in by_id or s['target']!=by_id[s['id']]['target'] or s['capability']!=by_id[s['id']]['capability'] for s in steps):
            raise ValidationError('Para cambiar destinos o añadir acciones, reformula la petición.')
        Proposal.objects.create(request=job,version=job.version,summary=old.summary,steps=steps,sources=old.sources,
            answer=old.answer,digest=digest({'steps':steps,'sources':old.sources}))
        job.state='awaiting_approval'
    else:
        text=data.get('text','')
        if not isinstance(text,str) or not 1<=len(text.strip())<=5000:raise ValidationError('Escribe la petición refinada.')
        job.text=text.strip();job.scope={};job.summary='';job.state='intent_queued'
    job.save();notify(job);return job


@transaction.atomic
def prepare(request,job,data):
    require(request);ensure_version(job,data.get('version'))
    if set(data)!={'version'}:raise ValidationError('Aprobación de consulta inválida.')
    if job.state in {'prepare_queued','preparing'}:return job
    if job.state!='awaiting_scope' or job.clarification:raise ValidationError('Resuelve las aclaraciones antes de consultar.')
    job.scope={**job.scope,'approved_at':timezone.now().isoformat()}
    Approval.objects.create(request=job,version=job.version,kind='scope',request_text=job.text,session=request.auth,
        content=job.scope,digest=digest(job.scope))
    job.state='prepare_queued';job.save();notify(job);return job


@transaction.atomic
def execute(request,job,data):
    require(request,'assistant.request.execute');ensure_version(job,data.get('version'))
    if set(data)!={'version','digest','execution_id'}:raise ValidationError('Aprobación de ejecución inválida.')
    try:key=UUID(str(data['execution_id']))
    except (ValueError,TypeError):raise ValidationError('Identificador de ejecución inválido.') from None
    if job.execution_id:
        if key!=job.execution_id:raise ValidationError('La solicitud ya tiene una ejecución. Consulta su comprobante.')
        return job
    proposal=current(job)
    if job.state!='awaiting_approval' or not proposal or data['digest']!=proposal.digest:
        raise ValidationError('Revisa y aprueba la propuesta actual.')
    if job.session_id!=request.auth.pk:raise PermissionDenied('Esta propuesta pertenece a otra sesión; prepara una nueva.')
    inspect_sources(job,proposal)
    proposal.approved_at=timezone.now();proposal.save(update_fields=['approved_at'])
    Approval.objects.create(request=job,version=job.version,kind='execution',request_text=job.text,session=request.auth,
        content={'proposal':proposal.pk,'steps':proposal.steps},digest=proposal.digest)
    job.execution_id=key;job.state='execute_queued';job.save();notify(job);return job


@transaction.atomic
def cancel(request,job,data):
    require(request);ensure_version(job,data.get('version'))
    job.cancel_requested=True
    if job.state not in {'executing','completed','partial','uncertain'}:
        job.state='cancelled';job.finished_at=timezone.now()
    job.save();notify(job);return job


def collect(job):
    from .references import resolve
    sources=[];values=[]
    for original in job.scope['queries']:
        query={'capability':original['capability'],'arguments':resolve(original['arguments'],values,sources)}
        value=read(job,query);values.append({'query':query,'data':value})
        guards=[]
        if query['capability'] in {'tasks.search','projects.search'}:
            guards=[{'kind':query['capability'].split('.')[0],'ids':[r['id'] for r in value['results']]}]
        if query['capability']=='reports.list':guards=[{'kind':'reports','ids':[r['id'] for r in value['results']]}]
        if query['capability']=='reports.catalog':
            guards=[{'kind':'projects','ids':[r['id'] for r in value.get('projects',[])]},
                    {'kind':'calendars','ids':[r['id'] for r in value.get('calendars',[])]}]
        if query['capability']=='calendars.list':guards=[{'kind':'calendars','ids':[r['id'] for r in value.get('calendars',value.get('results',[]))]}]
        sources.append({'query':query,'digest':source_digest(query,value),'guards':guards,'revision_digest':revision_digest(query,value)})
    if len(json.dumps(values,default=str))>24000:raise ValidationError('Las fuentes superan el contexto permitido; acota la consulta.')
    return sources,values


def normalize(job,steps,values):
    """Resolve native defaults and revision counters before presenting exact changes."""
    from uuid import uuid5
    counters={};phase_ids={}
    for step in steps:
        cap=step['capability'];args=step['arguments'];target=step['target']
        if cap in {'tasks.create','projects.create'}:
            args.setdefault('unit',str(job.assignment.position.unit_id))
            args.setdefault('assignee_assignment' if cap=='tasks.create' else 'owner_assignment',str(job.assignment_id))
        if cap=='tasks.create':
            args.setdefault('priority','Media')
            if not args.get('status'):
                candidates=[]
                for source in values:
                    if source['query']['capability']=='statuses.list':
                        rows=source['data'];rows=rows.get('results',[]) if isinstance(rows,dict) else rows
                        candidates.extend(r for r in rows if not r['is_final'] and str(r['unit'])==args['unit'])
                if not candidates:raise ValidationError('Incluye el catálogo de estados en el alcance de consulta.')
                args['status']=candidates[0]['id']
        if cap=='projects.create':
            args.setdefault('status','Activo');args.setdefault('priority','Media')
        if cap.startswith('execution.'):
            if target not in counters:
                source=next((v['data'] for v in values if v['query']['capability']=='execution.get' and v['query']['arguments'].get('id')==target),None)
                counters[target]=source['version'] if source else 0
            args['version']=counters[target];counters[target]+=1
        if cap=='execution.define':
            mapping={}
            prior=next((v['data'].get('phases',[]) for v in values if v['query']['capability']=='execution.get' and v['query']['arguments'].get('id')==target),[])
            existing_ids={p['id'] for p in prior}
            for phase in args.get('phases',[]):
                old=str(phase.get('id',''))
                mapping[old]=old if old in existing_ids else str(uuid5(job.pk,f'{job.version}:{step["id"]}:{old}'))
            if len(mapping)!=len(args.get('phases',[])):raise ValidationError('Cada etapa requiere una referencia diferente.')
            for phase in args.get('phases',[]):
                phase.setdefault('required',True)
                phase.setdefault('prerequisites',[])
                phase.setdefault('responsible',[phase['lead']] if phase.get('lead') else [])
                phase['id']=mapping[str(phase.get('id',''))]
                phase['prerequisites']=[mapping.get(str(v),str(v)) for v in phase.get('prerequisites',[])]
            phase_ids[target]=mapping
        if cap=='execution.advance':args['phase_id']=phase_ids.get(target,{}).get(str(args.get('phase_id')),args.get('phase_id'))
        if cap=='tasks.organize':args.setdefault('position',0)
    return steps


def target_sources(job,steps,sources,values):
    # A snapshot may only refine records returned by an approved query. The
    # planner cannot introduce an additional business read by inventing an ID.
    selected={key:set() for key in ('tasks','projects','execution','links','reports','calendars','events','google')}
    for source in values:
        cap=source['query']['capability'];data=source['data'];args=source['query']['arguments']
        if isinstance(data,dict):
            rows=next((data[key] for key in ('results','events','calendars') if isinstance(data.get(key),list)),[data])
        else:rows=data if isinstance(data,list) else []
        ids={str(row['id']) for row in rows if isinstance(row,dict) and row.get('id')}
        category={'tasks.search':'tasks','tasks.get':'tasks','projects.search':'projects','projects.get':'projects',
            'tasks.links':'links','tasks.link':'links','reports.list':'reports','reports.get':'reports',
            'calendars.list':'calendars','events.list':'events','events.get':'events','google.events':'google','google.event':'google'}.get(cap)
        if category:selected[category].update(ids)
        if cap=='execution.get':selected['execution'].add(str(args['id']))
        if cap in {'tasks.links','tasks.link'}:selected['tasks'].update(str(row['task']) for row in rows if row.get('task'))
        if cap in {'events.list','events.get'}:selected['calendars'].add(str(args['calendar']))
    def insist(category,key):
        if str(key) not in selected[category]:raise ValidationError('El destino no procede de las consultas aprobadas; refina el alcance.')
    for step in steps:
        cap=step['capability'];target=step['target']
        if cap=='events.create':insist('calendars',target)
        if cap=='reports.save' and step['arguments'].get('id'):insist('reports',step['arguments']['id'])
        if target.startswith('$') or cap.endswith('.create') or not target and cap!='reports.save':continue
        query=None
        if cap in {'tasks.update','projects.update','execution.define','execution.advance'}:
            insist('projects' if cap=='projects.update' else 'execution' if cap.startswith('execution.') and target in selected['execution'] else 'tasks',target)
            query={'capability':{'tasks.update':'tasks.get','projects.update':'projects.get','execution.define':'execution.get','execution.advance':'execution.get'}[cap],'arguments':{'id':target}}
        if cap=='google.update':
            insist('google',target);query={'capability':'google.event','arguments':{'id':target}}
        if cap=='tasks.organize':
            insist('links',target);query={'capability':'tasks.link','arguments':{'id':target}}
        if cap=='reports.save' and step['arguments'].get('id'):query={'capability':'reports.get','arguments':{'id':step['arguments']['id']}}
        if cap=='events.update':
            parts=target.split(':')
            if len(parts)!=2:raise ValidationError('Selecciona calendario y evento.')
            insist('calendars',parts[0]);insist('events',parts[1])
            query={'capability':'events.get','arguments':{'calendar':parts[0],'id':parts[1]}}
        if query:
            row=next((s for s in sources if s['query']==query),None)
            value=read(job,query)
            if row is None:
                row={'query':query,'digest':digest(value)};sources.append(row)
            row['revision_digest']=revision_digest(query,value)
            if cap=='google.update':row.update(google_id=target,etag=value.get('etag'))
    return sources


def infer(pk):
    owner=gate.acquire()
    if not owner:return False
    attempt=None;version=None
    try:
        with transaction.atomic():
            job=load(pk);row=AssistantRequest.objects.select_for_update().get(pk=pk)
            version=job.version
            if row.state not in {'intent_queued','prepare_queued'}:return False
            require(actor_request(job))
            from .quotas import daily_window
            start,end=daily_window()
            from boldApp.mensajeria.models import SupportRequest
            legacy=SupportRequest.objects.filter(created_at__gte=start,created_at__lt=end,admitted=True)
            usage=InferenceAttempt.objects.filter(created_at__gte=start,created_at__lt=end)
            if usage.count()+legacy.count()>=settings.BOLD_SUPPORT_DAILY_LIMIT or usage.filter(request__account=job.account).count()+legacy.filter(source__author_id=job.account.employee_id).count()>=settings.BOLD_SUPPORT_USER_DAILY_LIMIT:
                fail(job,'Se alcanzó la cuota diaria de inferencias.');return False
            kind='intent' if row.state=='intent_queued' else 'prepare'
            row.state='intent_processing' if kind=='intent' else 'preparing';row.save(update_fields=['state','updated_at'])
            version=job.version
        sources,values=collect(job) if kind=='prepare' else ([],[])
        with transaction.atomic():
            from .models import InferenceGate
            InferenceGate.objects.select_for_update().get(pk=1)
            if usage.count()+legacy.count()>=settings.BOLD_SUPPORT_DAILY_LIMIT or usage.filter(request__account=job.account).count()+legacy.filter(source__author_id=job.account.employee_id).count()>=settings.BOLD_SUPPORT_USER_DAILY_LIMIT:
                fail(job,'Se alcanzó la cuota diaria de inferencias.');return False
            require(actor_request(job))
            if not gate.renew(owner):raise ValidationError('La reserva de inferencia venció; no se iniciará el modelo.')
            attempt=InferenceAttempt.objects.create(request=job,kind=kind,model=settings.BOLD_SUPPORT_MODEL,
                wait_seconds=max(0,(timezone.now()-job.updated_at).total_seconds()))
        data,usage=planner.generate({'mode':kind,'request':job.text,'origin':job.context,
            'now':timezone.now().isoformat(),'timezone':settings.AUTH_SESSION_TIME_ZONE,
            'actor_assignment':str(job.assignment_id),'actor_unit':str(job.assignment.position.unit_id),
            'scope':job.scope if kind=='prepare' else {},'sources':values,
            'read_capabilities':sorted(READS),'write_capabilities':sorted(WRITES),
            'read_arguments':__import__('boldApp.asistente.capabilities',fromlist=['READ_ARGUMENTS']).READ_ARGUMENTS,
            'report_metrics':__import__('boldApp.tareas.report_metrics',fromlist=['METRICS']).METRICS,
            'fields':{cap:sorted(fields) for cap,fields in __import__('boldApp.asistente.capabilities',fromlist=['FIELDS']).FIELDS.items()},
            'write_contracts':{
                'execution.define':{'target':'task UUID or $prior-task-step','phases':[{'id':'unique step-local reference or existing phase UUID','name':'required string','unit':'department UUID','lead':'assignment UUID in department','responsible':['assignment UUID'],'prerequisites':['phase reference in same definition'],'required':'boolean, default true','completion_criteria':'optional text','description':'optional text','due_at':'optional ISO with timezone','estimated_minutes':'optional positive integer'}]},
                'execution.advance':{'target':'task UUID or $prior-task-step','phase_id':'existing phase UUID or reference from prior definition','action':'start/block/resume/complete/reopen/review','reason':'required for block/reopen/review'},
                'events.create':{'target':'BOLD calendar UUID from calendars.list'},
                'events.update':{'target':'calendar-UUID:event-UUID'},
                'google.create':{'target':'empty string; uses connected primary calendar'},
                'google.update':{'target':'Google event ID from approved query'},
                'reports.save':{'definition':'same shape as reports.query','shared_with':['assignment UUID'],'id':'only for an existing approved report','version':'existing report version when replacing'},
            }})
        attempt.state='completed';attempt.finished_at=timezone.now()
        for field in ('input_tokens','cached_input_tokens','output_tokens'):
            value=(usage or {}).get(field)
            if type(value) is int and value>=0:setattr(attempt,field,value)
        attempt.save()
        with transaction.atomic():
            row=AssistantRequest.objects.select_for_update().get(pk=pk)
            if row.version!=version or row.state not in {'intent_processing','preparing'}:return True
            require(actor_request(job))
            summary=data.get('summary','');clarification=data.get('clarification','')
            if not isinstance(summary,str) or not 1<=len(summary)<=4000 or not isinstance(clarification,str):raise ValidationError('Propuesta inválida.')
            row.summary=summary;row.clarification=clarification[:2000]
            if kind=='intent':
                modules=data.get('modules',[])
                if not isinstance(modules,list) or not set(modules)<=MODULES or not modules:raise ValidationError('Alcance inválido.')
                row.scope={'modules':modules,'queries':validate_queries(data.get('queries',[]),modules)}
                if any(s.get('capability')=='tasks.create' for s in data.get('steps',[])) and not any(q['capability']=='statuses.list' for q in row.scope['queries']):
                    row.scope['queries'].append({'capability':'statuses.list','arguments':{'unit':str(job.assignment.position.unit_id)}})
                    row.summary+=' Consultaré el catálogo de estados del departamento para preparar las tareas.'
                row.state='awaiting_scope'
            else:
                # The model cannot request further reads after the first approval.
                proposed_queries=validate_queries(data.get('queries',[]),job.scope['modules'])
                if proposed_queries and proposed_queries!=job.scope['queries']:
                    raise ValidationError('La preparación requiere otra consulta; reformula y revisa su alcance.')
                inspect_sources(job,SimpleNamespace(sources=sources))
                steps=validate_steps(data.get('steps',[]),job.scope['modules']) if not clarification else []
                steps=normalize(job,steps,values)
                sources=target_sources(job,steps,sources,values)
                Proposal.objects.create(request=row,version=version,summary=summary,steps=steps,sources=sources,
                    answer=str(data.get('answer',''))[:8000],digest=digest({'steps':steps,'sources':sources}))
                row.state='awaiting_scope' if clarification else 'awaiting_approval' if steps else 'completed'
                if row.state=='completed':row.finished_at=timezone.now()
            row.save();notify(row)
        return True
    except Exception as error:
        if attempt:
            InferenceAttempt.objects.filter(pk=attempt.pk,state='processing').update(state='failed',finished_at=timezone.now())
        job=load(pk)
        if job.version==version and job.state in {'intent_processing','preparing','intent_queued','prepare_queued'}:
            from .references import AmbiguousReference
            if isinstance(error,AmbiguousReference):
                with transaction.atomic():
                    row=AssistantRequest.objects.select_for_update().get(pk=pk)
                    if row.version==version and row.state=='preparing':
                        Proposal.objects.get_or_create(request=row,version=version,defaults={'summary':row.summary,'steps':[],
                            'sources':error.sources,'digest':digest(error.sources)})
                        row.state='awaiting_scope';row.clarification=str(error.detail)[:2000];row.save();notify(row)
                return False
            from boldApp.calendario.service import CalendarReconnect,CalendarUnavailable
            message='No pude preparar la solicitud. Puedes refinarla y reintentar expresamente; no repetiré la inferencia automáticamente.'
            if isinstance(error,CalendarReconnect):message='Conecta o vuelve a autorizar Google desde Perfil → Conectores. No se enviaron invitaciones.'
            elif isinstance(error,CalendarUnavailable):message='Google Calendar no está disponible. No se reintentará automáticamente.'
            fail(job,message)
        return False
    finally:gate.release(owner)


def run_steps(job,proposal,steps,results):
    for step in steps:
        job._attempted_step=step
        require(actor_request(job),'assistant.request.execute')
        if AssistantRequest.objects.get(pk=job.pk).cancel_requested:raise ValidationError('Se cancelaron los pasos pendientes.')
        verify_targets(job,[step],results)
        receipt=ActionReceipt.objects.get(proposal=proposal,step_id=step['id'])
        if receipt.state!='pending':raise ValidationError('Este paso ya fue iniciado; consulta su comprobante.')
        receipt.state='processing';receipt.started_at=timezone.now();receipt.save()
        result=write(job,step,results)
        results[step['id']]=result or {}
        # Results contain references only; never retain a second copy of task/calendar bodies.
        receipt.result={key:result[key] for key in ('id','task','project','task_id','calendar_id','version') if isinstance(result,dict) and key in result}
        receipt.state='completed';receipt.finished_at=timezone.now();receipt.save()
        query=result_query(step,result,results)
        if query:
            try:job._expected[digest(query)]=revision_digest(query,read(job,query))
            except (APIException,Http404):job._expected[digest(query)]=None
        if step['capability']=='tasks.create' and isinstance(result,dict) and result.get('id'):
            execution_query={'capability':'execution.get','arguments':{'id':str(result['id'])}}
            try:job._expected[digest(execution_query)]=revision_digest(execution_query,read(job,execution_query))
            except (APIException,Http404):job._expected[digest(execution_query)]=None
        if step['capability'].startswith('execution.'):
            task_query={'capability':'tasks.get','arguments':{'id':query['arguments']['id']}}
            try:job._expected[digest(task_query)]=revision_digest(task_query,read(job,task_query))
            except (APIException,Http404):job._expected[digest(task_query)]=None
        if step['capability']=='tasks.organize' and isinstance(result,dict) and result.get('task'):
            task_query={'capability':'tasks.get','arguments':{'id':str(result['task'])}}
            try:job._expected[digest(task_query)]=revision_digest(task_query,read(job,task_query))
            except (APIException,Http404):job._expected[digest(task_query)]=None
        from boldApp.administrativo.services import record_system_event
        record_system_event('assistant.action',actor_request(job),module_code='assistant',actor=job.account,
            target_type='assistant_request',target_id=job.pk,metadata={'step':step['id'],'capability':step['capability']})


def perform(pk):
    if not AssistantRequest.objects.filter(pk=pk,state='execute_queued').update(state='executing',updated_at=timezone.now()):return False
    job=load(pk);proposal=current(job);job._proposal=proposal;results={}
    job._expected={digest(source['query']):source.get('revision_digest',source['digest']) for source in proposal.sources} if proposal else {}
    try:
        require(actor_request(job),'assistant.request.execute')
        if not proposal or not proposal.approved_at or timezone.now()-proposal.approved_at>timedelta(minutes=15):
            raise ValidationError('La aprobación venció; prepara una propuesta nueva.')
        inspect_sources(job,proposal)
        for step in proposal.steps:
            ActionReceipt.objects.get_or_create(request=job,proposal=proposal,step_id=step['id'],defaults={'capability':step['capability']})
        pending=[]
        # Local dependency groups are atomic; external operations have durable independent receipts.
        for step in proposal.steps:
            if not step['capability'].startswith('google.'):
                pending.append(step);continue
            if pending:
                with transaction.atomic():
                    lock_targets(pending,results)
                    verify_targets(job,pending,results)
                    if not job.receipts.filter(state='completed').exists():inspect_sources(job,proposal)
                    run_steps(job,proposal,pending,results)
                pending=[]
            run_steps(job,proposal,[step],results)
        if pending:
            with transaction.atomic():
                lock_targets(pending,results)
                verify_targets(job,pending,results)
                if not job.receipts.filter(state='completed').exists():inspect_sources(job,proposal)
                run_steps(job,proposal,pending,results)
        AssistantRequest.objects.filter(pk=pk).update(state='completed',finished_at=timezone.now(),error='')
    except Exception as error:
        definitive=isinstance(error,(APIException,Http404)) and getattr(error,'status_code',400)<500
        detail=action_error(error)
        attempted=getattr(job,'_attempted_step',None)
        if attempted:
            job.receipts.filter(step_id=attempted['id'],state='pending').update(state='failed',error=detail,finished_at=timezone.now())
        processing=job.receipts.filter(state='processing')
        uncertain=processing.filter(capability__startswith='google.').exists() and not definitive
        processing.update(state='uncertain' if uncertain else 'failed',error=detail,finished_at=timezone.now())
        state='uncertain' if uncertain else 'partial' if job.receipts.filter(state='completed').exists() else 'failed'
        fail(job,'La ejecución se detuvo. '+detail,state)
        return False
    notify(job);return True


def target_query(step,results):
    cap=step['capability'];target=step['target']
    if target.startswith('$'):
        if target[1:] not in results:return None
        target=str(results[target[1:]]['id'])
    if not target:return None
    name={'tasks.update':'tasks.get','projects.update':'projects.get','execution.define':'execution.get',
          'execution.advance':'execution.get','tasks.organize':'tasks.link'}.get(cap)
    if name:return {'capability':name,'arguments':{'id':target}}
    if cap=='events.update':
        calendar,event=target.split(':')
        return {'capability':'events.get','arguments':{'calendar':calendar,'id':event}}
    return None


def result_query(step,result,results):
    if not isinstance(result,dict):return None
    name={'tasks.create':'tasks.get','projects.create':'projects.get','tasks.organize':'tasks.link'}.get(step['capability'])
    if name and result.get('id'):return {'capability':name,'arguments':{'id':str(result['id'])}}
    return target_query(step,results)


def verify_targets(job,steps,results):
    for step in steps:
        query=target_query(step,results)
        if not query:continue
        expected=job._expected.get(digest(query))
        if expected is None or revision_digest(query,read(job,query))!=expected:
            raise ValidationError('Un registro cambió después de la aprobación; revisa una propuesta nueva.')


def lock_targets(steps,results):
    from .capabilities import identity,link_id
    from boldApp.tareas.models import Task,Project,TaskProject
    from boldApp.calendario.models import AppCalendarEvent
    tasks=[];projects=[];events=[];links=[]
    for step in steps:
        target=step['target'];cap=step['capability']
        if target.startswith('$'):
            if target[1:] not in results:continue
            target=str(results[target[1:]]['id'])
        if not target:continue
        if cap in {'tasks.update','execution.define','execution.advance'}:tasks.append(identity(target))
        if cap=='projects.update':projects.append(identity(target))
        if cap=='events.update':events.append(identity(target.split(':')[1]))
        if cap=='tasks.organize':links.append(int(link_id(target)))
    for model,keys in ((Task,tasks),(Project,projects),(AppCalendarEvent,events),(TaskProject,links)):
        list(model.objects.filter(pk__in=keys).order_by('pk').select_for_update())


def drain():
    if not settings.BOLD_ASSISTANT_ENABLED:return 0
    stale=AssistantRequest.objects.filter(state__in=['intent_processing','preparing','executing'],updated_at__lt=timezone.now()-timedelta(minutes=4))
    for job in stale:
        state='uncertain' if job.state=='executing' else 'failed'
        job.receipts.filter(state='processing').update(state='uncertain',finished_at=timezone.now())
        fail(job,'Se interrumpió el proceso; no se repetirá automáticamente.',state)
    job=AssistantRequest.objects.filter(state__in=['intent_queued','prepare_queued','execute_queued']).order_by('created_at').first()
    return int((perform if job.state=='execute_queued' else infer)(job.pk)) if job else 0
