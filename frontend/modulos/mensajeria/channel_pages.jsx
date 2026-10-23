import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {flushSync} from "react-dom";
import {Archive,ArrowDown,ArrowLeft,ArrowUp,BookOpen,CheckSquare,Clock,FileText,LayoutTemplate,Lightbulb,Link,Plus,Send,Trash2,X} from "lucide-react";
import {confirmBold} from "../core/shared/bold_dialog.js";
import {useDialog} from "../core/shared/use_dialog.js";
import {channelApi,createChannelRefresh} from "./channel_api.js";
import {pageApi,pageError,connectPage} from "./page_api.js";
import {createPageEditor,documentContent} from "./page_editor_model.js";
import {createCollaborativePage} from "./page_collab_model.js";
import CollaborativeField,{peerColor} from "./collaborative_field.jsx";
import {ReadBlocks} from "./page_blocks.jsx";
import ChannelTaskPicker from "./channel_task_picker.jsx";
import "./channel_pages.css";
const PageTemplates=lazy(()=>import("./page_templates.jsx"));

const icons={note:FileText,book:BookOpen,checklist:CheckSquare,idea:Lightbulb};
const kinds={paragraph:"Texto",heading:"Título",bullet:"Lista",check:"Casilla",task:"Tarea"};
const stamp=value=>new Date(value).toLocaleString("es",{dateStyle:"medium",timeStyle:"short"});
function PageIcon({value}){const Icon=icons[value] || FileText;return <Icon size={20} aria-hidden="true"/>;}
function History({channelId,page,onClose,onRestore,onDenied,disabled,onTask}){
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
    const active=useRef(false),request=useRef(null);
    useDialog(true,".slack_page_history",onClose);
    async function load(cursor=null){
        request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError("");
        try{const result=await pageApi.history(channelId,page.id,cursor,{signal:c.signal});if(!c.signal.aborted && active.current){setRows(current=>cursor ? [...current,...result.results]:result.results);setNext(result.next);}}
        catch(err){if(!c.signal.aborted && active.current){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}}
        finally{if(!c.signal.aborted && active.current)setBusy(false);}
    }
    async function preview(version){
        request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError("");
        try{const result=await pageApi.revision(channelId,page.id,version,{signal:c.signal});if(!c.signal.aborted && active.current)setSnapshot(result);}
        catch(err){if(!c.signal.aborted && active.current){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}}
        finally{if(!c.signal.aborted && active.current)setBusy(false);}
    }
    useEffect(()=>{active.current=true;load();return()=>{active.current=false;request.current?.abort();};},[]);
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_history" role="dialog" aria-modal="true" aria-labelledby="page_history_title">
        <header><h2 id="page_history_title">Historial de la página</h2><button type="button" aria-label="Cerrar historial" onClick={onClose}><X size={20}/></button></header>
        <p>El historial conserva puntos de recuperación, no cada pulsación. Recuperar una versión crea otra nueva sin borrar el historial anterior.</p>
        {error && <p role="alert" className="slack_error">{error}</p>}{busy && <p role="status">Cargando versiones…</p>}
        <ol className="slack_page_versions">{rows.map(row=><li key={row.version}><button type="button" disabled={busy} onClick={()=>preview(row.version)} aria-pressed={snapshot?.version===row.version}><strong>Versión {row.version} · {row.title}</strong><small>{stamp(row.created_at)} · {row.actor}{row.archived ? " · Archivada":""}</small></button></li>)}</ol>
        {next && <button type="button" disabled={busy} onClick={()=>load(next)}>Más versiones</button>}
        {snapshot && <section className="slack_page_snapshot"><h3>{snapshot.title}</h3><ReadBlocks blocks={snapshot.blocks} onTask={onTask}/><button type="button" className="slack_primary" disabled={disabled || busy || !page.can_edit || snapshot.version===page.version} onClick={()=>onRestore(snapshot.version)}>Recuperar versión {snapshot.version}</button>{disabled && <small>Guarda o resuelve tu borrador antes de recuperar otra versión.</small>}</section>}
    </section></div>;
}

export default function ChannelPages({channel,onDirty,onDenied,onTask,targetPage,onShared}){
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[archived,setArchived]=useState(false),[canCreate,setCanCreate]=useState(false),[canTemplates,setCanTemplates]=useState(false),[templates,setTemplates]=useState(null);
    const [session,setSession]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
    const [history,setHistory]=useState(false),[taskPicker,setTaskPicker]=useState(false),[preview,setPreview]=useState(false),[remotePreview,setRemotePreview]=useState(false),[recovery,setRecovery]=useState(null),[labels,setLabels]=useState({});
    const active=useRef(false),editor=useRef(null),current=useRef(null),callbacks=useRef({}),reads=useRef(null),writes=useRef(null),refresh=useRef(null),actionRetry=useRef(null),createRetry=useRef(null),shareRetry=useRef(null),acting=useRef(false),archiveFilter=useRef(archived);
    const previousFilter=useRef(archived);
    callbacks.current={onDirty,onDenied,onTask,onShared};archiveFilter.current=archived;current.current=session;
    function denied(err){editor.current?.dispose();editor.current=null;setSession(null);setRows([]);setHistory(false);setTaskPicker(false);setTemplates(null);setRecovery(null);setLabels({});callbacks.current.onDirty(false);callbacks.current.onDenied(err);}
    function report(err){if([401,403,404].includes(err.status))denied(err);else setError(pageError(err));}
    function install(page){
        editor.current?.dispose();setPreview(false);setHistory(false);setRecovery(null);setLabels({});actionRetry.current=null;shareRetry.current=null;
        const options={page,onDenied:denied,onChange:(value,{remote=false}={})=>{if(active.current){current.current=value;if(remote)flushSync(()=>setSession(value));else setSession(value);callbacks.current.onDirty(value.dirty || value.status==="conflict" || !!value.recoveredBlocks?.length);}}};
        editor.current=page.collaboration_enabled ? createCollaborativePage({...options,connect:signal=>connectPage(channel.id,page.id,signal),onBeforeRemote:()=>{
            const field=document.activeElement,identity=field?.dataset?.pageField;
            if(!identity || editor.current?.isComposing?.(identity))return ()=>{};
            const bookmark=editor.current?.bookmark?.(identity,field.selectionStart,field.selectionEnd);
            return ()=>{const position=editor.current?.resolveRange?.(bookmark);if(position && field.isConnected)field.setSelectionRange(position.start,position.end);};
        }}):createPageEditor({...options,save:(value,signal)=>pageApi.save(channel.id,page.id,value,signal)});
    }
    async function mayLeave(){return !current.current?.dirty && current.current?.status!=="conflict" && !current.current?.recoveredBlocks?.length || await confirmBold("¿Salir de la página y descartar el borrador sin guardar?");}
    async function list(signal,cursor=null){
        const filter=archiveFilter.current,result=await pageApi.list(channel.id,filter,cursor,{signal});
        if(!active.current || signal.aborted || filter!==archiveFilter.current)return;
        setRows(old=>cursor ? [...new Map([...old,...result.results].map(row=>[row.id,row])).values()]:result.results);setNext(result.next);setCanCreate(result.can_create);setCanTemplates(result.can_templates===true);setLoading(false);
    }
    async function open(identity){
        if(acting.current || !await mayLeave())return;
        reads.current?.abort();const c=new AbortController();reads.current=c;setLoading(true);setError("");
        try{const page=await pageApi.get(channel.id,identity,{signal:c.signal});if(active.current && !c.signal.aborted)install(page);}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{if(active.current && !c.signal.aborted)setLoading(false);}
    }
    useEffect(()=>{
        active.current=true;
        refresh.current=createChannelRefresh(async signal=>{
            await list(signal);
            const identity=current.current?.base.id;
            if(identity){const page=await pageApi.get(channel.id,identity,{signal});if(active.current && !signal.aborted && current.current?.base.id===identity)editor.current?.remote(page);}
        },report);
        refresh.current.request();
        const hint=event=>{const payload=event.detail?.payload;if(!payload || payload.channel_id===channel.id && (payload.kind?.startsWith("page.") || payload.kind?.startsWith("channel.")))refresh.current?.request();};
        const leave=event=>{if(current.current?.dirty || current.current?.status==="conflict" || current.current?.recoveredBlocks?.length){event.preventDefault();event.returnValue="";}};
        window.addEventListener("bold:slack-event",hint);window.addEventListener("bold:messaging-reconnect",hint);window.addEventListener("beforeunload",leave);
        return()=>{active.current=false;editor.current?.dispose();reads.current?.abort();writes.current?.abort();refresh.current?.dispose();callbacks.current.onDirty(false);window.removeEventListener("bold:slack-event",hint);window.removeEventListener("bold:messaging-reconnect",hint);window.removeEventListener("beforeunload",leave);};
    },[channel.id]);
    useEffect(()=>{if(previousFilter.current!==archived){previousFilter.current=archived;refresh.current?.request();}},[archived]);
    useEffect(()=>{if(targetPage?.id)open(targetPage.id);},[targetPage?.requestId]);
    async function create(){
        if(acting.current || !await mayLeave())return;
        acting.current=true;setBusy(true);setError("");createRetry.current ||= {client_id:crypto.randomUUID(),title:"Página sin título",icon:"note",blocks:[{id:crypto.randomUUID(),type:"paragraph",text:""}]};
        const c=new AbortController();writes.current=c;
        try{const page=await pageApi.create(channel.id,createRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){createRetry.current=null;install(page);refresh.current.request();}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{acting.current=false;if(active.current)setBusy(false);}
    }
    function edit(value){editor.current?.edit(value);setNotice("");}
    function blockChange(identity,patch){edit({...current.current.draft,blocks:current.current.draft.blocks.map(row=>row.id===identity ? {...row,...patch}:row)});}
    function add(kind){if(kind==="task"){setTaskPicker(true);return;}edit({...session.draft,blocks:[...session.draft.blocks,{id:crypto.randomUUID(),type:kind,text:"",...(kind==="heading" ? {level:2}:{}),...(kind==="check" ? {checked:false}:{})}]});}
    function move(index,offset){const blocks=[...session.draft.blocks];[blocks[index],blocks[index+offset]]=[blocks[index+offset],blocks[index]];edit({...session.draft,blocks});}
    async function action(values){
        if(acting.current || current.current?.dirty || current.current?.status==="conflict")return;
        if(!await confirmBold("restore_version" in values ? "¿Recuperar esta versión como una nueva revisión?":"archived" in values && values.archived ? "¿Archivar esta página? Su historial se conservará.":"¿Restaurar la página archivada?"))return;
        if(current.current?.dirty || current.current?.status==="conflict")return;
        acting.current=true;setBusy(true);setError("");
        actionRetry.current ||= {...values,version:session.base.version,client_id:crypto.randomUUID()};
        const c=new AbortController();writes.current=c;
        try{const page=await pageApi.action(channel.id,session.base.id,actionRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){actionRetry.current=null;install(page);refresh.current.request();}}
        catch(err){if(active.current && !c.signal.aborted){if(err.status===409 && err.fields?.current){actionRetry.current=null;editor.current.remote(err.fields.current);}report(err);}}
        finally{acting.current=false;if(active.current)setBusy(false);}
    }
    async function share(){
        if(acting.current || session?.dirty)return;
        acting.current=true;setBusy(true);setError("");shareRetry.current ||= {client_id:crypto.randomUUID(),body:"",page_id:session.base.id};
        const c=new AbortController();writes.current=c;
        try{const result=await channelApi.send(channel.id,shareRetry.current,{signal:c.signal});if(active.current && !c.signal.aborted){shareRetry.current=null;callbacks.current.onShared(result.message);setNotice("Enlace publicado en el canal. No concede acceso a terceros.");}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{acting.current=false;if(active.current)setBusy(false);}
    }
    async function copyLink(){try{const url=new URL(location.href);url.search="";url.hash="";url.searchParams.set("slack_channel",channel.id);url.searchParams.set("slack_page",session.base.id);await navigator.clipboard.writeText(url.href);if(active.current)setNotice("Enlace copiado. Solo funciona para personas autorizadas en este canal.");}catch{setError("No se pudo copiar. Puedes compartir la página en el canal.");}}
    const page=session?.base,draft=session?.draft,conflict=session?.conflict;
    const editable=!!page?.can_edit && !preview && !busy;
    const displayBlocks=draft?.blocks.map(row=>row.type==="task" ? {...row,task:page.blocks.find(old=>old.id===row.id)?.task || labels[row.task_id] || {available:false}}:row) || [];
    const status={saved:"Guardado",saving:"Guardando…",connecting:"Conectando colaboración…",unsaved:"Cambios sin guardar",error:"Guardado sin confirmar",conflict:"Conflicto de versiones"}[session?.status];
    return <section className={`slack_pages ${page ? "slack_page_open":""}`} aria-label="Páginas del canal">
        <aside className="slack_page_list" inert={history || taskPicker || templates ? true:undefined}><header><div><h3>Páginas</h3><small>Contexto para el equipo</small></div><button type="button" aria-label="Crear página" disabled={!canCreate || busy} onClick={create}><Plus size={20}/></button></header>
            {canTemplates && <button type="button" disabled={busy} onClick={()=>setTemplates({capture:false})}><LayoutTemplate size={18} aria-hidden="true"/>Plantillas</button>}<label className="slack_archive_filter"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Incluir archivadas</label>
            <nav aria-label="Páginas disponibles">{rows.map(row=><button type="button" key={row.id} aria-current={page?.id===row.id ? "page":undefined} disabled={busy} onClick={()=>open(row.id)}><PageIcon value={row.icon}/><span><strong>{row.title}</strong><small>{row.archived_at ? "Archivada":`Versión ${row.version}`}</small></span></button>)}</nav>
            {loading && <p role="status">Cargando páginas…</p>}{!loading && !rows.length && <p>No hay páginas todavía. Crea una para reunir acuerdos, notas o listas del equipo.</p>}
            {next && <button type="button" disabled={loading || busy} onClick={()=>{reads.current?.abort();reads.current=new AbortController();list(reads.current.signal,next).catch(report);}}>Más páginas</button>}
        </aside>
        <div className="slack_page_workspace" inert={history || taskPicker || templates ? true:undefined}>
            {error && <p role="alert" className="slack_error">{error}</p>}{notice && <p role="status" className="slack_notice">{notice}</p>}
            {!page && <div className="slack_page_empty"><FileText size={40} aria-hidden="true"/><h3>Del acuerdo al documento</h3><p>Elige una página o crea una nota. El acceso siempre depende de este canal.</p>{canCreate && <button type="button" className="slack_primary" disabled={busy} onClick={create}>Crear primera página</button>}</div>}
            {page && <>
                <header className="slack_page_toolbar"><button type="button" className="slack_page_back" aria-label="Ver páginas" disabled={busy} onClick={async()=>{if(await mayLeave()){editor.current?.dispose();setSession(null);current.current=null;callbacks.current.onDirty(false);}}}><ArrowLeft size={20}/></button><span role="status" aria-live="polite" className={`slack_page_save is_${session.status}`}>{status}</span><div><button type="button" aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview ? "Editar":"Vista previa"}</button><button type="button" aria-label="Ver historial" onClick={()=>setHistory(true)}><Clock size={18}/></button><button type="button" aria-label="Copiar enlace de la página" onClick={copyLink}><Link size={18}/></button>{(page.can_create_template || page.can_update_templates) && <button type="button" aria-label="Guardar página como plantilla" disabled={busy || session.dirty || !!conflict} onClick={()=>setTemplates({capture:true})}><LayoutTemplate size={18} aria-hidden="true"/></button>}{page.can_manage && <button type="button" aria-label={page.archived_at ? "Restaurar página":"Archivar página"} disabled={busy || session.dirty || !!conflict} onClick={()=>action({archived:!page.archived_at})}><Archive size={18}/></button>}<button type="button" className="slack_primary" disabled={busy || session.dirty || !!conflict || !channel.can_send} onClick={share}><Send size={17}/>Compartir</button></div></header>
                {(page.archived_at || !page.can_edit && session.status!=="connecting") && <p className="slack_notice">{page.archived_at ? "Página archivada. Su historial sigue disponible.":"Tienes acceso de solo lectura a esta página."}</p>}
                {session.collaborative && <div className="slack_collab_presence" role="status" aria-live="polite" aria-atomic="true"><span>{session.status==="connecting" ? "Abriendo colaboración segura…":session.status==="error" ? "Sincronización pendiente · borrador conservado":"Coedición activa"}</span><ul aria-label="Personas en esta página">{[...new Map((session.peers || []).map(peer=>[peer.person.employee_id,peer])).values()].map(peer=><li key={peer.person.employee_id} style={{"--peer-color":peerColor(peer.person.employee_id)}}>{peer.person.name}</li>)}</ul></div>}
                {session.status==="error" && <div role="alert" className="slack_page_problem"><p>{pageError(session.error)}</p><button type="button" disabled={busy} onClick={()=>editor.current.flush()}>Reintentar guardado</button></div>}
                {conflict && <section className="slack_page_problem" aria-label="Resolver conflicto"><strong>Hay una versión más reciente: {conflict.version}</strong><p>Tu borrador permanece intacto. Revisa la versión guardada antes de decidir.</p><div><button type="button" onClick={()=>setRemotePreview(!remotePreview)}>Ver versión guardada</button><button type="button" disabled={session.status==="saving" || !conflict.can_edit} onClick={()=>{editor.current.resolve(true);setRemotePreview(false);}}>Guardar mi borrador como nueva versión</button><button type="button" onClick={()=>{const own=editor.current.resolve(false);setRecovery(own);setRemotePreview(false);}}>Usar versión del servidor</button></div>{remotePreview && <div className="slack_page_snapshot"><h3>{conflict.title}</h3><ReadBlocks blocks={conflict.blocks} onTask={onTask}/></div>}</section>}
                {recovery && <p className="slack_notice">Conservamos tu borrador anterior en esta página. <button type="button" disabled={!page.can_edit || busy} onClick={()=>{edit(recovery);setRecovery(null);}}>Recuperar mi borrador</button></p>}
                {!!session.recoveredBlocks?.length && <section className="slack_page_problem" aria-label="Texto recuperable"><strong>Un bloque que estabas editando se eliminó en otra sesión.</strong><p>Conservamos tu texto para que no se pierda al combinar los cambios.</p><details><summary>Ver texto conservado</summary><pre>{session.recoveredBlocks.map(row=>row.text).join("\n\n")}</pre></details><div><button type="button" disabled={!page.can_edit} onClick={()=>editor.current.recoverBlocks()}>Recuperar como bloques nuevos</button><button type="button" onClick={async()=>{if(await confirmBold("¿Descartar la copia conservada de los bloques eliminados?"))editor.current.dismissRecovery();}}>Descartar copia</button></div></section>}
                <article className="slack_page_document">
                    <div className="slack_page_title"><label>Icono<select aria-label="Icono de la página" value={draft.icon} disabled={!editable} onChange={e=>edit({...draft,icon:e.target.value})}><option value="note">Nota</option><option value="book">Libro</option><option value="checklist">Lista</option><option value="idea">Idea</option></select></label><PageIcon value={draft.icon}/><label className="slack_page_title_field">Título de la página<CollaborativeField as="input" field="title" peers={session.peers} editorRef={editor} value={draft.title} maxLength={160} disabled={!editable} onChange={e=>edit({...draft,title:e.target.value})}/></label></div>
                    <small className="slack_page_byline">Versión {page.version} · {stamp(page.updated_at)} · {page.updated_by}</small>
                    {preview || !page.can_edit ? <ReadBlocks blocks={displayBlocks} onTask={onTask}/>:<ol className="slack_page_blocks" aria-label="Bloques de la página">{displayBlocks.map((row,index)=><li key={row.id} className={`slack_page_block is_${row.type}`}><div className="slack_page_block_content">{row.type==="task" ? <ReadBlocks blocks={[row]} onTask={onTask}/>:<>{row.type==="check" && <input type="checkbox" aria-label={`Completar bloque ${index+1}`} checked={!!row.checked} disabled={!editable} onChange={e=>blockChange(row.id,{checked:e.target.checked})}/>}<label><span>{kinds[row.type]} {index+1}</span><CollaborativeField field={row.id} peers={session.peers} editorRef={editor} aria-label={`${kinds[row.type]} ${index+1}`} rows={row.type==="heading" ? 1:2} maxLength={4000} value={row.text} disabled={!editable} onChange={e=>blockChange(row.id,{text:e.target.value})}/></label></>}</div><div className="slack_page_block_tools"><button type="button" aria-label={`Subir bloque ${index+1}`} disabled={!editable || !index} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button type="button" aria-label={`Bajar bloque ${index+1}`} disabled={!editable || index===draft.blocks.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button type="button" aria-label={`Quitar bloque ${index+1}`} disabled={!editable} onClick={()=>edit({...draft,blocks:draft.blocks.filter(b=>b.id!==row.id)})}><Trash2 size={16}/></button></div></li>)}</ol>}
                    {page.can_edit && !preview && <div className="slack_page_add" role="group" aria-label="Añadir bloque">{Object.entries(kinds).map(([kind,label])=><button type="button" key={kind} disabled={!editable || draft.blocks.length>=200} onClick={()=>add(kind)}><Plus size={16}/>{label}</button>)}</div>}
                </article>
            </>}
        </div>
        {history && page && <History channelId={channel.id} page={page} onClose={()=>setHistory(false)} onRestore={version=>action({restore_version:version})} onDenied={denied} disabled={busy || session.dirty || !!conflict} onTask={onTask}/>}
        {templates && <Suspense fallback={<div className="slack_editor_scrim" role="status">Abriendo plantillas…</div>}><PageTemplates channel={{...channel,can_create_page:canCreate}} page={page} capture={templates.capture} onClose={()=>setTemplates(null)} onDenied={denied} onTask={onTask} onCreated={result=>{setTemplates(null);install(result);refresh.current?.request();}}/></Suspense>}
        {taskPicker && <ChannelTaskPicker channelId={channel.id} purpose="page" onClose={()=>setTaskPicker(false)} onSelect={task=>{setLabels(old=>({...old,[task.id]:{...task,available:true}}));edit({...current.current.draft,blocks:[...current.current.draft.blocks,{id:crypto.randomUUID(),type:"task",task_id:task.id}]});setTaskPicker(false);}}/>}
    </section>;
}
