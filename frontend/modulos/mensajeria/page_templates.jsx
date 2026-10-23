import {useEffect,useRef,useState} from "react";
import {Archive,FileText,Plus,Save,X} from "lucide-react";
import {useDialog} from "../core/shared/use_dialog.js";
import {confirmBold} from "../core/shared/bold_dialog.js";
import {templateApi} from "./page_template_api.js";
import {pageError} from "./page_api.js";
import {ReadBlocks} from "./page_blocks.jsx";

export default function PageTemplates({channel,page,capture=false,onClose,onCreated,onDenied,onTask}){
    const [rows,setRows]=useState([]),[builtins,setBuiltins]=useState([]),[next,setNext]=useState(null),[archived,setArchived]=useState(false),[selected,setSelected]=useState(null);
    const [canCapture,setCanCapture]=useState(false),[mode,setMode]=useState(capture ? "capture":"browse"),[target,setTarget]=useState("");
    const [name,setName]=useState(page?.title || ""),[description,setDescription]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
    const active=useRef(false),request=useRef(null),write=useRef(null),attempt=useRef(null),acting=useRef(false);
    useDialog(true,".slack_template_library",()=>{if(!acting.current)onClose();});
    function report(err){if([401,404].includes(err.status)){onDenied(err);return;}if(err.status===403){setRows([]);setBuiltins([]);setSelected(null);}setError(err.status===409 ? "La página o plantilla cambió. Actualiza el listado y revisa su versión antes de guardar.":pageError(err));}
    async function load(cursor=null){
        request.current?.abort();const c=new AbortController();request.current=c;setLoading(true);setError("");
        try{const result=await templateApi.list(channel.id,archived,cursor,{signal:c.signal});if(active.current && !c.signal.aborted){setRows(old=>cursor ? [...old,...result.results]:result.results);setBuiltins(result.builtins);setNext(result.next);setCanCapture(result.can_create);if(!cursor && !result.can_create)setTarget(old=>result.results.some(row=>row.id===old && row.can_update && !row.archived_at) ? old:result.results.find(row=>row.can_update && !row.archived_at)?.id || "");}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{if(active.current && !c.signal.aborted)setLoading(false);}
    }
    useEffect(()=>{active.current=true;load();return()=>{active.current=false;request.current?.abort();write.current?.abort();};},[archived]);
    async function choose(row){
        if(acting.current || attempt.current)return;
        request.current?.abort();const c=new AbortController();request.current=c;setLoading(true);setError("");
        try{const result=await templateApi.get(channel.id,row.id,{signal:c.signal});if(active.current && !c.signal.aborted){setSelected(result);setName(result.name);setDescription(result.description);}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{if(active.current && !c.signal.aborted)setLoading(false);}
    }
    async function perform(action){
        if(acting.current)return;
        if(action==="capture" && target && !await confirmBold("¿Reemplazar el contenido de esta plantilla con la versión guardada de la página?"))return;
        if(action==="capture" && target && !rows.some(row=>row.id===target && row.can_update && !row.archived_at)){setError("Selecciona una plantilla disponible para actualizar.");return;}
        acting.current=true;setBusy(true);setError("");setNotice("");
        const c=new AbortController();write.current=c;
        attempt.current ||= action==="use" ? {action,template:selected.id,token:crypto.randomUUID()}:{action,target,values:{client_id:crypto.randomUUID(),page_id:page.id,page_version:page.version,name,description,...(target ? {version:rows.find(row=>row.id===target).version}:{})}};
        const task=attempt.current;
        try{
            if(task.action==="use"){
                const result=await templateApi.instantiate(channel.id,task.template,task.token,{signal:c.signal});if(active.current && !c.signal.aborted){attempt.current=null;onCreated(result);}
            }else{
                const result=task.target ? await templateApi.replace(channel.id,task.target,task.values,{signal:c.signal}):await templateApi.capture(channel.id,task.values,{signal:c.signal});
                if(active.current && !c.signal.aborted){attempt.current=null;setMode("browse");setSelected(result);setNotice("Plantilla guardada para este canal. Las páginas creadas desde ella son copias independientes.");await load();}
            }
        }catch(err){if(active.current && !c.signal.aborted){if([400,403,404,409].includes(err.status))attempt.current=null;report(err);}}
        finally{acting.current=false;if(active.current)setBusy(false);}
    }
    async function manage(values){
        if(acting.current || attempt.current || !selected)return;
        if("archived" in values && !await confirmBold(values.archived ? "¿Archivar esta plantilla? Las páginas existentes no cambiarán.":"¿Restaurar esta plantilla?"))return;
        acting.current=true;setBusy(true);setError("");const c=new AbortController();write.current=c;
        try{const result=await templateApi.update(channel.id,selected.id,{...values,version:selected.version},{signal:c.signal});if(active.current && !c.signal.aborted){setSelected(result);setNotice("Plantilla actualizada.");await load();}}
        catch(err){if(active.current && !c.signal.aborted)report(err);}finally{acting.current=false;if(active.current)setBusy(false);}
    }
    return <div className="slack_editor_scrim"><section className="slack_editor slack_template_library" role="dialog" aria-modal="true" aria-labelledby="slack_template_title">
        <header><div><h2 id="slack_template_title">Plantillas del canal</h2><p>Un punto de partida, sin repetir el trabajo.</p></div><button type="button" aria-label="Cerrar plantillas" disabled={busy} onClick={onClose}><X size={20}/></button></header>
        <nav aria-label="Acciones de plantillas"><button type="button" aria-pressed={mode==="browse"} disabled={busy || !!attempt.current} onClick={()=>setMode("browse")}>Usar plantilla</button>{page && (canCapture || rows.some(row=>row.can_update)) && <button type="button" aria-pressed={mode==="capture"} disabled={busy || !!attempt.current} onClick={()=>{setMode("capture");setName(page.title);setDescription("");}}>Guardar esta página</button>}</nav>
        <p>Solo las personas con acceso al canal pueden consultar sus plantillas. Las referencias a tareas conservan sus propios permisos.</p>
        {error && <p role="alert" className="slack_error">{error}</p>}{notice && <p role="status" className="slack_notice">{notice}</p>}
        {mode==="capture" ? <form onSubmit={event=>{event.preventDefault();perform("capture");}}><fieldset disabled={busy || !!attempt.current}>
            <label>Destino de la plantilla<select value={target} onChange={event=>setTarget(event.target.value)}>{canCapture && <option value="">Crear una plantilla nueva</option>}{rows.filter(row=>row.can_update && !row.archived_at).map(row=><option key={row.id} value={row.id}>Reemplazar: {row.name}</option>)}</select></label>
            <label>Nombre<input value={name} maxLength={160} required onChange={event=>setName(event.target.value)}/></label><label>Descripción<textarea rows={3} value={description} maxLength={500} onChange={event=>setDescription(event.target.value)}/></label>
            <small>Se copiará la versión guardada {page.version} de «{page.title}». Editar la plantilla no modificará esa página.</small>
        </fieldset><button type="submit" className="slack_primary" disabled={busy || !name.trim() || !target && !canCapture}><Save size={18} aria-hidden="true"/>{busy ? "Guardando…":attempt.current ? "Reintentar":"Guardar plantilla"}</button></form>:<>
            <label className="slack_archive_filter"><input type="checkbox" checked={archived} disabled={busy || !!attempt.current} onChange={event=>setArchived(event.target.checked)}/>Incluir archivadas</label>
            <div className="slack_template_columns"><div><h3>Plantillas de BOLD</h3><ul>{builtins.map(row=><li key={row.id}><button type="button" disabled={busy || !!attempt.current} aria-pressed={selected?.id===row.id} onClick={()=>choose(row)}><FileText size={19} aria-hidden="true"/><span><strong>{row.name}</strong><small>{row.description}</small></span></button></li>)}</ul><h3>Compartidas en este canal</h3><ul>{rows.map(row=><li key={row.id}><button type="button" disabled={busy || !!attempt.current} aria-pressed={selected?.id===row.id} onClick={()=>choose(row)}><FileText size={19} aria-hidden="true"/><span><strong>{row.name}</strong><small>{row.archived_at ? "Archivada":row.description || `Versión ${row.version}`}</small></span></button></li>)}</ul>{!loading && !rows.length && <p>Todavía no hay plantillas del canal.</p>}{next && <button type="button" disabled={busy || loading} onClick={()=>load(next)}>Más plantillas</button>}</div>
            <div>{selected ? <><h3>{selected.name}</h3><p>{selected.description}</p><ReadBlocks blocks={selected.blocks} onTask={onTask}/>{selected.can_update && <form onSubmit={event=>{event.preventDefault();manage({name,description});}}><fieldset disabled={busy || !!attempt.current}><label>Nombre de la plantilla<input value={name} required maxLength={160} onChange={event=>setName(event.target.value)}/></label><label>Descripción de la plantilla<textarea value={description} maxLength={500} rows={2} onChange={event=>setDescription(event.target.value)}/></label></fieldset><button type="submit" disabled={busy || !!attempt.current || !name.trim()}>Guardar nombre y descripción</button></form>}<footer>{selected.can_manage && <button type="button" disabled={busy || !!attempt.current} onClick={()=>manage({archived:!selected.archived_at})}><Archive size={18} aria-hidden="true"/>{selected.archived_at ? "Restaurar":"Archivar"}</button>}<button type="button" className="slack_primary" disabled={busy || !!selected.archived_at || !channel.can_create_page} onClick={()=>perform("use")}><Plus size={18} aria-hidden="true"/>{busy ? "Creando…":attempt.current ? "Reintentar":"Crear página desde plantilla"}</button></footer></>:<p>Selecciona una plantilla para revisar su contenido antes de crear una página.</p>}</div></div>
        </>}{loading && <p role="status">Cargando plantillas…</p>}
    </section></div>;
}
