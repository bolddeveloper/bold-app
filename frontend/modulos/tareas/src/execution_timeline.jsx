import {phaseLabels} from './execution_data.js';
const actions={'phase.definition':'Configuración de etapa','phase.transition':'Cambio de estado','phase.reopened':'Etapa reabierta','phase.reviewed':'Revisión confirmada','phase.exception':'Excepción autorizada','phase.archived':'Etapa retirada','task.created':'Tarea creada','task.completed':'Tarea finalizada','task.reopened':'Tarea reabierta','task.changed':'Tarea actualizada'};
const displayDate=value=>value?new Date(value.length===10?`${value}T12:00:00`:value).toLocaleString('es',value.length===10?{dateStyle:'short'}:{dateStyle:'short',timeStyle:'short'}):'Sin fecha';
export default function ExecutionTimelineEvent({event}){
    const before=event.before||{},after=event.after||{},changes=[];
    const oldDefinition=before.definition||before,newDefinition=after.definition||after;
    for(const [key,label] of [['name','Nombre'],['description','Contexto'],['completion_criteria','Criterio de finalización']])if(oldDefinition[key]!==undefined&&newDefinition[key]!==undefined&&oldDefinition[key]!==newDefinition[key])changes.push(`${label}: «${oldDefinition[key]||'Vacío'}» → «${newDefinition[key]||'Vacío'}»`);
    for(const key of ['due_at','due_date'])if(key in oldDefinition&&key in newDefinition&&oldDefinition[key]!==newDefinition[key])changes.push(`Fecha objetivo: ${displayDate(oldDefinition[key])} → ${displayDate(newDefinition[key])}`);
    if(before.assignee_id!==after.assignee_id&&'assignee_id' in before&&'assignee_id' in after)changes.push(`Responsable: ${before.assignee?.name||'Sin responsable registrado'} → ${after.assignee?.name||'Sin responsable'}`);
    if(before.people&&event.responsible&&JSON.stringify(before.people.map(p=>p.assignment_id).sort())!==JSON.stringify(event.responsible.map(p=>p.assignment_id).sort()))changes.push(`Personas responsables: ${before.people.map(p=>p.name).join(', ')} → ${event.responsible.map(p=>p.name).join(', ')}`);
    if(before.status&&after.status&&before.status!==after.status)changes.push(`${phaseLabels[before.status]||before.status} → ${phaseLabels[after.status]||after.status}`);
    return <li><strong>{after.name||before.name||'Tarea'} · {actions[event.kind]||'Cambio registrado'}</strong><span>{displayDate(event.occurred_at)} · {event.actor?.name||'Sistema'}</span>{changes.length>0&&<ul className="execution_history_changes">{changes.map((change,index)=><li key={index}>{change}</li>)}</ul>}{event.reason&&<p>{event.reason}</p>}</li>;
}
