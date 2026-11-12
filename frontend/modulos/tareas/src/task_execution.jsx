import {useEffect,useRef,useState} from 'react';
import {Plus,Save,RefreshCw,Check,Play,Pause,RotateCcw,Trash2,ArrowUp,ArrowDown,History,GitBranch} from 'lucide-react';
import {useCore} from '../../core/core_provider.jsx';
import {is_using_real_backend} from '../../core/http_client.js';
import {BoldSelect} from '../../core/shared/bold_select.jsx';
import {CalendarDateField} from '../../core/shared/date_picker.jsx';
import {registerPrivateWork} from '../../core/shared/private_work.js';
import {executionApi} from './execution_api.js';
import {phaseDefinition,newPhase,copyPhaseTemplate,checkPhaseGraph,phaseLabels} from './execution_data.js';
import {createReportRefresh} from './report_refresh.js';
import './task_execution.css';
import ExecutionTemplates from './execution_templates.jsx';
import ExecutionTimelineEvent from './execution_timeline.jsx';
import {preservePreparation,recoverPreparation} from './work_preparations.js';

const stamp=value=>value?new Date(value).toLocaleString('es',{dateStyle:'short',timeStyle:'short'}):'Sin fecha';
function localParts(value){const date=value?new Date(value):null;return date?{day:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,time:`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}:{day:'',time:'17:00'};}

function PhaseEditor({rows,onChange,directory,units,assignment,disabled}){
    const [query,setQuery]=useState('');
    const change=(id,patch)=>onChange(rows.map(row=>row.id===id?{...row,...patch}:row));
    function move(index,direction){const next=[...rows];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next);}
    return <fieldset className="execution_editor" disabled={disabled}><legend>Configurar etapas</legend>
        <p>El orden facilita la lectura. Las dependencias determinan qué pasos se desbloquean, también en paralelo.</p>
        {rows.map((row,index)=>{const due=localParts(row.due_at),people=directory.filter(person=>String(person.unit)===row.unit);
            const date=(day,time=due.time)=>change(row.id,{due_at:day?new Date(`${day}T${time||'17:00'}`).toISOString():null});
            return <section key={row.id} className="execution_editor_step" aria-label={`Configurar etapa ${index+1}`}>
                <header><strong>Etapa {index+1}</strong><div><button type="button" aria-label={`Subir etapa ${index+1}`} disabled={!index||disabled} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button type="button" aria-label={`Bajar etapa ${index+1}`} disabled={index===rows.length-1||disabled} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button type="button" aria-label={`Retirar etapa ${index+1}`} onClick={()=>onChange(rows.filter(p=>p.id!==row.id).map(p=>({...p,prerequisites:p.prerequisites.filter(id=>id!==row.id)})))}><Trash2 size={16}/></button></div></header>
                <label>Nombre<input maxLength={120} value={row.name} onChange={event=>change(row.id,{name:event.target.value})}/></label>
                <label>Trabajo y contexto<textarea maxLength={5000} rows={2} value={row.description} onChange={event=>change(row.id,{description:event.target.value})}/></label>
                <label>Criterio para darla por terminada<input maxLength={1000} value={row.completion_criteria} onChange={event=>change(row.id,{completion_criteria:event.target.value})}/></label>
                <div className="execution_fields"><label>Departamento<BoldSelect label={`Departamento de etapa ${index+1}`} searchable value={row.unit} options={units.map(unit=>({value:String(unit.id),label:unit.name}))} onValueChange={unit=>{const person=directory.find(p=>String(p.unit)===unit);change(row.id,{unit,lead:person?.id||'',responsible:person?[person.id]:[]});}}/></label>
                <label>Responsable principal<BoldSelect label={`Responsable principal de etapa ${index+1}`} searchable value={row.lead} options={[{value:'',label:'Seleccionar persona'},...people.map(person=>({value:String(person.id),label:person.name}))]} onValueChange={lead=>change(row.id,{lead,responsible:[...new Set([lead,...row.responsible].filter(Boolean))]})}/></label></div>
                <details><summary>Personas responsables ({row.responsible.length})</summary><label>Buscar persona<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="execution_checklist">{directory.filter(p=>p.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).slice(0,60).map(person=><label key={person.id}><input type="checkbox" checked={row.responsible.includes(String(person.id))} disabled={String(person.id)===row.lead} onChange={event=>change(row.id,{responsible:event.target.checked?[...row.responsible,String(person.id)]:row.responsible.filter(id=>id!==String(person.id))})}/><span>{person.name}<small>{person.unit_name}</small></span></label>)}</div></details>
                <details><summary>Depende de {row.prerequisites.length} {row.prerequisites.length===1?'etapa':'etapas'}</summary><div className="execution_checklist">{rows.filter(p=>p.id!==row.id).map((before)=><label key={before.id}><input type="checkbox" checked={row.prerequisites.includes(before.id)} onChange={event=>change(row.id,{prerequisites:event.target.checked?[...row.prerequisites,before.id]:row.prerequisites.filter(id=>id!==before.id)})}/>{before.name||'Etapa sin nombre'}</label>)}{rows.length<2&&<p>No hay otras etapas.</p>}</div></details>
                <div className="execution_fields"><label>Fecha objetivo<CalendarDateField value={due.day} ariaLabel={`Fecha objetivo de etapa ${index+1}`} onChange={day=>date(day)}/></label><label>Hora local<input type="time" value={due.time} onChange={event=>date(due.day,event.target.value)}/></label><label>Estimación en minutos<input type="number" min="1" max="525600" value={row.estimated_minutes??''} onChange={event=>change(row.id,{estimated_minutes:event.target.value?Number(event.target.value):null})}/></label></div>
                <label className="execution_check"><input type="checkbox" checked={row.required} onChange={event=>change(row.id,{required:event.target.checked})}/>Obligatoria para finalizar la tarea</label>
            </section>;
        })}
        <button type="button" disabled={rows.length>=60||disabled} onClick={()=>onChange([...rows,newPhase(assignment,rows.at(-1)?.id)])}><Plus size={16}/>Añadir etapa</button>
    </fieldset>;
}

export default function TaskExecutionPanel({taskId,active=true}){
    const core=useCore(),scope=core.activeAssignment?.id;
    const [state,setState]=useState({scope:null,task:null,data:null,error:'',loading:true});
    const [catalog,setCatalog]=useState({people:[],units:[]}),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[reason,setReason]=useState({}),[history,setHistory]=useState(null),[templates,setTemplates]=useState([]),[conflict,setConflict]=useState(false);
    const generation=useRef(0),attempt=useRef(null),inFlight=useRef(false),deferredRefresh=useRef(false),draftVersion=useRef(null),current=useRef(null),wasActive=useRef(active),revision=core.authorizationRevision;
    const data=state.scope===scope&&state.task===taskId&&!core.securityUncertain?state.data:null;
    const preparationKey=`phase:${core.account?.id}:${scope}:${taskId}:${revision}`;
    useEffect(()=>{if(draft)preservePreparation(preparationKey,{draft,version:draftVersion.current});},[draft,preparationKey]);
    async function load(signal){const token=++generation.current;setState(s=>({...s,loading:true,error:''}));try{const value=await executionApi.get(taskId,{signal});if(!signal?.aborted&&token===generation.current){if(draftVersion.current!==null&&value.version!==draftVersion.current)setConflict(true);setState({scope,task:taskId,data:value,error:'',loading:false});}}catch(error){if(!signal?.aborted&&token===generation.current)setState({scope,task:taskId,data:null,error:error.message,loading:false});}}
    useEffect(()=>{const controller=new AbortController();attempt.current=null;draftVersion.current=null;setConflict(false);setDraft(null);setHistory(null);setReason({});setTemplates([]);setCatalog({people:[],units:[]});if(is_using_real_backend()&&!core.securityUncertain)load(controller.signal);return()=>{controller.abort();generation.current++;};},[scope,taskId,revision,core.securityUncertain]);
    current.current={load,busy};
    useEffect(()=>{
        const resuming=active&&!wasActive.current;wasActive.current=active;
        if(!active||!is_using_real_backend()||core.securityUncertain)return;
        const channel=createReportRefresh({refresh:()=>{if(inFlight.current){deferredRefresh.current=true;return;}return current.current.load();}});
        const changed=event=>{if(!event.detail?.recover&&String(event.detail?.taskId)!==String(taskId))return;channel.request();};
        const wake=()=>channel.wake();if(resuming)wake();
        window.addEventListener('bold:task-resource-event',changed);window.addEventListener('focus',wake);window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
        return()=>{channel.stop();window.removeEventListener('bold:task-resource-event',changed);window.removeEventListener('focus',wake);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
    },[active,scope,taskId,revision,core.securityUncertain]);
    useEffect(()=>{if(!draft)return;const stop=registerPrivateWork(async()=>false);const warn=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>{stop();window.removeEventListener('beforeunload',warn);};},[draft]);
    async function configure(){const token=generation.current;try{const [meta,available]=await Promise.all([executionApi.people(taskId),executionApi.templates()]);if(token!==generation.current)return;setCatalog(meta);setTemplates(available.results);const recovered=recoverPreparation(preparationKey);draftVersion.current=recovered?.version??data.version;setDraft(recovered?.draft||data.phases.map(phaseDefinition));setConflict(draftVersion.current!==data.version);}catch(error){if(token===generation.current)setState(s=>({...s,error:error.message}));}}
    async function mutate(payload,define=false){
        if(inFlight.current)return;inFlight.current=true;setBusy(true);setState(s=>({...s,error:''}));
        const token=generation.current,signature=JSON.stringify(payload);
        if(attempt.current?.signature!==signature)attempt.current={signature,payload:{...payload,version:define?draftVersion.current:data.version,operation_id:crypto.randomUUID()}};
        try{const value=await (define?executionApi.define:executionApi.act)(taskId,attempt.current.payload);if(token!==generation.current)return;attempt.current=null;setState({scope,task:taskId,data:value,error:'',loading:false});if(define){preservePreparation(preparationKey,null);setDraft(null);draftVersion.current=null;}setHistory(null);window.dispatchEvent(new CustomEvent('bold:execution-change',{detail:{taskId}}));}
        catch(error){if(token===generation.current){if(error.status===409)setConflict(true);setState(s=>({...s,error:error.status===409?'Otro cambio llegó antes. Conservamos tu preparación; recarga las etapas y revisa las diferencias antes de guardar.':error.message}));}}
        finally{inFlight.current=false;setBusy(false);if(deferredRefresh.current){deferredRefresh.current=false;window.dispatchEvent(new CustomEvent('bold:task-resource-event',{detail:{taskId}}));}}
    }
    async function save(){const error=checkPhaseGraph(draft);if(error){setState(s=>({...s,error}));return;}await mutate({phases:draft},true);}
    async function openHistory(cursor){const token=generation.current;try{const value=await executionApi.timeline(taskId,cursor);if(token===generation.current)setHistory(old=>({results:cursor?[...(old?.results||[]),...value.results]:value.results,next:value.next}));}catch(error){if(token===generation.current)setState(s=>({...s,error:error.message}));}}

    if(!is_using_real_backend())return <p className="execution_notice">Las etapas se gestionan al conectar con BOLD.</p>;
    if(core.securityUncertain)return <p role="status">Comprobando permisos para consultar las etapas…</p>;
    return <section className="task_execution" aria-label="Etapas de ejecución" aria-busy={state.loading||busy}>
        <header className="execution_header"><div><h3><GitBranch size={18}/>Etapas de ejecución</h3><p>{data?.required_count?`${data.completed_count} de ${data.required_count} etapas obligatorias resueltas`:'Coordina el trabajo y sus dependencias dentro de esta tarea.'}</p></div><div>{data?.can_manage&&!draft&&<button type="button" disabled={busy} onClick={configure}>{recoverPreparation(preparationKey)?'Continuar preparación':data.phases.length?'Configurar':'Añadir etapas'}</button>}<button type="button" aria-label="Actualizar etapas" disabled={busy} onClick={()=>load()}><RefreshCw size={16}/></button></div></header>
        {state.error&&<div role="alert" className="execution_error"><p>{state.error}</p><button type="button" disabled={busy} onClick={()=>load()}>Recargar etapas</button></div>}
        {state.loading&&!data&&<p role="status">Cargando etapas…</p>}
        {conflict&&data&&<aside className="execution_error"><strong>Revisión de cambios concurrentes</strong><p>Versión actual: {data.version}. Tu preparación se conserva por separado.</p><ul>{data.phases.map(phase=><li key={phase.id}>{phase.name} · {phaseLabels[phase.status]}</li>)}</ul>{draft&&<><button type="button" disabled={busy||data.version<=(draftVersion.current??data.version)} onClick={()=>{draftVersion.current=data.version;attempt.current=null;setConflict(false);}}>He revisado los cambios; conservar mi preparación</button><button type="button" disabled={busy} onClick={()=>{draftVersion.current=data.version;setDraft(data.phases.map(phaseDefinition));attempt.current=null;setConflict(false);}}>Usar la definición actual</button></>}{!draft&&<button type="button" disabled={busy} onClick={()=>{attempt.current=null;setConflict(false);}}>Continuar desde la versión actual</button>}</aside>}
        {draft?<><PhaseEditor rows={draft} onChange={setDraft} units={catalog.units} directory={catalog.people} assignment={{...core.activeAssignment,unit:core.activeAssignment?.unit||core.activeUnit?.id}} disabled={busy}/>
            <ExecutionTemplates items={templates} people={catalog.people} definition={draft} onUse={definition=>setDraft(copyPhaseTemplate(definition))} onReload={async()=>{const token=generation.current,value=await executionApi.templates();if(token===generation.current)setTemplates(value.results);}} onError={error=>setState(s=>({...s,error}))}/>
            <footer className="execution_edit_actions"><button type="button" disabled={busy} onClick={()=>{preservePreparation(preparationKey,null);setDraft(null);draftVersion.current=null;setConflict(false);attempt.current=null;}}>Cancelar preparación</button><button type="button" className="execution_primary" disabled={busy||conflict} onClick={save}><Save size={16}/>{busy?'Guardando…':'Guardar etapas'}</button></footer></>:data&&<>
            {!data.phases.length&&<div className="execution_empty"><h4>Una tarea sencilla, o un proceso completo</h4><p>Añade etapas cuando el trabajo pase por varias personas o departamentos. Cada paso conservará sus responsables, dependencias y tiempos.</p></div>}
            <ol className="execution_steps">{data.phases.map((phase,index)=><li key={phase.id} className={`execution_step is_${phase.status}`}><header><span className="execution_step_number">{index+1}</span><div><h4>{phase.name}</h4><p>{phase.unit_name} · {phase.people.map(p=>p.name).join(', ')}</p></div><span className="execution_status">{phaseLabels[phase.status]}{phase.review_required?' · Requiere revisión':''}</span></header>
                {phase.description&&<p>{phase.description}</p>}{phase.completion_criteria&&<p><strong>Para terminar:</strong> {phase.completion_criteria}</p>}
                {!!phase.prerequisites.length&&<p className="execution_dependencies">Depende de: {phase.prerequisites.map(id=>data.phases.find(p=>p.id===id)?.name||'Etapa anterior').join(' · ')}</p>}
                {phase.due_at&&<p>Objetivo: {stamp(phase.due_at)}</p>}{phase.block_reason&&<p className="execution_block"><Pause size={14}/>{phase.block_reason}</p>}
                {(phase.can_act||data.can_override)&&<div className="execution_phase_actions">{phase.can_act&&phase.status==='available'&&<button type="button" disabled={busy} onClick={()=>mutate({phase_id:phase.id,action:'start'})}><Play size={14}/>Comenzar</button>}{phase.can_act&&phase.status==='in_progress'&&<button type="button" className="execution_primary" disabled={busy} onClick={()=>mutate({phase_id:phase.id,action:'complete'})}><Check size={14}/>Completar etapa</button>}{phase.can_act&&phase.status==='blocked'&&<button type="button" disabled={busy} onClick={()=>mutate({phase_id:phase.id,action:'resume'})}><Play size={14}/>Reanudar</button>}
                <details><summary>Más acciones</summary><label>Motivo<input maxLength={1000} value={reason[phase.id]||''} onChange={event=>setReason(old=>({...old,[phase.id]:event.target.value}))}/></label><div>{phase.can_act&&['available','in_progress'].includes(phase.status)&&<button type="button" disabled={busy||!reason[phase.id]?.trim()} onClick={()=>mutate({phase_id:phase.id,action:'block',reason:reason[phase.id]})}>Registrar bloqueo</button>}{phase.can_act&&['completed','skipped'].includes(phase.status)&&<button type="button" disabled={busy||!reason[phase.id]?.trim()} onClick={()=>mutate({phase_id:phase.id,action:phase.review_required?'review':'reopen',reason:reason[phase.id]})}><RotateCcw size={14}/>{phase.review_required?'Confirmar revisión':'Reabrir etapa'}</button>}{data.can_override&&<><button type="button" disabled={busy||!reason[phase.id]?.trim()} onClick={()=>mutate({phase_id:phase.id,action:'skip',reason:reason[phase.id]})}>Omitir con excepción</button><button type="button" disabled={busy||!reason[phase.id]?.trim()} onClick={()=>mutate({phase_id:phase.id,action:'archive',reason:reason[phase.id]})}>Retirar con excepción</button></>}</div></details></div>}
            </li>)}</ol>
        </>}
        {data&&<section className="execution_history"><button type="button" onClick={()=>history?setHistory(null):openHistory()}><History size={16}/>{history?'Ocultar historial':'Ver historial de cambios'}</button>{history&&<><ol>{history.results.map(row=><ExecutionTimelineEvent key={row.id} event={row}/>)}</ol>{history.next&&<button type="button" onClick={()=>openHistory(history.next)}>Cargar cambios anteriores</button>}</>}</section>}
    </section>;
}
