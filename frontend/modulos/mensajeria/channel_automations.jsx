import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {Pause,Play,Plus,RefreshCw,Save} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {confirmBold} from '../core/shared/bold_dialog.js';
import {automationApi} from './automation_api.js';
import {templateApi} from './page_template_api.js';
import {automationKinds,automationReasons,automationInput,emptyAutomationForm,localSchedule,automationStamp,automationError,automationDefinitive,captureAutomationReview,restoreAutomationReview} from './automation_model.js';
import {useComposerDrafts} from './use_composer_drafts.js';
import {draftService} from './draft_service.js';
import './channel_automations.css';

const reason=value=>automationReasons[value] || (value ? 'Requiere revisión':'Sin incidencias');
const runState={pending:'Pendiente',published:'Publicado',skipped:'Omitido',failed:'Fallido'};
const auditAction={created:'Creada en pausa',updated:'Configuración revisada',activated:'Activada',paused:'Pausada'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const previewBlock=row=>row.type==='task' ? row.task?.available ? `${row.task.title} · ${row.task.status}`:'Tarea no disponible':row.type==='page' ? row.page?.available ? row.page.title:'Página no disponible':row.text || '';

export default function ChannelAutomations({channel,onDirty,onDenied}){
    const core=useCore();const [revoked,setRevoked]=useState(false);
    const allowed=!revoked && channel.can_read_automations===true && !core.securityUncertain && core.activeAssignment?.chat_enabled===true;
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[selected,setSelected]=useState(null),[editing,setEditing]=useState(false);
    const [form,setForm]=useState(emptyAutomationForm),[baseline,setBaseline]=useState(emptyAutomationForm),[attempt,setAttempt]=useState(null);
    const [baseVersion,setBaseVersion]=useState(null);
    const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[errors,setErrors]=useState({}),[notice,setNotice]=useState(''),[changed,setChanged]=useState(false);
    const [projectQuery,setProjectQuery]=useState(''),[projects,setProjects]=useState([]),[projectNext,setProjectNext]=useState(null),[project,setProject]=useState(null);
    const [templates,setTemplates]=useState([]),[templateNext,setTemplateNext]=useState(null),[template,setTemplate]=useState(null),[sourceBusy,setSourceBusy]=useState(false);
    const [history,setHistory]=useState(null),[historyKind,setHistoryKind]=useState('runs');
    const alive=useRef(false),controllers=useRef(new Map()),acting=useRef(false),live=useRef({}),errorSummary=useRef(null),heading=useRef(null);
    const callbacks=useRef({});callbacks.current={onDirty,onDenied};
    const sourcePending=useRef(new Set());
    const dirty=!!attempt || editing && !same(form,baseline);
    live.current={dirty,selected,editing,attempt,form,baseline,baseVersion};
    const recovery=useComposerDrafts({context:`${core.account?.id || ''}:${core.activeAssignment?.id || ''}:${core.authorizationRevision || 0}`,
        resource:allowed ? {kind:'channel-automations',resource_id:channel.id}:null,
        read:()=>captureAutomationReview(live.current,channel.id),
        restore:(_,payload)=>{
            if(acting.current)return false;
            const value=restoreAutomationReview(payload,channel.id);
            setForm(value.form);setBaseline(value.baseline);setBaseVersion(value.base_rule?.version || null);setEditing(value.editing);setAttempt(value.attempt);
            setErrors({});setError('');setHistory(null);
            if(value.base_rule){
                setSelected({id:value.base_rule.id,version:value.base_rule.version,name:'Revisión conservada',kind:value.form.kind,source_available:false,can_manage:false});
                const c=begin('detail');setLoading(true);
                automationApi.get(channel.id,value.base_rule.id,{signal:c.signal}).then(row=>{if(alive.current && !c.signal.aborted)setSelected(row);})
                    .catch(err=>{if(alive.current && !c.signal.aborted)report(err,{sensitive:true});}).finally(()=>{if(alive.current && !c.signal.aborted)setLoading(false);});
            }else setSelected(null);
            setNotice('Revisión recuperada, sin enviar. Conserva la versión y el intento originales; comprueba el estado antes de continuar.');return true;
        },onDenied:withdraw});
    function begin(key){controllers.current.get(key)?.abort();const c=new AbortController();controllers.current.set(key,c);return c;}
    function sourceStart(key){const c=begin(key);sourcePending.current.add(key);setSourceBusy(true);return c;}
    function sourceEnd(key,c){if(controllers.current.get(key)!==c)return;sourcePending.current.delete(key);if(alive.current)setSourceBusy(sourcePending.current.size>0);}
    function cancelSource(key){const c=controllers.current.get(key);if(c){c.abort();sourceEnd(key,c);}}
    function withdraw(err){
        controllers.current.forEach(c=>c.abort());draftService.purge();setRevoked(true);setRows([]);setSelected(null);setForm(emptyAutomationForm());setBaseline(emptyAutomationForm());setBaseVersion(null);setEditing(false);setAttempt(null);setHistory(null);setProject(null);setTemplate(null);setTemplates([]);setProjects([]);
        if(err)callbacks.current.onDenied?.(err);
    }
    function field(key,value){if(acting.current || attempt)return;setForm(current=>({...current,[key]:value,...(key!=='share_confirmed' ? {share_confirmed:false}:{})}));setErrors(current=>({...current,[key]:undefined}));}
    function report(err,{sensitive=false}={}){
        if(err.name==='AbortError')return;
        setError(automationError(err));
        if(sensitive && [401,403,404].includes(err.status)){
            withdraw(err);
        }
    }
    async function load(cursor=null){
        const c=begin('list');setLoading(true);setError('');
        try{const result=await automationApi.list(channel.id,cursor,{signal:c.signal});if(alive.current && !c.signal.aborted){setRows(current=>cursor ? [...new Map([...current,...result.results].map(row=>[row.id,row])).values()]:result.results);setNext(result.next);}}
        catch(err){if(alive.current && !c.signal.aborted)report(err,{sensitive:true});}
        finally{if(alive.current && !c.signal.aborted)setLoading(false);}
    }
    useEffect(()=>{
        alive.current=true;if(allowed)load();
        const revoke=()=>withdraw();
        const hint=event=>{if(event.type==='bold:messaging-reconnect' || event.detail?.payload?.kind==='automation.changed' && event.detail.payload.channel_id===channel.id){if(!acting.current)setChanged(true);}};
        window.addEventListener('bold:permissions-invalidated',revoke);
        window.addEventListener('bold:private-cache-clear',revoke);window.addEventListener('bold:slack-event',hint);window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{alive.current=false;controllers.current.forEach(c=>c.abort());callbacks.current.onDirty?.(false);
            window.removeEventListener('bold:permissions-invalidated',revoke);window.removeEventListener('bold:private-cache-clear',revoke);window.removeEventListener('bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[allowed,channel.id]);
    useEffect(()=>{callbacks.current.onDirty?.(dirty);},[dirty]);
    useEffect(()=>{if(Object.values(errors).some(Boolean) || error)errorSummary.current?.focus({preventScroll:true});},[errors,error]);
    useEffect(()=>{
        setProject(null);if(!allowed || form.kind!=='task_status' || !form.project_id)return;
        const c=sourceStart('project');
        automationApi.project(channel.id,form.project_id,{signal:c.signal}).then(result=>{if(alive.current && !c.signal.aborted)setProject(result);})
            .catch(err=>{if(alive.current && !c.signal.aborted){setProjects([]);setErrors(current=>({...current,project_id:'Este proyecto ya no está disponible. Selecciona un origen autorizado.'}));if(err.status===401)report(err,{sensitive:true});}})
            .finally(()=>sourceEnd('project',c));
        return()=>{c.abort();sourceEnd('project',c);};
    },[allowed,channel.id,form.kind,form.project_id]);
    useEffect(()=>{
        setTemplate(null);if(!allowed || form.kind!=='recurring_page' || !form.template_id)return;
        const c=sourceStart('template');
        templateApi.get(channel.id,form.template_id,{signal:c.signal}).then(result=>{if(alive.current && !c.signal.aborted)setTemplate(result);})
            .catch(err=>{if(alive.current && !c.signal.aborted){setTemplates([]);setErrors(current=>({...current,template_id:'La plantilla ya no está disponible. Revisa sus permisos y elige una versión accesible.'}));if(err.status===401)report(err,{sensitive:true});}})
            .finally(()=>sourceEnd('template',c));
        return()=>{c.abort();sourceEnd('template',c);};
    },[allowed,channel.id,form.kind,form.template_id]);
    async function mayReplace(){
        if(acting.current || recovery.blocked)return false;
        if(live.current.attempt){setError('Resuelve el intento sin confirmar con Reintentar antes de cambiar de regla.');return false;}
        return !live.current.dirty || await confirmBold('¿Descartar esta revisión local? No elimina ni pausa ninguna regla ya guardada en el servidor.');
    }
    async function choose(row){
        if(!await mayReplace() || !alive.current)return;
        const c=begin('detail');setLoading(true);setError('');setErrors({});setHistory(null);setChanged(false);
        try{const result=await automationApi.get(channel.id,row.id,{signal:c.signal});if(alive.current && !c.signal.aborted){setSelected(result);setBaseVersion(result.version);const value=emptyAutomationForm(result);setForm(value);setBaseline(value);setEditing(false);setNotice('');requestAnimationFrame(()=>heading.current?.focus());}}
        catch(err){if(alive.current && !c.signal.aborted)report(err,{sensitive:true});}
        finally{if(alive.current && !c.signal.aborted)setLoading(false);}
    }
    async function newRule(){if(!await mayReplace() || !alive.current)return;controllers.current.get('detail')?.abort();setSelected(null);setBaseVersion(null);setEditing(true);const value=emptyAutomationForm();setForm(value);setBaseline(value);setHistory(null);setError('');setErrors({});setNotice('');setProjects([]);setTemplates([]);requestAnimationFrame(()=>heading.current?.focus());}
    async function searchProjects(cursor=null){
        if(acting.current || attempt)return;const c=sourceStart('project-search');setError('');
        try{const result=await automationApi.projects(channel.id,projectQuery,cursor,{signal:c.signal});if(alive.current && !c.signal.aborted){setProjects(current=>cursor ? [...current,...result.results]:result.results);setProjectNext(result.next);}}
        catch(err){if(alive.current && !c.signal.aborted)report(err);}
        finally{sourceEnd('project-search',c);}
    }
    async function loadTemplates(cursor=null){
        if(acting.current || attempt)return;const c=sourceStart('templates');setError('');
        try{const result=await templateApi.list(channel.id,false,cursor,{signal:c.signal});if(alive.current && !c.signal.aborted){setTemplates(current=>cursor ? [...current,...result.results]:result.results);setTemplateNext(result.next);}}
        catch(err){if(alive.current && !c.signal.aborted)report(err);}
        finally{sourceEnd('templates',c);}
    }
    async function perform(operation){
        if(acting.current || recovery.blocked || loading || channel.can_manage_automations!==true || selected && selected.can_manage!==true)return;
        acting.current=true;flushSync(()=>{setBusy(true);setAttempt(operation);setError('');setErrors({});setNotice('');});
        const c=begin('write');
        try{
            if(!await recovery.flush())throw Error('No se pudo proteger la revisión antes de enviar. Reintenta la protección sin cambiar el intento.');
            if(c.signal.aborted || !alive.current)return;
            const result=operation.action==='create' ? await automationApi.create(channel.id,operation.values,{signal:c.signal}):operation.action==='replace' ? await automationApi.replace(channel.id,operation.rule,operation.values,{signal:c.signal}):await automationApi.action(channel.id,operation.rule,operation.values,{signal:c.signal});
            if(alive.current && !c.signal.aborted){
                setAttempt(null);setSelected(result);setBaseVersion(result.version);setEditing(false);const value=emptyAutomationForm(result);setForm(value);setBaseline(value);setHistory(null);setChanged(false);
                setRows(current=>[result,...current.filter(row=>row.id!==result.id)]);
                setNotice(`Operación confirmada. Estado actual: ${result.active ? 'activa':'pausada'}${result.pause_reason ? ' · '+reason(result.pause_reason):''}.`);
            }
        }catch(err){if(alive.current && !c.signal.aborted){if(automationDefinitive(err))setAttempt(null);report(err,{sensitive:[401,403,404].includes(err.status)});
            if(err.status===400 && err.fields){const issues={};for(const [key,value] of Object.entries(err.fields))if(Object.hasOwn(form,key))issues[key]=[value].flat().join(' ');setErrors(issues);}}}
        finally{if(controllers.current.get('write')===c){acting.current=false;if(alive.current)setBusy(false);}}
    }
    function save(event){
        event.preventDefault();if(acting.current)return;if(attempt){perform(attempt);return;}
        const clientId=crypto.randomUUID(),result=automationInput(form,clientId);
        if(form.kind==='task_status'){
            if(!project || project.id!==form.project_id)result.errors.project_id='Revisa un proyecto accesible antes de guardar.';
            else for(const key of ['to_status_id','from_status_id'])if(form[key] && !project.statuses.some(row=>row.id===form[key]))result.errors[key]='Selecciona un estado vigente de este proyecto.';
        }
        if(form.kind==='recurring_page' && (!template || template.id!==form.template_id || template.version!==+form.template_version || template.archived_at))result.errors.template_id='Revisa y acepta una versión vigente de la plantilla.';
        if(Object.keys(result.errors).length){setError('Revisa los campos indicados; no se envió ninguna operación.');setErrors(result.errors);return;}
        perform(Object.freeze({action:selected ? 'replace':'create',rule:selected?.id || null,values:Object.freeze({...result.values,...(selected ? {version:baseVersion}:{})})}));
    }
    async function toggle(active){
        if(acting.current || attempt || !selected || editing)return;
        const original=selected;
        const approved=await confirmBold(active ? `¿Activar «${selected.name}» en # ${channel.name}?\n${automationKinds[selected.kind]}.\n${selected.kind==='reminder' ? selected.body+'\n':''}${selected.next_at ? 'Primera ejecución: '+automationStamp(selected.next_at)+'.\n':''}${selected.interval_days ? 'Repetición cada '+selected.interval_days+' días de 24 horas UTC.\n':''}Solo se publicará con tus permisos actuales. Un retraso no reproduce todos los intervalos vencidos.`:'¿Pausar esta regla? Se omitirán sus intentos pendientes y se conservarán los mensajes, páginas e historial ya publicados.');
        if(!approved || !alive.current || live.current.selected?.id!==original.id || live.current.selected.version!==original.version || acting.current)return;
        perform(Object.freeze({action:'toggle',rule:original.id,values:Object.freeze({client_id:crypto.randomUUID(),version:original.version,active,share_confirmed:active})}));
    }
    async function showHistory(kind,cursor=null){
        if(!selected || acting.current || attempt || dirty)return;
        const id=selected.id,c=begin('history');setLoading(true);setError('');setHistoryKind(kind);if(!cursor)setHistory(null);
        try{const result=await automationApi[kind](channel.id,id,cursor,{signal:c.signal});if(alive.current && !c.signal.aborted && live.current.selected?.id===id)setHistory(current=>({results:cursor && current?.kind===kind ? [...current.results,...result.results]:result.results,next:result.next,kind}));}
        catch(err){if(alive.current && !c.signal.aborted)report(err,{sensitive:true});}
        finally{if(alive.current && !c.signal.aborted)setLoading(false);}
    }
    if(!allowed)return <p role="status">Las automatizaciones no están disponibles con los permisos actuales.</p>;
    const locked=busy || !!attempt || recovery.blocked,canManage=channel.can_manage_automations===true && (!selected || selected.can_manage===true),zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const invalid=key=>({'aria-invalid':!!errors[key],'aria-describedby':errors[key] ? `auto-error-${key}`:undefined});
    const fieldError=key=>errors[key] && <small id={`auto-error-${key}`} className="slack_error">{errors[key]}</small>;
    return <section className="slack_automations" aria-label="Tus automatizaciones del canal">
        <header><div><h3>Automatizaciones</h3><p>Solo tus reglas de esta asignación. No amplían el acceso de nadie al canal ni a las tareas.</p></div><div><button type="button" disabled={busy || !!attempt || dirty} onClick={()=>{load();if(selected)choose(selected);setChanged(false);}}><RefreshCw size={17} aria-hidden="true"/>Actualizar</button>{canManage && <button type="button" disabled={locked || !!channel.archived_at} onClick={newRule}><Plus size={17} aria-hidden="true"/>Nueva regla</button>}</div></header>
        {changed && <p role="status" className="slack_notice">Hay cambios recientes. Actualiza el estado o el registro cuando termines tu revisión; no reemplazaremos el formulario.</p>}
        {(error || Object.values(errors).some(Boolean)) && <div className="slack_page_problem" role="alert" tabIndex={-1} ref={errorSummary}><strong>Revisa esta operación</strong><p>{error}</p>{Object.values(errors).some(Boolean) && <ul>{Object.entries(errors).filter(([,value])=>value).map(([key,value])=><li key={key}><a href={`#auto-${key}`}>{value}</a></li>)}</ul>}</div>}
        {notice && <p className="slack_notice" role="status">{notice}</p>}
        {recovery.recovery && <section className="slack_page_problem" aria-label="Revisión de automatización conservada"><strong>Hay una revisión cifrada conservada en este dispositivo.</strong><p>Recuperar no guarda ni activa reglas. Descartar esta copia tampoco elimina ni pausa una regla que el servidor haya recibido; comprueba tus reglas guardadas antes de crear otra.</p><button type="button" disabled={busy} onClick={recovery.recover}>Recuperar revisión de automatización</button><button type="button" disabled={busy} onClick={recovery.discard}>Descartar copia local de revisión</button></section>}
        {recovery.status==='opening' && <p role="status">Comprobando una revisión recuperable…</p>}{recovery.error && <p role="alert" className="slack_page_problem">No se pudo proteger o recuperar esta revisión. Conserva el formulario abierto. <button type="button" disabled={busy} onClick={recovery.retry}>Reintentar protección de revisión</button></p>}
        {attempt && <section className="slack_page_problem" aria-label="Operación sin confirmar"><strong>Operación sin confirmar</strong><p>No cambies los parámetros ni crees otro intento. Reintentar comprueba la misma operación, aunque la respuesta anterior se haya perdido.</p><button type="button" disabled={busy || recovery.blocked || loading || !canManage} onClick={()=>perform(attempt)}>{busy ? 'Comprobando…':'Reintentar el mismo intento'}</button></section>}
        <div className="slack_automation_columns"><aside aria-label="Reglas propias"><ul>{rows.map(row=><li key={row.id}><button type="button" disabled={locked} aria-pressed={selected?.id===row.id} onClick={()=>choose(row)}><strong>{row.name}</strong><span>{row.active ? 'Activa':'Pausada'} · {automationKinds[row.kind]}</span></button></li>)}</ul>{!loading && !rows.length && <p>Aún no tienes reglas en este canal.</p>}{next && <button type="button" disabled={loading || locked} onClick={()=>load(next)}>Más reglas</button>}</aside>
        <div className="slack_automation_detail"><h4 tabIndex={-1} ref={heading}>{editing ? selected ? 'Revisar configuración':'Nueva regla en pausa':selected ? selected.name:'Selecciona una regla'}</h4>
            {editing ? <form onSubmit={save} noValidate><fieldset disabled={locked || !canManage}><label htmlFor="auto-name">Nombre de la regla</label><input id="auto-name" value={form.name} maxLength={120} onChange={event=>field('name',event.target.value)} {...invalid('name')}/>{fieldError('name')}
                <label htmlFor="auto-kind">Acción</label><select id="auto-kind" value={form.kind} onChange={event=>{field('kind',event.target.value);setErrors({});}} {...invalid('kind')}>{Object.entries(automationKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{fieldError('kind')}
                {form.kind==='task_status' ? <>
                    <label htmlFor="auto-project-search">Buscar proyecto accesible</label><div className="slack_automation_actions"><input id="auto-project-search" value={projectQuery} maxLength={120} onChange={event=>{cancelSource('project-search');setProjectQuery(event.target.value);setProjects([]);setProjectNext(null);}}/><button type="button" disabled={sourceBusy || projectQuery.trim().length<2} onClick={()=>searchProjects()}>Buscar proyecto</button></div>
                    <label htmlFor="auto-project_id">Proyecto</label><select id="auto-project_id" value={form.project_id} onChange={event=>{field('project_id',event.target.value);field('to_status_id','');field('from_status_id','');}} {...invalid('project_id')}><option value="">Selecciona un proyecto</option>{project && !projects.some(row=>row.id===project.id) && <option value={project.id}>{project.name} · {project.unit_name}</option>}{projects.map(row=><option key={row.id} value={row.id}>{row.name} · {row.unit_name}</option>)}</select>{fieldError('project_id')}{projectNext && <button type="button" disabled={sourceBusy} onClick={()=>searchProjects(projectNext)}>Más proyectos</button>}
                    <label htmlFor="auto-from_status_id">Estado origen, opcional</label><select id="auto-from_status_id" value={form.from_status_id} disabled={!project || sourceBusy} onChange={event=>field('from_status_id',event.target.value)} {...invalid('from_status_id')}><option value="">Cualquier estado anterior</option>{project?.statuses.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>{fieldError('from_status_id')}
                    <label htmlFor="auto-to_status_id">Estado destino</label><select id="auto-to_status_id" value={form.to_status_id} disabled={!project || sourceBusy} onChange={event=>field('to_status_id',event.target.value)} {...invalid('to_status_id')}><option value="">Selecciona un estado</option>{project?.statuses.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select>{fieldError('to_status_id')}
                    <p>Se observará el estado agregado real de las tareas del proyecto, no el tablero personal. El aviso será genérico y la referencia conservará los permisos de cada lector.</p>
                </>:<>
                    {form.kind==='reminder' ? <><label htmlFor="auto-body">Texto del recordatorio</label><textarea id="auto-body" rows={3} value={form.body} maxLength={2000} onChange={event=>field('body',event.target.value)} {...invalid('body')}/>{fieldError('body')}</>:<>
                        <button type="button" disabled={sourceBusy} onClick={()=>loadTemplates()}>Cargar plantillas del canal</button><label htmlFor="auto-template_id">Plantilla y versión revisadas</label><select id="auto-template_id" value={form.template_id} onChange={event=>{const row=templates.find(item=>item.id===event.target.value);field('template_id',row?.id || '');field('template_version',row?.version || '');}} {...invalid('template_id')}><option value="">Selecciona una plantilla del canal</option>{template && !templates.some(row=>row.id===template.id) && <option value={template.id}>{template.name} · versión {template.version}</option>}{templates.map(row=><option key={row.id} value={row.id}>{row.name} · versión {row.version}</option>)}</select>{fieldError('template_id')}{templateNext && <button type="button" disabled={sourceBusy} onClick={()=>loadTemplates(templateNext)}>Más plantillas</button>}
                        {template && <section className="slack_automation_preview" aria-label="Contenido de plantilla"><strong>{template.title} · versión actual {template.version}</strong>{template.blocks.map(row=><p key={row.id}>{previewBlock(row)}</p>)}{template.version!==+form.template_version && <><p>La versión fijada cambió. Revísala antes de usar la actual.</p><button type="button" onClick={()=>field('template_version',template.version)}>Usar versión actual de plantilla</button></>}</section>}
                    </>}
                    <label htmlFor="auto-next_at">Primera ejecución, hora de este dispositivo</label><input type="datetime-local" id="auto-next_at" value={form.next_at} onChange={event=>field('next_at',event.target.value)} {...invalid('next_at')}/>{fieldError('next_at')}<div className="slack_automation_actions"><button type="button" onClick={()=>field('next_at',localSchedule(Date.now()+5*60000))}>Dentro de cinco minutos</button><button type="button" onClick={()=>field('next_at',localSchedule(Date.now()+60*60000))}>Dentro de una hora</button></div><small>Zona del dispositivo: {zone}. El servidor recibe la fecha en UTC.</small>
                    <label htmlFor="auto-interval_days">Repetir cada cuántos días de 24 horas UTC{form.kind==='reminder' ? ' (vacío: una sola vez)':''}</label><input type="number" min="1" max="365" step="1" id="auto-interval_days" value={form.interval_days} onChange={event=>field('interval_days',event.target.value)} {...invalid('interval_days')}/>{fieldError('interval_days')}<small>No son meses naturales ni horarios locales con ajuste de verano. Los intervalos atrasados se omiten, no se publican en ráfaga.</small>
                </>}
                <label className="slack_automation_check" htmlFor="auto-share_confirmed"><input id="auto-share_confirmed" type="checkbox" checked={form.share_confirmed} onChange={event=>field('share_confirmed',event.target.checked)} {...invalid('share_confirmed')}/>He revisado la acción y su origen para # {channel.name}. Entiendo que publicar aquí no amplía los permisos de los lectores.</label>{fieldError('share_confirmed')}
            </fieldset><div className="slack_automation_actions"><button type="submit" className="slack_primary" disabled={busy || !canManage || !!attempt}><Save size={17} aria-hidden="true"/>{busy ? 'Guardando…':'Guardar en pausa'}</button><button type="button" disabled={locked} onClick={async()=>{if(await mayReplace()){setEditing(false);const value=emptyAutomationForm(selected);setForm(value);setBaseline(value);setErrors({});setError('');}}}>Cancelar revisión</button></div></form>:selected && <>
                <p><strong>{selected.active ? 'Activa':'Pausada'}</strong> · {automationKinds[selected.kind]} · versión {selected.version}</p>{selected.pause_reason && <p>{reason(selected.pause_reason)}</p>}
                {selected.body && <blockquote>{selected.body}</blockquote>}{selected.next_at && <p>Próxima fecha: {automationStamp(selected.next_at)}{selected.interval_days ? ` · cada ${selected.interval_days} días de 24 horas UTC`:' · una sola vez'}</p>}
                {selected.source_available===false && <p className="slack_page_problem">El origen o la acción requieren revisión con los permisos actuales. No se mostrará información retirada.</p>}
                {project && <p>Proyecto: {project.name} · destino: {project.statuses.find(row=>row.id===selected.to_status_id)?.name || 'Estado no disponible'}</p>}{template && <p>Plantilla: {template.name} · versión fijada {selected.template_version}; actual {template.version}</p>}
                <div className="slack_automation_actions">{canManage && <><button type="button" disabled={locked || !!channel.archived_at && !selected.active || !selected.active && selected.source_available===false} onClick={()=>toggle(!selected.active)}>{selected.active ? <Pause size={17} aria-hidden="true"/>:<Play size={17} aria-hidden="true"/>}{selected.active ? 'Pausar regla':'Revisar y activar'}</button><button type="button" disabled={locked || selected.active || !!channel.archived_at} onClick={()=>{setEditing(true);setErrors({});setError('');}}>Revisar configuración</button></>}<button type="button" disabled={locked || loading} onClick={()=>showHistory('runs')}>Ver ejecuciones</button><button type="button" disabled={locked || loading} onClick={()=>showHistory('audit')}>Ver cambios de regla</button></div>
                {history && <section aria-label={historyKind==='runs' ? 'Registro de ejecuciones':'Registro de cambios'}><h4>{historyKind==='runs' ? 'Ejecuciones':'Cambios de regla'}</h4>{!history.results.length && <p>No hay registros en esta vista.</p>}<ol className="slack_automation_history">{history.results.map(row=><li key={row.id}><strong>{historyKind==='runs' ? runState[row.state] || 'Requiere revisión':auditAction[row.action] || 'Cambio'}</strong><span> · versión {row.rule_version || row.version} · {automationStamp(row.finished_at || row.created_at)}</span>{row.reason && <p>{reason(row.reason)}</p>}{row.task && <p>{row.task.available ? row.task.title:'Tarea no disponible con tus permisos actuales.'}</p>}</li>)}</ol>{history.next && <button type="button" disabled={loading || locked} onClick={()=>showHistory(historyKind,history.next)}>Más registros</button>}</section>}
            </>}
            {loading && <p role="status">Consultando reglas y registro…</p>}{sourceBusy && <p role="status">Comprobando el origen seleccionado…</p>}
            {dirty && <p className="messaging_hint" role="status">{recovery.status==='protected' ? 'Revisión cifrada protegida en este dispositivo.':'Protegiendo la revisión; no cierres mientras haya un error.'} Recuperarla no envía ni activa nada automáticamente.</p>}
        </div></div>
    </section>;
}
