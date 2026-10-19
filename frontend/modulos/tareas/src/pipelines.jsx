import {useContext, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ArrowDown, ArrowUp, GripVertical, Plus, Settings2, Trash2, X} from "lucide-react";
import {useCore} from "../../core/core_provider.jsx";
import {http, is_using_real_backend} from "../../core/http_client.js";
import {backgroundRefresh} from "../../core/google_cache.js";
import {BoldSelect} from "../../core/shared/bold_select.jsx";
import ColorPicker from "../../core/shared/color_picker.jsx";
import {useDialog} from "../../core/shared/use_dialog.js";
import {confirmBold} from "../../core/shared/bold_dialog.js";
import {defaultStages, distributeStages, reorderStages, validateStages} from "./pipeline_stages.js";
import {plainRichText} from "./rich_text.js";
import {SharingEye, TeamSharingContext} from "./team.jsx";
import "./pipelines.css";

const base = "/api/v2/";
function announce(taskId, projectId) {window.dispatchEvent(new CustomEvent("bold:pipelines", {detail: {taskId, projectId}}));}
function useQuery(path) {
    const core = useCore(), scope = core.activeAssignment?.id;
    const [state, setState] = useState({path:null,scope:null,value:null,error:"",loading:false});
    const [revision,setRevision] = useState(0);
    useEffect(() => {
        if (!path || !is_using_real_backend()) return;
        const controller = new AbortController();
        let version = 0;
        const load = async () => {
            const ticket = ++version;
            try {const value = await http.request(base + path, {signal:controller.signal});if (!controller.signal.aborted && ticket === version) setState({path,scope,value,error:"",loading:false});}
            catch(problem) {if (!controller.signal.aborted && ticket === version) setState({path,scope,value:null,error:problem.message,loading:false});}
        };
        setState({path,scope,value:null,error:"",loading:true});
        load(); const stop = backgroundRefresh(load, {interval:30000});
        window.addEventListener("bold:pipelines",load);
        return () => {controller.abort();stop();window.removeEventListener("bold:pipelines",load);};
    },[path,scope,revision]);
    return {...(state.path === path && state.scope === scope ? state : {value:null,error:"",loading:Boolean(path)}), retry:()=>setRevision(value=>value+1)};
}
const catalogPath = project => `pipelines/${project ? `?project=${encodeURIComponent(project)}` : ""}`;
function Notice({query}) {return query.error ? <div role="alert" className="pipeline_error">{query.error} <button type="button" onClick={query.retry}>Reintentar</button></div> : query.loading ? <p role="status">Cargando estados…</p> : null;}

export function PipelineFields({projectId, taskId, value, onChange, disabled=false}) {
    const context = useQuery(taskId ? `task-pipelines/${taskId}/` : null);
    const effectiveProject = projectId || (context.value?.project_managed ? context.value.projects[0]?.project : null);
    const catalog = useQuery(catalogPath(effectiveProject));
    const items = catalog.value?.items || [];
    const previous = effectiveProject ? context.value?.projects.find(item=>item.project === effectiveProject) : context.value?.personal;
    const pipeline = items.find(item=>item.id === value?.pipeline) || items.find(item=>item.id === previous?.pipeline.id) || items.find(item=>item.is_default) || items[0];
    const stage = pipeline?.stages.find(item=>item.id === value?.pipeline_stage)?.id || (previous && previous.pipeline.id === pipeline?.id ? previous.stage : null) || pipeline?.stages[0]?.id;
    useEffect(() => {
        if (pipeline && (!context.value?.project_managed || effectiveProject) && (!taskId || context.value) && (value?.pipeline !== pipeline.id || value?.pipeline_stage !== stage)) onChange({pipeline:pipeline.id,pipeline_stage:stage});
    }, [pipeline?.id,stage,effectiveProject,context.value,taskId,value?.pipeline,value?.pipeline_stage,onChange]);
    if (!is_using_real_backend()) return null;
    if(context.value?.project_managed && !effectiveProject)return <p>El estado de esta tarea se gestiona en su proyecto.</p>;
    return <fieldset className="pipeline_fields" disabled={disabled}><Notice query={catalog}/>{context.error && <Notice query={context}/>}
        {pipeline && <><label>Pipeline<BoldSelect label="Pipeline de la tarea" value={pipeline.id} options={items.map(item=>({value:item.id,label:item.name}))} onValueChange={id=>{const next=items.find(item=>item.id===id);onChange({pipeline:id,pipeline_stage:next.stages[0].id});}}/></label>
        <label>Estado<BoldSelect label="Estado de la tarea" value={stage} options={pipeline.stages.map(item=>({value:item.id,label:item.name}))} onValueChange={id=>onChange({pipeline:pipeline.id,pipeline_stage:id})}/></label></>}
    </fieldset>;
}

export function TaskPipelineState({taskId, projectId}) {
    const context = useQuery(taskId ? `task-pipelines/${taskId}/` : null);
    const [selected,setSelected] = useState(projectId || "personal"), [busy,setBusy] = useState(false), [error,setError] = useState("");
    const options = [...(context.value?.personal ? [{value:"personal",label:"Personal"}] : []), ...(context.value?.projects || []).map(item=>({value:item.project,label:item.project_name}))];
    const active = selected === "personal" ? context.value?.personal : context.value?.projects.find(item=>item.project === selected);
    const current = active || context.value?.personal || context.value?.projects[0];
    const catalog = useQuery(current?.pipeline ? catalogPath(current.pipeline.project) : null);
    async function move(pipeline, stage) {
        if (busy) return;
        setBusy(true);setError("");
        try {await http.request(`${base}pipelines/${pipeline.id}/tasks/${taskId}/`,{method:"PUT",body:{stage}});announce(taskId,pipeline.project);}
        catch(problem){setError(problem.message);}finally{setBusy(false);}
    }
    if (!is_using_real_backend()) return null;
    return <section className="pipeline_task_state" aria-label="Estados de la tarea"><h3>Estados</h3><Notice query={context}/>
        {current && <fieldset disabled={busy}><label>Contexto<BoldSelect label="Contexto de estado" value={current.pipeline.project || "personal"} options={options} onValueChange={setSelected}/></label>
        <label>Pipeline<BoldSelect label="Pipeline actual" value={current.pipeline.id} options={(catalog.value?.items || [current.pipeline]).map(item=>({value:item.id,label:item.name}))} onValueChange={id=>{const next=catalog.value.items.find(item=>item.id===id);move(next,next.stages[0].id);}}/></label>
        <label>Estado<BoldSelect label="Cambiar estado" value={current.stage} options={current.pipeline.stages.map(item=>({value:item.id,label:item.name}))} onValueChange={stage=>move(current.pipeline,stage)}/></label></fieldset>}
        {!current && context.value?.project_managed && <p>El estado de esta tarea se gestiona en su proyecto.</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

export async function togglePipelineCompletion(task, projectId, fallback, onSaved) {
    const context = await http.request(`${base}task-pipelines/${task.id}/`);
    const active = projectId ? context.projects.find(item=>item.project === projectId) : context.projects.length === 1 ? context.projects[0] : null;
    if (!active && context.can_complete_without_project && !context.projects.length) return fallback(context.completion_status);
    if (!active && context.project_managed && !context.projects.length) throw new Error("El estado de esta tarea se gestiona en su proyecto. Solicita acceso al proyecto para cambiarlo.");
    if (!active && context.projects.length) throw new Error("Esta tarea participa en varios pipelines. Selecciona cada proyecto en Estados y llévala a Completada en todos para finalizarla.");
    if (!active) {
        if (!task.completed && !context.personal?.pipeline.stages.some(stage=>stage.kind === "completed")) throw new Error("Tu pipeline no tiene Completada. Agrega esa etapa antes de completar la tarea.");
        return fallback(context.completion_status);
    }
    const selected = active.pipeline.stages.find(stage=>stage.id === active.stage);
    const stage = selected?.kind === "completed" ? active.pipeline.stages.find(stage=>stage.kind === "open") : active.pipeline.stages.find(stage=>stage.kind === "completed");
    if (!stage) throw new Error("Este pipeline no tiene Completada. Agrega esa etapa antes de completar la tarea.");
    const result = await http.request(`${base}pipelines/${active.pipeline.id}/tasks/${task.id}/`,{method:"PUT",body:{stage:stage.id}});
    onSaved?.(result);
    announce(task.id,active.project);
}

export default function PipelinePanel({projects=[], projectId, personal=false, onSelectTask}) {
    const sharing = useContext(TeamSharingContext);
    const core = useCore(), key = `bold_pipeline_selection:${core.activeAssignment?.id || "demo"}:${personal ? "mine" : projectId}`;
    const [saved] = useState(()=>{try{return JSON.parse(localStorage.getItem(key)) || {};}catch{return {};}});
    const [context,setContext] = useState(personal ? saved.context || "personal" : projectId);
    const validContext = personal && context !== "personal" && !projects.some(project=>project.id===context) ? "personal" : context;
    const selectedProject = personal ? validContext === "personal" ? null : validContext : projectId;
    const catalog = useQuery(catalogPath(selectedProject));
    const [selected,setSelected] = useState(saved.pipeline || "");
    const items = catalog.value?.items || [];
    const pipeline = items.find(item=>item.id===selected) || items.find(item=>item.is_default) || items[0];
    const board = useQuery(pipeline ? `pipelines/${pipeline.id}/board/${personal && selectedProject ? "?mine=1" : ""}` : null);
    const [editor,setEditor] = useState(null),[removing,setRemoving] = useState(false),[busy,setBusy] = useState(false),[error,setError] = useState("");
    const [dragging,setDragging] = useState(null),[dropStage,setDropStage] = useState(null),[moving,setMoving] = useState(null),[arrived,setArrived] = useState(null);
    const currentPipeline = board.value?.pipeline || pipeline;
    const cardNodes=useRef(new Map()),keyboardFocus=useRef(null),draggedTask=useRef(null);
    const [dragHeight,setDragHeight]=useState(140);
    useEffect(()=>{if(moving && keyboardFocus.current===moving.task){cardNodes.current.get(moving.task)?.focus();keyboardFocus.current=null;}},[moving]);
    useEffect(()=>{try{localStorage.setItem(key,JSON.stringify({context:validContext,pipeline:pipeline?.id || ""}));}catch{}},[key,validContext,pipeline?.id]);
    const placements = {...board.value?.placements,...(moving && moving.pipeline===pipeline?.id ? {[moving.task]:moving.stage} : {})};
    useEffect(()=>{if(moving && moving.pipeline===pipeline?.id && board.value?.placements[moving.task]===moving.stage)setMoving(null);},[board.value,moving,pipeline?.id]);
    useEffect(()=>{if(!arrived)return;const timer=setTimeout(()=>setArrived(null),1200);return()=>clearTimeout(timer);},[arrived]);
    useEffect(()=>{setDragging(null);setDropStage(null);setError("");},[pipeline?.id]);
    async function move(task,stage) {
        if (busy || placements[task]===stage) return;
        const change={task,stage,pipeline:pipeline.id};
        setBusy(true);setError("");setMoving(change);draggedTask.current=null;setDragging(null);setDropStage(null);
        try{await http.request(`${base}pipelines/${pipeline.id}/tasks/${task}/`,{method:"PUT",body:{stage}});setArrived(change);announce(task,pipeline.project);}
        catch(problem){setMoving(null);setError(problem.message);}finally{setBusy(false);}
    }
    if (!is_using_real_backend()) return <p>Conecta con BOLD para gestionar tus pipelines.</p>;
    return <section className="pipelines_panel" aria-label="Tablero de estados">
        <div className="pipeline_toolbar">
            {personal && <label>Mostrar<BoldSelect label="Proyecto o personal" searchable value={validContext} options={[{value:"personal",label:"Personal"},...projects.map(item=>({value:item.id,label:item.label}))]} onValueChange={id=>{setContext(id);setSelected("");}}/></label>}
            {items.length>1 && <label>Pipeline<BoldSelect label="Pipeline mostrado" value={pipeline?.id} options={items.map(item=>({value:item.id,label:item.name}))} onValueChange={setSelected}/></label>}
            {currentPipeline && <div className="pipeline_toolbar_actions"><strong>{currentPipeline.name}</strong>
                {currentPipeline.can_manage && <button type="button" onClick={()=>setEditor(currentPipeline)}><Settings2 size={16}/>Configurar</button>}
                {selectedProject && items.some(item=>item.can_manage) && <button type="button" onClick={()=>setEditor({name:"",stages:defaultStages(),project:selectedProject})}><Plus size={16}/>Crear pipeline</button>}

            </div>}
        </div>
        <p className="pipeline_move_hint" id="pipeline_move_hint">Arrastra las tareas para cambiar de etapa. Con teclado: Alt + flecha izquierda o derecha.</p><span className="pipeline_move_status" role="status">{moving && moving.pipeline===pipeline?.id ? "Guardando cambio de etapa…" : arrived && arrived.pipeline===pipeline?.id ? "Etapa actualizada" : ""}</span>
        {!selectedProject && sharing?.error && <p className="pipeline_error" role="alert">{sharing.error} <button type="button" onClick={sharing.retry}>Reintentar</button></p>}
        <Notice query={catalog}/><Notice query={board}/>{error && <p className="pipeline_error" role="alert">{error}</p>}
        {currentPipeline && board.value && <div className="pipeline_board board_view" aria-busy={busy}>{currentPipeline.stages.map(stage=><section className={`board_column pipeline_column ${dropStage===stage.id ? "is_drop_target" : ""}`} key={stage.id} onDragOver={event=>{if(!busy && draggedTask.current){event.preventDefault();event.dataTransfer.dropEffect="move";setDropStage(stage.id);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setDropStage(null);}} onDrop={event=>{event.preventDefault();try{const data=JSON.parse(event.dataTransfer.getData("application/bold-pipeline"));if(data.pipeline===pipeline.id)void move(data.task,stage.id);}catch{}}}>
            <header><span className="pipeline_stage_dot" style={{background:stage.color}}/>{personal && !currentPipeline.project && <SharingEye ids={board.value.tasks.filter(task=>placements[task.id]===stage.id).map(task=>task.id)} label={stage.name} section groupLabel="etapa" disabled={busy || moving?.pipeline===pipeline.id}/>}<h2>{stage.name}</h2><span>{Object.values(placements).filter(id=>id===stage.id).length}</span></header>
            {stage.description && <p className="pipeline_stage_description">{stage.description}</p>}
            <div className="board_card_stack">{board.value.tasks.filter(task=>placements[task.id]===stage.id || dropStage===stage.id && task.id===dragging).map(task=>placements[task.id]!==stage.id ? <div className="pipeline_drop_preview" key={`preview-${task.id}`} style={{minHeight:dragHeight}} aria-hidden="true"><span>Soltar aquí</span><strong>{task.title}</strong></div> : <article className={`board_card pipeline_card ${dragging===task.id ? "is_dragging" : ""} ${arrived?.pipeline===pipeline.id && arrived.task===task.id ? "just_moved" : ""}`} key={task.id} ref={node=>{if(node)cardNodes.current.set(task.id,node);else cardNodes.current.delete(task.id);}} draggable={!busy} tabIndex={0} aria-label={`${task.title}, ${stage.name}`} aria-describedby="pipeline_move_hint" onKeyDown={event=>{if(event.altKey && ['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const index=currentPipeline.stages.findIndex(item=>item.id===stage.id)+(event.key==='ArrowLeft'?-1:1);if(currentPipeline.stages[index]){keyboardFocus.current=task.id;void move(task.id,currentPipeline.stages[index].id);}}}} onDragStart={event=>{draggedTask.current=task.id;setDragHeight(event.currentTarget.offsetHeight);setDragging(task.id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/bold-pipeline",JSON.stringify({pipeline:pipeline.id,task:task.id}));}} onDragEnd={()=>{draggedTask.current=null;setDragging(null);setDropStage(null);}}>
                <div className="pipeline_card_heading"><button type="button" className="pipeline_task_title" onClick={()=>onSelectTask(task.id)}>{task.title}</button>{personal && !currentPipeline.project && <SharingEye ids={[task.id]} label={task.title} disabled={busy || moving?.pipeline===pipeline.id}/>}</div>
                <p>{plainRichText(task.description || "Sin descripción adicional.")}</p>
                <footer><span>{task.due_date ? new Date(task.due_date+'T12:00:00').toLocaleDateString('es') : "Sin fecha"}</span><span className="task_badge">{{high:"Alta",medium:"Media",low:"Baja"}[task.priority] || task.priority}</span></footer>
                <div className="pipeline_progress" style={{"--stage-color":stage.color}}><div><span>{stage.name}</span><span>{stage.probability}%</span></div><div className="pipeline_progress_track" role="progressbar" aria-label={`Etapa de ${task.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.probability} aria-valuetext={`${stage.name}, ${stage.probability}%`}><span style={{width:`${stage.probability}%`}}/></div></div>
            </article>)}</div>
        </section>)}</div>}
        {editor && <PipelineEditor pipeline={editor} canDelete={Boolean(selectedProject && items.length>1)} onDelete={()=>{setEditor(null);setRemoving(true);}} close={()=>setEditor(null)} saved={value=>{setSelected(value.id);setEditor(null);announce(null,value.project);}}/>}
        {removing && <RemovePipeline pipeline={currentPipeline} alternatives={items.filter(item=>item.id!==pipeline.id)} close={()=>setRemoving(false)} removed={()=>{setRemoving(false);setSelected("");announce();}}/>}
    </section>;
}

function PipelineEditor({pipeline,close,saved,canDelete=false,onDelete}) {
    const core = useCore();
    const [name,setName] = useState(pipeline.name),[stages,setStages] = useState(pipeline.stages.map(stage=>({...stage}))),[transfers,setTransfers] = useState({});
    const [busy,setBusy] = useState(false),[error,setError] = useState("");
    const [isDefault,setIsDefault] = useState(Boolean(pipeline.is_default));
    const dragging = useRef(null);
    useDialog(true,'.pipeline_editor',()=>{if(!busy)close();});
    const deleted = pipeline.stages.filter(old=>old.task_count>0 && !stages.some(stage=>stage.id===old.id));
    function patch(id,changes){setStages(rows=>rows.map(row=>row.id===id?{...row,...changes}:row));}
    function reorder(from,to){setStages(rows=>reorderStages(rows,from,to));}
    function add(kind){setStages(rows=>{let number=rows.filter(row=>row.kind==='open').length+1;let name=kind==='open'?`Etapa ${number}`:kind==='completed'?'Completada':'Fallida';while(rows.some(row=>row.name.toLocaleLowerCase('es')===name.toLocaleLowerCase('es')))name=`Etapa ${++number}`;return distributeStages([...rows,{id:crypto.randomUUID(),name,description:"",color:kind==='failed'?'#dc2626':kind==='completed'?'#16a34a':'#3b82f6',kind,manual:false,probability:0}]);});}
    async function submit(event){
        event.preventDefault();if(busy)return;
        const invalid=validateStages(stages);if(invalid){setError(invalid);return;}
        if(deleted.some(stage=>!transfers[stage.id])){setError("Selecciona la etapa de destino de las tareas que vas a trasladar.");return;}
        if(!stages.some(stage=>stage.kind==='completed') && !await confirmBold('Este pipeline no incluye una etapa «Completada». Sus tareas no podrán finalizarse desde este flujo hasta que agregues esa etapa. Puedes guardar el pipeline y añadirla después. «No volver a mostrar» guarda el pipeline y desactiva este aviso.',{title:'Pipeline sin Completada',rememberKey:`bold_pipeline_no_completed:${core.activeAssignment?.personId || core.account?.id}`}))return;
        setBusy(true);setError("");
        try{const value=await http.request(`${base}pipelines/${pipeline.id?pipeline.id+'/':''}`,{method:pipeline.id?'PUT':'POST',body:{name:name.trim(),stages,project:pipeline.project,version:pipeline.version,transfers,is_default:isDefault}});saved(value);}
        catch(problem){setError(problem.message);}finally{setBusy(false);}
    }
    return createPortal(<div className="pipeline_modal_overlay"><section className="pipeline_editor" role="dialog" aria-modal="true" aria-labelledby="pipeline_editor_title">
        <header><div><h2 id="pipeline_editor_title">{pipeline.id?'Configurar pipeline':'Crear pipeline'}</h2><p>Organiza las etapas y el progreso de este flujo.</p></div><button type="button" aria-label="Cerrar configuración" disabled={busy} onClick={close}><X size={20}/></button></header>
        <form onSubmit={submit}><div className="pipeline_editor_body"><label className="pipeline_name">Nombre del pipeline<input autoFocus maxLength={80} required value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
        {pipeline.project && <label className="pipeline_default"><input type="checkbox" checked={isDefault} disabled={busy || Boolean(pipeline.is_default)} onChange={event=>setIsDefault(event.target.checked)}/>{'Usar como pipeline predeterminado'}</label>}
        <div className="pipeline_stage_table"><div className="pipeline_stage_head" aria-hidden="true"><span>Orden</span><span>Nombre de la etapa</span><span>Descripción</span><span>Color</span><span>Porcentaje</span><span>Tareas</span><span>Eliminar</span></div>
        {stages.map((stage,index)=><div className="pipeline_stage_row" key={stage.id} onDragOver={event=>{if(stage.kind==='open' && dragging.current!==null)event.preventDefault();}} onDrop={event=>{if(stage.kind==='open' && dragging.current!==null){event.preventDefault();reorder(dragging.current,index);dragging.current=null;}}}>
            <div className="pipeline_stage_order">{stage.kind==='open'?<><button type="button" draggable={!busy} aria-label={`Mover ${stage.name}`} onDragStart={event=>{dragging.current=index;event.dataTransfer.setData('text/plain',String(index));}} onDragEnd={()=>{dragging.current=null;}} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();reorder(index,index+(event.key==='ArrowUp'?-1:1));}}}><GripVertical size={16}/></button><button type="button" aria-label={`Subir ${stage.name}`} disabled={busy||index===0} onClick={()=>reorder(index,index-1)}><ArrowUp size={13}/></button><button type="button" aria-label={`Bajar ${stage.name}`} disabled={busy||index===stages.filter(s=>s.kind==='open').length-1} onClick={()=>reorder(index,index+1)}><ArrowDown size={13}/></button></>:<span>Final</span>}</div>
            <label><span>Nombre de la etapa</span><input aria-label={`Nombre de etapa ${index+1}`} maxLength={80} required disabled={busy||stage.kind!=='open'} value={stage.name} onChange={event=>patch(stage.id,{name:event.target.value})}/></label>
            <label><span>Descripción</span><textarea aria-label={`Descripción de ${stage.name}`} rows={2} maxLength={1000} disabled={busy} value={stage.description} onChange={event=>patch(stage.id,{description:event.target.value})}/></label>
            <div className="pipeline_color"><span>Color</span><ColorPicker label={`Color de ${stage.name}`} value={stage.color} disabled={busy} onChange={color=>patch(stage.id,{color})}/></div>
            <label className="pipeline_probability"><span>Porcentaje</span><div><input aria-label={`Porcentaje de ${stage.name}`} type="number" min={0} max={99} step={1} disabled={busy||stage.kind!=='open'} value={stage.probability} onChange={event=>patch(stage.id,{probability:event.target.value===''?'':Number(event.target.value),manual:true})}/><span>%</span></div></label>
            <span className="pipeline_usage" aria-label={`${stage.task_count||0} tareas`}>{stage.task_count||0}</span>
            <button type="button" aria-label={`Eliminar etapa ${stage.name}`} disabled={busy||stage.kind==='open'&&stages.filter(s=>s.kind==='open').length===1} onClick={()=>setStages(rows=>distributeStages(rows.filter(row=>row.id!==stage.id)))}><Trash2 size={16}/></button>
        </div>)}</div>
        <div className="pipeline_add_stage"><button type="button" disabled={busy} onClick={()=>add('open')}><Plus size={16}/>Agregar etapa</button>{!stages.some(s=>s.kind==='completed')&&<button type="button" disabled={busy} onClick={()=>add('completed')}>Agregar Completada</button>}{!stages.some(s=>s.kind==='failed')&&<button type="button" disabled={busy} onClick={()=>add('failed')}>Agregar Fallida</button>}</div>
        {deleted.map(stage=><label className="pipeline_transfer" key={stage.id}>Trasladar {stage.task_count} tareas de «{stage.name}» a<BoldSelect label={`Destino de ${stage.name}`} value={transfers[stage.id]||''} options={[{value:'',label:'Seleccionar etapa'},...stages.map(row=>({value:row.id,label:row.name}))]} onValueChange={id=>setTransfers(current=>({...current,[stage.id]:id}))}/></label>)}
        {error&&<p className="pipeline_error" role="alert">{error}</p>}</div>
        <footer>{canDelete && pipeline.id && <button className="pipeline_delete_button" type="button" disabled={busy} onClick={onDelete}><Trash2 size={15}/>Eliminar pipeline</button>}<button type="button" disabled={busy} onClick={close}>Cancelar</button><button type="submit" className="primary_button" disabled={busy||!name.trim()}>{busy?'Guardando…':'Guardar pipeline'}</button></footer></form>
    </section></div>,document.body);
}

function RemovePipeline({pipeline,alternatives,close,removed}){
    const [target,setTarget]=useState(''),[stage,setStage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const next=alternatives.find(item=>item.id===target),used=pipeline.stages.some(item=>item.task_count>0);
    useDialog(true,'.pipeline_remove',()=>{if(!busy)close();});
    async function submit(event){event.preventDefault();if(busy)return;setBusy(true);try{await http.request(`${base}pipelines/${pipeline.id}/`,{method:'DELETE',body:{target_pipeline:target||undefined,target_stage:stage||undefined}});removed();}catch(problem){setError(problem.message);setBusy(false);}}
    return createPortal(<div className="pipeline_modal_overlay"><form className="pipeline_remove" role="dialog" aria-modal="true" aria-label="Eliminar pipeline" onSubmit={submit}><h2>Eliminar «{pipeline.name}»</h2><p>Las tareas se conservarán. {used?'Selecciona su destino antes de eliminar el pipeline.':''}</p>{used&&<><label>Pipeline de destino<BoldSelect label="Pipeline de destino" value={target} options={[{value:'',label:'Seleccionar'},...alternatives.map(item=>({value:item.id,label:item.name}))]} onValueChange={id=>{setTarget(id);setStage('');}}/></label>{next&&<label>Etapa de destino<BoldSelect label="Etapa de destino" value={stage} options={[{value:'',label:'Seleccionar'},...next.stages.map(item=>({value:item.id,label:item.name}))]} onValueChange={setStage}/></label>}</>}{error&&<p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={close}>Cancelar</button><button type="submit" disabled={busy||used&&(!target||!stage)}>Eliminar pipeline</button></footer></form></div>,document.body);
}
