import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {ListTodo,X} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {useDialog} from '../core/shared/use_dialog.js';
import {confirmBold} from '../core/shared/bold_dialog.js';
import {taskConversionApi,conversionError,isTaskReference} from './task_conversion_api.js';
import {conversionSection,initialTaskReview,restoreTaskReview,taskAttempt,taskDraft,taskMessageTitle} from './task_conversion_model.js';
import {useComposerDrafts} from './use_composer_drafts.js';
import './message_tasks.css';
const HistorySearch=lazy(()=>import('./history_search.jsx'));

export default function MessageTasks(props){
    const core=useCore(),[open,setOpen]=useState(false),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true || !isTaskReference(props.message.id))return null;
    return <><button type="button" className="message_task_control" disabled={props.disabled} aria-label="Tareas del mensaje" title="Crear tarea o ver tareas vinculadas" onClick={()=>setOpen(true)}><ListTodo size={17} aria-hidden="true"/></button>
        {open && <TaskConversion key={`${identity}:${props.kind}:${props.containerId}:${props.message.id}`} {...props} identity={identity} onClose={()=>setOpen(false)}/>}</>;
}
function TaskConversion({kind,containerId,message,identity,onClose}){
    const core=useCore(),[form,setForm]=useState(initialTaskReview),[attempt,setAttempt]=useState(null),[source,setSource]=useState(null);
    const [links,setLinks]=useState([]),[next,setNext]=useState(null),[projects,setProjects]=useState([]),[projectNext,setProjectNext]=useState(null),[projectQuery,setProjectQuery]=useState(''),[searchUsed,setSearchUsed]=useState(''),[projectDetail,setProjectDetail]=useState(null);
    const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[result,setResult]=useState(null);
    const active=useRef(true),current=useRef(null),readRequest=useRef(null),projectRequest=useRef(null),writeRequest=useRef(null),sending=useRef(false),review=useRef(null);
    current.current={identity,allowed:!core.securityUncertain};review.current={form,attempt};
    const valid=controller=>active.current && !controller.signal.aborted && current.current.identity===identity && current.current.allowed;
    const draft=useComposerDrafts({context:identity,resource:{kind:'message-task',resource_id:message.id,container_id:containerId,source_kind:kind},
        read:()=>taskDraft(review.current.form,review.current.attempt),restore:(_,payload,files)=>{const restored=restoreTaskReview(payload,files);setForm(restored.form);setAttempt(restored.attempt);setResult(null);setNotice('Revisión recuperada. No se ha creado ni enviado ninguna tarea automáticamente.');return true;},
        onDenied:()=>{setLinks([]);setSource(null);onClose();},volatile:busy});
    useEffect(()=>{active.current=true;return()=>{active.current=false;readRequest.current?.abort();projectRequest.current?.abort();writeRequest.current?.abort();};},[]);
    async function close(){
        if(!form.touched && !attempt || draft.recovery || await draft.flush() || await confirmBold('No se pudo conservar esta revisión. ¿Cerrar sin conservar los últimos cambios?'))onClose();
    }
    useDialog(true,'.message_task_dialog',close);
    async function loadLinks(page=null,reviewAgain=false){
        readRequest.current?.abort();const controller=new AbortController();readRequest.current=controller;setLoading(true);
        try{const value=await taskConversionApi.links(kind,containerId,message.id,page,{signal:controller.signal});if(valid(controller)){
            setLinks(old=>page ? [...old,...value.results]:value.results);setNext(value.next);
            if(!source || reviewAgain){setSource({version:value.source_version,text:value.source_text});setForm(old=>({...old,source_version:value.source_version,...(old.touched || attempt ? {}:{title:taskMessageTitle(value.source_text),description:value.source_text || ''})}));}
        }}catch(err){if(valid(controller)){if([401,403,404].includes(err.status)){setLinks([]);setSource(null);}setError(conversionError(err));}}
        finally{if(valid(controller))setLoading(false);}
    }
    async function findProjects(page=null){
        projectRequest.current?.abort();const controller=new AbortController();projectRequest.current=controller;
        const query=page ? searchUsed:projectQuery;setError('');
        try{const value=await taskConversionApi.projects(query,page,{signal:controller.signal});if(valid(controller)){setProjects(old=>[...new Map([...(page ? old:[]),...value.results].map(row=>[row.id,row])).values()]);setProjectNext(value.next);setSearchUsed(query);}}
        catch(err){if(valid(controller))setError(conversionError(err));}
    }
    useEffect(()=>{loadLinks();findProjects();},[]);
    useEffect(()=>{
        if(!form.project){setProjectDetail(null);return;}
        const controller=new AbortController();setProjectDetail(null);
        taskConversionApi.project(form.project,{signal:controller.signal}).then(value=>{if(valid(controller)){
            setProjectDetail(value);
            let saved;try{saved=JSON.parse(localStorage.getItem(`bold_last_task_section:${core.activeAssignment.id}`) || '{}')[form.project];}catch{/* First visible section is the fallback. */}
            setForm(old=>old.section_chosen || attempt ? old:{...old,section:conversionSection(value.sections,saved)});
        }}).catch(err=>{if(valid(controller))setError(conversionError(err));});
        return()=>controller.abort();
    },[form.project]);
    function change(key,value){setForm(old=>({...old,[key]:value,touched:true,...(key==='confirmed' ? {}:{confirmed:false}),...(key==='project' ? {section:'',section_chosen:false,status:''}:{}),...(key==='section' ? {section_chosen:true}:{})}));setError('');}
    async function create(event){
        event.preventDefault();if(sending.current || draft.blocked || result)return;
        const controller=new AbortController();writeRequest.current=controller;sending.current=true;setBusy(true);setError('');setNotice('');
        try{
            const operation=attempt || taskAttempt(form);
            if(!attempt)flushSync(()=>setAttempt(operation));
            if(!await draft.flush())throw Error('No se pudo proteger el intento. Reintenta la protección del borrador antes de crear.');
            const value=await taskConversionApi.create(kind,containerId,message.id,operation,{signal:controller.signal});
            if(valid(controller)){
                const key=`bold_last_task_section:${core.activeAssignment.id}`,section=operation.section || 'unsectioned';
                try{const saved=JSON.parse(localStorage.getItem(key) || '{}');localStorage.setItem(key,JSON.stringify({...saved,[operation.project]:section}));}catch{/* The task is already confirmed; preferences are optional. */}
                window.dispatchEvent(new CustomEvent('bold:task-section-used',{detail:{assignmentId:core.activeAssignment.id,projectId:operation.project,sectionId:section}}));
                flushSync(()=>{setAttempt(null);setForm(old=>({...old,touched:false,confirmed:false}));setResult(value);});await draft.flush();setNotice(value.created ? 'Tarea creada y vinculada al mensaje.':'La tarea ya estaba creada. El reintento no la duplicó.');loadLinks();
            }
        }catch(err){if(valid(controller)){
            if([400,401,403,404].includes(err.status)){setAttempt(null);setForm(old=>({...old,touched:true,confirmed:false}));if([401,403,404].includes(err.status))loadLinks();}
            setError(err.status ? conversionError(err):err.message);
        }}
        finally{sending.current=false;if(valid(controller))setBusy(false);}
    }
    async function openTask(task){
        const controller=new AbortController();writeRequest.current=controller;setBusy(true);setError('');
        try{await taskConversionApi.task(task.id,{signal:controller.signal});if(valid(controller) && (draft.recovery || await draft.flush())){onClose();window.dispatchEvent(new CustomEvent('bold:brand-resource',{detail:{task:task.id}}));}}
        catch(err){if(valid(controller)){setLinks([]);setError(conversionError(err));}}finally{if(valid(controller))setBusy(false);}
    }
    const readonly=busy || loading || !source || !!attempt || !!result || draft.blocked;
    const chosen=projectDetail?.project?.id===form.project ? projectDetail:null;
    const projectOptions=[...new Map([...projects,...(chosen ? [chosen.project]:[])].map(row=>[row.id,row])).values()];
    return createPortal(<div className="message_task_scrim"><section className="message_task_dialog" role="dialog" aria-modal="true" aria-labelledby="message_task_title">
        <header><div><h2 id="message_task_title">Tareas del mensaje</h2><p>Usa el módulo de Tareas; el mensaje original mantiene sus propios permisos.</p></div><button type="button" aria-label="Cerrar tareas del mensaje" onClick={close}><X size={20} aria-hidden="true"/></button></header>
        <div className="message_task_content">
            {loading && <p role="status">Cargando referencias autorizadas…</p>}
            <section aria-label="Tareas vinculadas"><h3>Tareas vinculadas</h3><button type="button" disabled={loading || busy} onClick={()=>loadLinks()}>Actualizar tareas vinculadas</button>{!loading && !links.length && <p>No hay tareas vinculadas disponibles con tus permisos.</p>}{links.map(row=>row.task.available && <button key={row.id} type="button" disabled={busy} onClick={()=>openTask(row.task)}><strong>{row.task.title}</strong><span>{row.task.status} · Abrir tarea</span></button>)}{next && <button type="button" disabled={loading || busy} onClick={()=>loadLinks(next)}>Más tareas vinculadas</button>}</section>
            {draft.recovery && <section className="message_task_problem"><p>Hay una revisión cifrada conservada. Recuperarla no crea la tarea.</p><button type="button" onClick={draft.recover}>Recuperar revisión de tarea</button><button type="button" onClick={draft.discard}>Descartar revisión conservada</button></section>}
            {draft.error && <p role="alert">No se pudo proteger la revisión. <button type="button" onClick={draft.retry}>Reintentar protección</button></p>}
            {source && <details><summary>Mensaje de origen · revisión {source.version}</summary><p className="message_task_source">{source.text || 'Mensaje multimedia sin texto. Los archivos no se copian.'}</p></details>}
            {result && <section className="message_task_problem"><p>{result.task.available ? `Confirmada: ${result.task.title}`:'La creación está confirmada, pero la tarea no está disponible con tus permisos actuales.'}</p><button type="button" onClick={()=>{setResult(null);setForm(old=>({...old,confirmed:false,touched:false}));}}>Preparar otra tarea</button></section>}
            {source && <form onSubmit={create} aria-busy={busy}>
                <h3>Crear tarea desde este mensaje</h3>
                <p>Solo se compartirá el título y la descripción que apruebes aquí. No se copian imágenes, audios, reacciones ni el resto de la conversación.</p>
                <div className="message_task_project_search"><label>Buscar proyecto<input value={projectQuery} maxLength={120} disabled={readonly} onChange={event=>setProjectQuery(event.target.value)}/></label><button type="button" disabled={readonly} onClick={()=>findProjects()}>Buscar proyectos</button>{projectNext && <button type="button" disabled={readonly} onClick={()=>findProjects(projectNext)}>Más proyectos</button>}</div>
                <label>Proyecto<select required value={form.project} disabled={readonly} onChange={event=>change('project',event.target.value)}><option value="">Seleccionar proyecto autorizado</option>{projectOptions.map(row=><option key={row.id} value={row.id}>{row.name} · {row.unit_name}</option>)}</select></label>
                <label>Sección<select value={form.section} disabled={readonly || !chosen} onChange={event=>change('section',event.target.value)}>{chosen?.sections.some(row=>row.id===null) ? <option value="">Sin sección</option>:<option value="" disabled={!!chosen?.sections.length}>{chosen?.sections.length ? 'Seleccionar sección':'Sin secciones disponibles'}</option>}{chosen?.sections.filter(row=>row.id).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
                <label>Responsable<select value={form.assignee_assignment} disabled={readonly} onChange={event=>change('assignee_assignment',event.target.value)}><option value="">Sin responsable</option>{(core.directory || []).map(row=><option key={row.id} value={row.id}>{row.name} · {row.unit_name}</option>)}</select></label>
                <div className="message_task_row"><label>Fecha límite<input type="date" value={form.due_date} disabled={readonly} onChange={event=>change('due_date',event.target.value)}/></label><label>Prioridad<select value={form.priority} disabled={readonly} onChange={event=>change('priority',event.target.value)}>{['Alta','Media','Baja'].map(value=><option key={value}>{value}</option>)}</select></label></div>
                <label>Estado inicial<select value={form.status} disabled={readonly || !chosen} onChange={event=>change('status',event.target.value)}><option value="">Estado inicial del equipo</option>{chosen?.statuses.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
                <label>Título<input required maxLength={220} value={form.title} disabled={readonly} onChange={event=>change('title',event.target.value)}/></label>
                <label>Descripción que se compartirá<textarea rows={4} maxLength={10000} value={form.description} disabled={readonly} onChange={event=>change('description',event.target.value)}/></label>
                <label className="message_task_consent"><input type="checkbox" checked={form.confirmed} disabled={readonly} onChange={event=>change('confirmed',event.target.checked)}/><span>He revisado el texto y autorizo compartirlo con quienes puedan leer la tarea, según el proyecto, responsable y permisos elegidos. Esto no les da acceso al mensaje original.</span></label>
                {attempt && <p>Hay un intento protegido sin confirmar. Reintentar conserva su texto, proyecto e identificador, sin crear otra tarea si ya se guardó.</p>}
                {attempt && !busy && <button type="button" onClick={async()=>{if(await confirmBold('Deja el intento anterior solo si ya comprobaste si se creó la tarea. ¿Actualizar el origen y volver a revisar con un intento nuevo?')){setAttempt(null);setForm(old=>({...old,confirmed:false,touched:true}));loadLinks(null,true);}}}>Volver a revisar</button>}
                <button type="submit" disabled={busy || loading || !source || draft.blocked || !!result || !attempt && (!form.project || !chosen || !form.confirmed || !form.title.trim())}>{busy ? 'Confirmando tarea…':attempt ? 'Reintentar creación pendiente':'Crear tarea y vincular'}</button>
            </form>}
            {error && <p className="message_task_problem" role="alert">{error}</p>}<p role="status" aria-atomic="true">{notice || (draft.status==='protected' ? 'Revisión cifrada protegida en este dispositivo.':'')}</p>
        </div>
    </section></div>,document.body);
}

export function TaskMessageOrigins({taskId}){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true || !isTaskReference(taskId))return null;
    return <Origins key={`${identity}:${taskId}`} taskId={taskId}/>;
}
function Origins({taskId}){
    const [rows,setRows]=useState([]),[target,setTarget]=useState(null);
    useEffect(()=>{const controller=new AbortController();taskConversionApi.origins(taskId,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setRows(value.results);}).catch(()=>{if(!controller.signal.aborted)setRows([]);});return()=>controller.abort();},[taskId]);
    if(!rows.length)return null;
    return <section className="task_message_origins" aria-label="Mensajes de origen"><h3>Origen de conversación</h3>{rows.map(row=><button type="button" key={row.id} onClick={()=>setTarget(row.target)}>Ver mensaje de origen · {row.target.kind==='chat' ? 'Chat privado':'Slack'}</button>)}
        {target && <Suspense fallback={<p role="status">Abriendo mensaje de origen…</p>}><HistorySearch initialTarget={target} initialScope={target.kind==='chat' ? 'chat':'slack'} initialConversation={target.conversation_id || null} onClose={()=>setTarget(null)}/></Suspense>}
    </section>;
}
