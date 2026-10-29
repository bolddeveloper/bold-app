import {useEffect,useRef,useState} from "react";
import {ArrowLeft,Search,X} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {useDialog} from "../core/shared/use_dialog.js";
import {historyApi,historyDates,historyError} from "./history_api.js";
import {channelApi,createChannelRefresh} from "./channel_api.js";
import MessageReactions from './message_reactions.jsx';
import MessageTasks from './message_tasks.jsx';
import {MessageMedia} from "./message_media.jsx";
import SaveResource from "./save_resource.jsx";
import ReadingReminder from './reading_reminder.jsx';
import {readingScope} from '../core/reading_attention.js';
import MentionText from "./mention_text.jsx";
import {ReadBlocks} from './page_blocks.jsx';
import "./history_search.css";

const kinds={text:"Mensaje",image:"Imagen",audio:"Nota de voz",document:'Documento',page:"Página"};
const emptyView=identity=>({identity,rows:[],next:null,searched:false,context:null,target:null,trail:[null],page:0});
const time=value=>new Date(value).toLocaleString("es",{dateStyle:"medium",timeStyle:"short"});
function Text({value,mentions}){return <p className="history_search_text"><MentionText text={value || ""} mentions={mentions}/></p>;}

export default function HistorySearch({onClose,initialScope="all",initialChannel=null,initialConversation=null,onOpenPage,onOpenThread,initialSaved=false,initialThreads=false,initialUnread=false,initialTarget=null}){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    const allowed=core.activeAssignment?.chat_enabled===true && !core.securityUncertain;
    const [filters,setFilters]=useState({q:"",scope:initialScope,kind:"all",author:"",channel:initialChannel?.id || "",conversation:initialConversation || "",from:"",to:"",archived:initialSaved || initialThreads || initialUnread,saved:initialSaved,threads:initialThreads,marked_unread:initialUnread});
    const [view,setView]=useState(()=>emptyView(identity)),[busy,setBusy]=useState(false),[error,setError]=useState("");
    const [channels,setChannels]=useState(initialChannel ? [initialChannel]:[]),[channelNext,setChannelNext]=useState(null),[channelBusy,setChannelBusy]=useState(false),[channelError,setChannelError]=useState("");
    const active=useRef(false),current=useRef(identity),request=useRef(null),channelRequest=useRef(null),callbacks=useRef({});
    current.current=identity;callbacks.current={onClose,onOpenPage,onOpenThread};
    const visible=view.identity===identity ? view:emptyView(identity);
    useDialog(true,".history_search_dialog",()=>{if(visible.context){setView(value=>({...value,context:null,target:null}));setError("");}else callbacks.current.onClose();});
    useEffect(()=>{
        active.current=true;
        const revoke=()=>{request.current?.abort();channelRequest.current?.abort();setView(emptyView(current.current));callbacks.current.onClose();};
        window.addEventListener("bold:permissions-invalidated",revoke);
        return()=>{active.current=false;request.current?.abort();channelRequest.current?.abort();window.removeEventListener("bold:permissions-invalidated",revoke);};
    },[]);
    useEffect(()=>{if(!allowed || view.identity!==identity){request.current?.abort();channelRequest.current?.abort();setView(emptyView(identity));callbacks.current.onClose();}},[allowed,identity]);
    function change(key,value){
        request.current?.abort();setBusy(false);setError("");setView(emptyView(identity));
        setFilters(old=>({...old,[key]:value,...(key==="scope" ? {channel:"",conversation:"",...(value==="chat" ? {threads:false}:{})}: {}),...(["threads","marked_unread"].includes(key) && value && old.kind==="page" ? {kind:"all"}:{})}));
    }
    async function loadChannels(next=null){
        channelRequest.current?.abort();const controller=new AbortController();channelRequest.current=controller;
        const context=identity;setChannelBusy(true);setChannelError("");
        try{const data=await channelApi.list(filters.archived,next,{signal:controller.signal});
            if(active.current && !controller.signal.aborted && current.current===context){setChannels(old=>[...new Map([...(next ? old:initialChannel ? [initialChannel]:[]),...data.results].map(row=>[row.id,row])).values()]);setChannelNext(data.next);}
        }catch(err){if(active.current && !controller.signal.aborted)setChannelError(historyError(err));}
        finally{if(active.current && !controller.signal.aborted)setChannelBusy(false);}
    }
    useEffect(()=>{if(allowed && filters.scope!=="chat")loadChannels();return()=>channelRequest.current?.abort();},[filters.scope,filters.archived]);
    async function search(cursor=null,index=0){
        request.current?.abort();const controller=new AbortController();request.current=controller;
        const context=identity;setBusy(true);setError("");
        try{
            const {from,to,...base}=filters,values={...base,...historyDates(from,to)};
            const result=await historyApi.search(values,cursor,{signal:controller.signal});
            if(active.current && !controller.signal.aborted && current.current===context)setView(old=>({identity:context,rows:result.results,next:result.next_cursor,searched:true,context:null,target:null,
                trail:index===0 ? [result.first_cursor || null]:[...old.trail.slice(0,index),cursor],page:index}));
        }catch(err){if(active.current && !controller.signal.aborted){if([401,403,404].includes(err.status))setView(emptyView(context));setError(err.status ? historyError(err):err.message);}}
        finally{if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    async function open(row){
        request.current?.abort();const controller=new AbortController();request.current=controller;
        const context=identity;setBusy(true);setError("");
        try{const result=await historyApi.context(row.target,{signal:controller.signal});
            if(active.current && !controller.signal.aborted && current.current===context)setView(old=>({...old,context:result,target:row.target}));
        }catch(err){if(active.current && !controller.signal.aborted){setView(old=>({...old,rows:[],next:null,context:null,target:null}));setError(historyError(err));}}
        finally{if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    useEffect(()=>{if(allowed){if(initialTarget)open({target:initialTarget});else if(initialSaved || initialThreads || initialUnread)search();}},[]);
    useEffect(()=>{
        const target=visible.target;
        if(!allowed || target?.kind!=='channel' || !visible.context)return;
        const context=identity;
        const refresh=createChannelRefresh(async signal=>{
            const result=await historyApi.context(target,{signal});
            if(active.current && !signal.aborted && current.current===context)setView(old=>({...old,context:result}));
        },err=>{if(active.current){setView(old=>({...old,context:null,target:null}));setError(historyError(err));}});
        const receive=event=>{if(event.detail?.payload?.channel_id===target.channel_id && event.detail?.payload?.kind==='reactions.updated')refresh.request();};
        window.addEventListener('bold:slack-event',receive);
        return()=>{refresh.dispose();window.removeEventListener('bold:slack-event',receive);};
    },[allowed,identity,visible.target]);
    async function navigate(callback,target){
        const controller=new AbortController();request.current?.abort();request.current=controller;
        const context=identity;setBusy(true);setError("");
        try{const result=await callback(target,{signal:controller.signal});
            if(active.current && !controller.signal.aborted && current.current===context && result!==false)callbacks.current.onClose();
        }catch(err){if(active.current && !controller.signal.aborted && current.current===context){if([401,403,404].includes(err.status))setView(emptyView(context));setError(historyError(err));}}
        finally{if(active.current && !controller.signal.aborted && current.current===context)setBusy(false);}
    }
    useEffect(()=>{
        if(!visible.context)return;
        const id=visible.target.kind==="page" ? visible.target.block_id:visible.context.anchor_id;
        const element=[...document.querySelectorAll("[data-history-anchor]")].find(node=>node.dataset.historyAnchor===id);
        element?.focus({preventScroll:true});element?.scrollIntoView?.({block:"center",behavior:"instant"});
    },[visible.context?.anchor_id,visible.context?.id,visible.target?.block_id]);
    const people=[...new Map([...(core.presence?.rows || []),...(core.directory || []).map(row=>({employee_id:row.personId || row.employee,name:row.name || row.employee_name})),
        ...visible.rows.map(row=>row.author)].filter(row=>row.employee_id).map(row=>[row.employee_id,row])).values()].sort((a,b)=>(a.name || "").localeCompare(b.name || "","es"));
    if(!allowed || view.identity!==identity)return null;
    const context=visible.context,target=visible.target;
    return <div className="history_search_scrim"><section className="history_search_dialog" role="dialog" aria-modal="true" aria-labelledby="history_search_title" aria-busy={busy}>
        <header><div className="history_search_heading">{context && <button type="button" aria-label="Volver a los resultados" onClick={()=>{setView(old=>({...old,context:null,target:null}));setError("");}}><ArrowLeft size={18} aria-hidden="true"/></button>}<h2 id="history_search_title">{context ? "Contexto del resultado":filters.marked_unread ? 'Marcados como no leídos':filters.threads ? "Hilos que sigo":filters.saved ? "Mis guardados":"Buscar en el historial"}</h2></div><button type="button" aria-label="Cerrar búsqueda del historial" onClick={onClose}><X size={20} aria-hidden="true"/></button>
            {target?.kind==="page" && onOpenPage && <button className="history_search_page_open" type="button" disabled={busy} onClick={()=>navigate(callbacks.current.onOpenPage,target)}>Abrir página en Slack</button>}
            {target?.kind==="channel" && onOpenThread && <button className="history_search_page_open" type="button" disabled={busy} onClick={()=>navigate(callbacks.current.onOpenThread,{channel_id:target.channel_id,parent_id:target.parent_id || context.anchor_id})}>Abrir hilo en Slack</button>}
        </header>
        {context ? <div className="history_search_content">
            <p>Vista de consulta: abrir este contexto no marca mensajes como leídos.</p>
            {target.kind==="page" ? <><h3>{context.title}</h3>{target.block_id && !context.blocks.some(block=>block.id===target.block_id) && <p role="status">El bloque encontrado cambió o se eliminó. Se muestra la página actual.</p>}<ol className="history_search_context" aria-label="Contexto de la página">{context.blocks.map(block=><li key={block.id}><article tabIndex={-1} data-history-anchor={block.id} className={block.id===target.block_id ? "history_search_anchor":""}>
                {block.id===target.block_id && <strong>Bloque encontrado</strong>}{block.type==="task" ? <p>{block.task?.available ? block.task.title:"Tarea no disponible"}</p>:block.type==='page' ? <ReadBlocks blocks={[block]} onPage={onOpenPage ? value=>navigate(callbacks.current.onOpenPage,value):undefined}/>:<Text value={block.text} mentions={context.mentions}/>}</article></li>)}</ol>
                </>:
                <><p>{context.has_before || context.has_after ? "Se muestran hasta 15 mensajes anteriores y 15 posteriores dentro de esta conversación o hilo.":"Mensajes cercanos al resultado."}</p><ol className="history_search_context" aria-label="Contexto del mensaje">{context.results.map(message=>{
                    const author=message.author || [context.conversation?.me,context.conversation?.peer].find(person=>person?.employee_id===message.author_id);
                    return <li key={message.id}><article tabIndex={-1} data-history-anchor={message.id} className={message.id===context.anchor_id ? "history_search_anchor":""} aria-label={message.id===context.anchor_id ? "Mensaje encontrado":undefined}>
                        <header><strong>{author?.name || "Empleado"}</strong><time dateTime={message.created_at}>{time(message.created_at)}</time>{message.id===context.anchor_id && <span>Encontrado</span>}</header>
                        <ReadingReminder kind={target.kind} sourceId={message.id} scopeKey={readingScope(target.kind==='chat' ? target:{...target,parent_id:message.parent_id})} disabled={busy}/>
                        <MessageReactions kind={target.kind} containerId={target.kind==='chat' ? target.conversation_id:target.channel_id} message={message} disabled={busy}/>
                        <MessageTasks kind={target.kind} containerId={target.kind==='chat' ? target.conversation_id:target.channel_id} message={message} disabled={busy}/>
                        {message.body && <Text value={message.body} mentions={message.mentions}/>} {message.task && <p>Referencia a tarea: {message.task.available ? message.task.title:"no disponible para tu asignación activa"}</p>}{message.page && <p>Referencia a página: {message.page.available ? message.page.title:"no disponible para tu asignación activa"}</p>} {message.media && <MessageMedia message={message} author={author} fetchMedia={target.kind==="chat" ? undefined:channelApi.media}/>}</article></li>;
                })}</ol></>}
        </div>:<>
            <form onSubmit={event=>{event.preventDefault();search();}}>
                <label>Palabras<input type="search" autoComplete="off" maxLength={160} value={filters.q} onChange={event=>change("q",event.target.value)} aria-describedby="history_search_help"/></label>
                <p id="history_search_help">Busca palabras completas, sin distinguir tildes. Se incluyen mensajes antiguos, páginas y metadatos de adjuntos; no el contenido de imágenes o audios.</p>
                <div className="history_search_filters">
                    <label>Ámbito<select value={filters.scope} onChange={event=>change("scope",event.target.value)}><option value="all">Chat y Slack</option><option value="chat">Chat privado</option><option value="slack">Slack</option></select></label>
                    <label>Tipo<select value={filters.kind} onChange={event=>change("kind",event.target.value)}><option value="all">Todos</option><option value="text">Mensajes de texto</option><option value="image">Imágenes</option><option value="audio">Notas de voz</option><option value="document">Documentos</option><option value="file">Todos los adjuntos</option>{!filters.threads && !filters.marked_unread && <option value="page">Páginas</option>}</select></label>
                    <label>Autor (creador en páginas)<select value={filters.author} onChange={event=>change("author",event.target.value)}><option value="">Cualquier persona</option>{people.map(person=><option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label>
                    {filters.scope!=="chat" && <label>Canal<select value={filters.channel} onChange={event=>change("channel",event.target.value)}><option value="">Todos los canales accesibles</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
                    <label>Desde<input type="date" value={filters.from} onChange={event=>change("from",event.target.value)}/></label><label>Hasta (incluido)<input type="date" value={filters.to} onChange={event=>change("to",event.target.value)}/></label>
                </div>
                {initialConversation && filters.scope!=="slack" && <label className="history_search_check"><input type="checkbox" checked={!!filters.conversation} onChange={event=>change("conversation",event.target.checked ? initialConversation:"")}/>Solo esta conversación</label>}
                {filters.scope!=="chat" && <label className="history_search_check"><input type="checkbox" checked={filters.archived} onChange={event=>change("archived",event.target.checked)}/>Incluir canales y páginas archivados</label>}
                <label className="history_search_check"><input type="checkbox" checked={filters.saved} onChange={event=>change("saved",event.target.checked)}/>Solo mis guardados</label>
                <label className="history_search_check"><input type="checkbox" checked={filters.marked_unread} onChange={event=>change('marked_unread',event.target.checked)}/>Solo marcados como no leídos</label>
                {filters.marked_unread && <p>Marcas personales que conservas hasta quitarlas expresamente, también entre dispositivos. Consultarlas no cambia los recibos ni retira la marca. Se guarda un punto de retorno por chat, canal e hilo.</p>}
                {filters.scope!=="chat" && <label className="history_search_check"><input type="checkbox" checked={filters.threads} onChange={event=>change("threads",event.target.checked)}/>Solo hilos que sigo</label>}
                {filters.threads && <p>Se muestran los mensajes iniciales de tus hilos seguidos. La búsqueda, las fechas y el orden corresponden a ese mensaje inicial. Seguir no marca respuestas como leídas.</p>}
                {filters.saved && <p>Referencias privadas de tu empleado, disponibles entre dispositivos. Guardar no concede acceso: solo aparecen las que puedes leer con tu asignación actual.</p>}
                {channelBusy && <p>Cargando opciones de canal…</p>}{channelError && <p role="alert">{channelError}<button type="button" onClick={()=>loadChannels()}>Reintentar canales</button></p>}
                {channelNext && <button type="button" disabled={channelBusy} onClick={()=>loadChannels(channelNext)}>Cargar más opciones de canal</button>}
                <button type="submit" disabled={busy}><Search size={18} aria-hidden="true"/>{busy ? "Buscando…":"Buscar historial"}</button>
            </form>
            <div className="history_search_content" aria-label="Resultados del historial">
                <p role="status">{busy ? "Consultando el historial autorizado…":visible.searched ? visible.rows.length ? `Página ${visible.page+1} · ${visible.rows.length} ${visible.rows.length===1 ? "resultado mostrado":"resultados mostrados"}, del más reciente al más antiguo.`:filters.saved ? "No hay guardados accesibles con estos filtros. Guarda un mensaje o página para encontrarlo aquí, o revisa los filtros.":"No hay coincidencias. Prueba menos palabras, otro intervalo o elimina algún filtro.":"Escribe palabras o utiliza los filtros para consultar el historial."}</p>
                <ol className="history_search_results">{visible.rows.map(row=><li key={row.id}><button type="button" disabled={busy} onClick={()=>open(row)}><span><strong>{row.title}</strong><small>{kinds[row.kind]} · {row.channel ? `# ${row.channel.name}`:row.conversation?.peer ? `Chat con ${row.conversation.peer.name}`:"Chat privado"} · {row.author.name} · {time(row.created_at)}</small><span className="history_search_excerpt">{row.snippet}</span></span></button>{filters.threads && onOpenThread && <button type="button" disabled={busy} onClick={()=>navigate(callbacks.current.onOpenThread,{channel_id:row.target.channel_id,parent_id:row.target.message_id})}>Abrir hilo en Slack</button>}<SaveResource kind={row.target.kind} sourceId={row.source_id} initialSaved={row.saved} documentId={row.id} disabled={busy} onChange={value=>setView(old=>({...old,rows:old.rows.flatMap(item=>item.id!==row.id ? [item]:filters.saved && !value.saved ? []:[{...item,saved:value.saved}])}))}/>{row.target.kind!=='page' && <ReadingReminder kind={row.target.kind} sourceId={row.source_id} scopeKey={readingScope(row.target)} disabled={busy} onChange={value=>{if(filters.marked_unread && !value.marked)setView(old=>({...old,rows:old.rows.filter(item=>item.id!==row.id)}));}}/>}</li>)}</ol>
                <nav aria-label="Páginas de resultados">{visible.page>0 && <button type="button" disabled={busy} onClick={()=>search(visible.trail[visible.page-1],visible.page-1)}>Resultados anteriores</button>}{visible.next && <button type="button" disabled={busy} onClick={()=>search(visible.next,visible.page+1)}>Siguientes resultados</button>}</nav>
            </div>
        </>}
        {error && <p className="history_search_error" role="alert">{error}</p>}
    </section></div>;
}
