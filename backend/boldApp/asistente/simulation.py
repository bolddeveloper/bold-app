from copy import copy,deepcopy
from datetime import datetime
from rest_framework.exceptions import ValidationError
from . import service


def simulate(job,request):
    proposal=service.current(job)
    if not proposal:raise ValidationError('Prepara una propuesta antes de simular.')
    authority=copy(job);authority.session=request.auth
    sources=service.inspect_sources(authority,proposal)
    rows={}
    statuses={};projects={};phases={};people={};partial=False;agenda_before=[];calendar_queried=False
    for source,value in zip(proposal.sources,sources):
        cap=source['query']['capability']
        if isinstance(value,dict) and value.get('partial'):partial=True
        if cap=='statuses.list':
            for row in value.get('results',value) if isinstance(value,dict) else value:
                statuses[str(row['id'])]=row.get('is_final',False)
        if cap=='people.search':people.update({r['id']:r['name'] for r in value['results']})
        if cap in {'projects.get','projects.search'}:
            values=value.get('results',[]) if cap=='projects.search' else [value]
            for row in values:projects.setdefault(row['id'],{'tasks':set()})['name']=row.get('name','Proyecto')
        if cap=='execution.get':phases[value['task_id']]=deepcopy(value['phases'])
        if cap in {'events.list','google.events'}:
            calendar_queried=True;agenda_before.extend(deepcopy(value.get('events',[])))
        if cap in {'tasks.search','tasks.get'}:
            values=value.get('results',[]) if cap=='tasks.search' else [value]
            for row in values:
                item=dict(row)
                item['status']=item.get('status',item.get('status_id'))
                item['status_is_final']=item.get('status_is_final',item.get('status__is_final'))
                item['assignee_assignment']=item.get('assignee_assignment',item.get('assignee_assignment_id'))
                rows[str(item['id'])]=item
                project=source['query']['arguments'].get('project')
                if project:projects.setdefault(project,{'name':'Proyecto consultado','tasks':set()})['tasks'].add(str(item['id']))
    before=deepcopy(rows);rows=deepcopy(rows);projects_before=deepcopy(projects);phases_before=deepcopy(phases)
    agenda=[];issues=[]
    for step in proposal.steps:
        cap=step['capability'];args=step['arguments'];key=step['target']
        if cap=='tasks.create':
            rows['$'+step['id']]={**args,'id':'$'+step['id']}
            if args.get('project'):projects.setdefault(args['project'],{'name':'Proyecto seleccionado','tasks':set()})['tasks'].add('$'+step['id'])
        elif cap=='tasks.update' and key in rows:
            if statuses.get(str(args.get('status'))) and key in phases and any(p['required'] and (p['status'] not in {'completed','skipped'} or p.get('review_required')) for p in phases[key]):
                issues.append({'step_id':step['id'],'message':'Las etapas obligatorias impiden finalizar la tarea.'});continue
            rows[key].update(args)
            if 'status' in args:rows[key]['status_is_final']=statuses.get(str(args['status']))
        elif cap=='projects.create':projects['$'+step['id']]={'name':args.get('name','Proyecto nuevo'),'tasks':set()}
        elif cap=='projects.update' and key in projects:projects[key]['name']=args.get('name',projects[key]['name'])
        elif cap=='tasks.organize':
            link=next((v for s,v in zip(proposal.sources,sources) if s['query']['capability']=='tasks.link' and str(s['query']['arguments'].get('id'))==key),{})
            project=args.get('project',link.get('project'));task=args.get('task',link.get('task'))
            if project and task:projects.setdefault(project,{'name':'Proyecto seleccionado','tasks':set()})['tasks'].add(task)
        elif cap=='execution.define':
            phases[key]=[{**p,'status':'pending' if p.get('prerequisites') else 'available','review_required':False} for p in args['phases']]
        elif cap=='execution.advance':
            collection=phases.get(key,[]);phase=next((p for p in collection if p['id']==args['phase_id']),None)
            if not phase:
                issues.append({'step_id':step['id'],'message':'Falta consultar esta etapa.'});continue
            action=args['action'];status=phase['status'];ready=all(p['status'] in {'completed','skipped'} and not p.get('review_required') for p in collection if p['id'] in phase['prerequisites'])
            permitted={'start':{'available'},'complete':{'in_progress'},'block':{'available','in_progress'},'resume':{'blocked'},'reopen':{'completed','skipped'},'review':{'completed','skipped'}}
            if status not in permitted[action] or not ready or action in {'block','reopen','review'} and not args.get('reason'):
                issues.append({'step_id':step['id'],'message':'La transición no cumple sus condiciones.'});continue
            phase['status']={'start':'in_progress','complete':'completed','block':'blocked','resume':'available','reopen':'available','review':status}[action]
            if action=='review':phase['review_required']=False
            if action=='reopen':
                affected={phase['id']}
                for _ in collection:
                    for p in collection:
                        if set(p['prerequisites'])&affected:
                            affected.add(p['id'])
                            if p['status'] in {'completed','skipped'}:p['review_required']=True
                            else:p['status']='pending'
                if key in rows:rows[key]['status_is_final']=False
            for p in collection:
                if p['status']=='pending' and all(before['status'] in {'completed','skipped'} and not before.get('review_required') for before in collection if before['id'] in p['prerequisites']):p['status']='available'
        elif cap.startswith(('events.','google.')):
            identity=key.split(':')[-1]
            existing=next((row for row in agenda_before if row.get('id')==identity),None)
            if existing is None:
                existing=next((value for source,value in zip(proposal.sources,sources) if source['query']['capability'] in {'events.get','google.event'} and source['query']['arguments'].get('id')==identity),None)
            agenda.append({'capability':cap,'target':key,'before':existing,'after':{**(existing or {}),**args},'changes':args,'simulated':True})
    def metrics(items):
        values=list(items.values());known=[row.get('status_is_final',statuses.get(str(row.get('status')))) for row in values]
        done=sum(v is True for v in known);unknown=sum(v is None for v in known)
        workload={}
        for row in values:
            actor=people.get(str(row.get('assignee_assignment')),'Responsable seleccionado' if row.get('assignee_assignment') else 'Sin asignar')
            workload[actor]=workload.get(actor,0)+1
        return {'tasks':len(values),'completed':done,'unknown_status':unknown,'progress_percent':100*done/len(values) if values and not unknown and not partial else None,'assigned_workload':workload}
    def project_metrics(values,tasks):
        result=[]
        for key,project in values.items():
            selected=[tasks[t] for t in project['tasks'] if t in tasks];known=[t.get('status_is_final',statuses.get(str(t.get('status')))) for t in selected]
            result.append({'id':key,'name':project['name'],'known_tasks':len(selected),'progress_percent':100*sum(v is True for v in known)/len(selected) if selected and not any(v is None for v in known) and not partial else None})
        return result
    def phase_metrics(values):
        items=[p for collection in values.values() for p in collection if p.get('required',True)]
        return {'required':len(items),'resolved':sum(p['status'] in {'completed','skipped'} and not p.get('review_required') for p in items)}
    return {'simulated':True,'before':metrics(before),'after':metrics(rows),'agenda':agenda,
        'projects_before':project_metrics(projects_before,before),'projects_after':project_metrics(projects,rows),
        'phases_before':phase_metrics(phases_before),'phases_after':phase_metrics(phases),'issues':issues,
        'calendar_baseline_known':calendar_queried,'meetings_consulted':len(agenda_before) if calendar_queried else None,
        'reports_to_save':sum(s['capability']=='reports.save' for s in proposal.steps),
        'coverage':('Muestra parcial. ' if partial else '')+'Solo el conjunto consultado; no representa todas las tareas o proyectos de la organización.',
        'note':'Sin escrituras de negocio ni invitaciones. No proyecta tiempos, productividad ni métricas históricas futuras.'}
