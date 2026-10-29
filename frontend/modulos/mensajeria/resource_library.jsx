import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,FolderOpen,RefreshCw,X} from 'lucide-react';
import {useCore} from '../core/core_provider.jsx';
import {useDialog} from '../core/shared/use_dialog.js';
import {historyError} from './history_api.js';
import {mediaDownloadName,resourceApi,resourceFilters,resourceHint,resourceHref} from './resource_api.js';
import {MessageMedia} from './message_media.jsx';
import './history_search.css';
import './resource_library.css';
import {DOCUMENT_DOWNLOAD_WARNING} from './document_files.js';

const date=value=>new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});
const empty=()=>({rows:[],next:null,trail:[null],page:0,ready:false,snapshot:null});
const initial={q:'',kind:'all',author:'',from:'',to:''};

function ResourceCard({row,kind,container,onContext}){
    const [preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const controller=useRef(null),objectUrl=useRef(null);
    useEffect(()=>()=>{controller.current?.abort();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);},[]);
    async function download(){
        if(controller.current)return;
        const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
        try{
            const filename=mediaDownloadName(row.media);
            const blob=await resourceApi.media(kind,container,row.source_id,{signal:abort.signal});
            if(abort.signal.aborted)return;
            if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);
            objectUrl.current=URL.createObjectURL(blob);
            const link=document.createElement('a');link.href=objectUrl.current;link.download=filename;
            document.body.appendChild(link);link.click();link.remove();
        }catch(err){if(!abort.signal.aborted)setError([401,403,404].includes(err.status) ? 'Ya no tienes acceso al archivo. Cierra la biblioteca y vuelve a abrirla.':'No se pudo descargar. Comprueba tu conexión y vuelve a intentarlo.');}
        finally{if(!abort.signal.aborted){controller.current=null;setBusy(false);}}
    }
    const message={id:row.source_id,conversation_id:kind==='chat' ? container:undefined,channel_id:kind==='channel' ? container:undefined,media:row.media,created_at:row.created_at};
    return <article className="resource_card">
        <header><strong>{row.author.name}</strong><time dateTime={row.created_at}>{date(row.created_at)}</time></header>
        {row.excerpt && <p className="resource_excerpt">{row.excerpt}</p>}
        {row.media && <div className="resource_file"><strong>{row.media.filename || ({audio:'Nota de voz',image:'Imagen',document:'Documento'}[row.media.kind])}</strong><small>{{audio:'Audio',image:'Imagen',document:'Documento'}[row.media.kind]} · {Math.ceil(row.media.size_bytes/1024)} KB</small><div className="resource_actions">{row.media.kind!=='document' && <button type="button" aria-expanded={preview} onClick={()=>setPreview(value=>!value)}>{preview ? 'Ocultar vista':row.media.kind==='audio' ? 'Escuchar nota':'Ver imagen'}</button>}<button type="button" disabled={busy} onClick={download}><Download size={16} aria-hidden="true"/>{busy ? 'Descargando…':'Descargar archivo'}</button></div>
            {preview && <MessageMedia key={row.media.id} message={message} author={row.author} fetchMedia={(_,messageId,options)=>resourceApi.media(kind,container,messageId,options)}/>}
            {row.media.kind==='document' && <small>{DOCUMENT_DOWNLOAD_WARNING}</small>}
        </div>}
        {row.links?.length>0 && <ul className="resource_links" aria-label="Enlaces del mensaje">{row.links.map(link=>{
            const href=resourceHref(link.href);return href ? <li key={href}><a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link.label}</a></li>:null;
        })}</ul>}
        <button type="button" onClick={()=>onContext(row.target)}>Ver mensaje en contexto{row.target.parent_id ? ' · hilo':''}</button>
        {error && <p role="alert">{error}</p>}
    </article>;
}

export default function ResourceLibrary({kind,container,title,parent=null,onClose,onContext}){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}:${kind}:${container}:${parent || ''}`;
    const allowed=core.activeAssignment?.chat_enabled===true && !core.securityUncertain;
    const origin=useRef(identity),current=useRef(identity),request=useRef(null),alive=useRef(false),callbacks=useRef({});
    current.current=identity;callbacks.current={onClose,onContext};
    const [filters,setFilters]=useState(initial),[view,setView]=useState(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[changed,setChanged]=useState(false);
    const [authors,setAuthors]=useState([]);
    useDialog(true,'.resource_library',()=>callbacks.current.onClose());
    useEffect(()=>{
        alive.current=true;
        const revoke=()=>{request.current?.abort();setView(empty());setAuthors([]);callbacks.current.onClose();};
        const hint=event=>{if(event.type==='bold:messaging-reconnect' || resourceHint(kind,container,event))setChanged(true);};
        window.addEventListener('bold:permissions-invalidated',revoke);
        window.addEventListener(kind==='chat' ? 'bold:messaging-event':'bold:slack-event',hint);
        window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{alive.current=false;request.current?.abort();window.removeEventListener('bold:permissions-invalidated',revoke);window.removeEventListener(kind==='chat' ? 'bold:messaging-event':'bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[]);
    useEffect(()=>{if(!allowed || origin.current!==identity){request.current?.abort();setView(empty());setAuthors([]);callbacks.current.onClose();}},[allowed,identity]);
    async function load(cursor=null,page=0){
        request.current?.abort();const abort=new AbortController();request.current=abort;
        const expected=identity;setBusy(true);setError('');
        try{
            const values=resourceFilters({...filters,...(parent ? {parent}:{})});
            const result=await resourceApi.list(kind,container,values,cursor,{signal:abort.signal});
            if(!alive.current || abort.signal.aborted || current.current!==expected)return;
            setView(old=>({rows:result.results,next:result.next_cursor,ready:true,snapshot:result.snapshot_at,page,trail:page===0 ? [result.first_cursor || null]:[...old.trail.slice(0,page),cursor]}));
            setAuthors(old=>[...new Map([...old,...result.results.map(row=>row.author)].map(row=>[row.employee_id,row])).values()]);
            setChanged(false);
        }catch(err){if(alive.current && !abort.signal.aborted && current.current===expected){setView(empty());if([401,403,404].includes(err.status))setAuthors([]);setError(err.status ? historyError(err):err.message);}}
        finally{if(alive.current && !abort.signal.aborted && current.current===expected)setBusy(false);}
    }
    useEffect(()=>{if(allowed)load();},[]);
    function change(key,value){request.current?.abort();setBusy(false);setError('');setView(empty());setFilters(old=>({...old,[key]:value}));}
    const people=[...new Map([...(core.presence?.rows || []),...(core.directory || []).map(row=>({employee_id:row.personId || row.employee,name:row.name || row.employee_name})),...authors].filter(row=>row.employee_id).map(row=>[row.employee_id,row])).values()].sort((a,b)=>(a.name || '').localeCompare(b.name || '','es'));
    if(!allowed || origin.current!==identity)return null;
    return createPortal(<div className="history_search_scrim resource_library_scrim"><section className="history_search_dialog resource_library" role="dialog" aria-modal="true" aria-labelledby="resource_library_title" aria-busy={busy}>
        <header><div><h2 id="resource_library_title">Archivos y enlaces</h2><p>{title}{parent ? ' · Este hilo':' · Historial completo'}</p></div><button type="button" aria-label="Cerrar biblioteca" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
        <div className="resource_library_body">
        <p>Todo el historial conservado, sin marcar mensajes como leídos. Los archivos se cargan al abrirlos o descargarlos; los documentos se descargan sin vista previa.</p>
        <form onSubmit={event=>{event.preventDefault();load();}}><label>Buscar recurso<input type="search" maxLength={160} value={filters.q} onChange={event=>change('q',event.target.value)} placeholder="Nombre, enlace o palabras del mensaje"/></label>
            <div className="history_search_filters"><label>Tipo<select value={filters.kind} onChange={event=>change('kind',event.target.value)}><option value="all">Todos los recursos</option><option value="image">Imágenes</option><option value="audio">Notas de voz</option><option value="document">Documentos</option><option value="file">Todos los archivos</option><option value="link">Enlaces</option></select></label><label>Enviado por<select value={filters.author} onChange={event=>change('author',event.target.value)}><option value="">Cualquier persona</option>{people.map(person=><option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label><label>Desde<input type="date" value={filters.from} onChange={event=>change('from',event.target.value)}/></label><label>Hasta<input type="date" value={filters.to} onChange={event=>change('to',event.target.value)}/></label></div>
            <div className="resource_actions"><button type="submit" disabled={busy}><RefreshCw size={16} aria-hidden="true"/>{busy ? 'Consultando…':'Aplicar filtros / actualizar'}</button><button type="button" disabled={busy} onClick={()=>{request.current?.abort();setView(empty());setFilters(initial);setError('');}}>Limpiar filtros</button></div>
        </form>
        {changed && <p role="status">La conversación cambió. Actualiza la biblioteca para ver los recursos actuales; no se hacen consultas periódicas.</p>}
        {error && <p role="alert" className="history_search_error">{error} Puedes reintentar con «Aplicar filtros / actualizar».</p>}
        <div className="history_search_content">
            <p role="status">{busy ? 'Consultando el historial de recursos…':view.ready ? view.rows.length ? `${view.rows.length} ${view.rows.length===1 ? 'mensaje':'mensajes'} con recursos en esta página · más recientes primero`:'No hay recursos con estos filtros. Prueba con otro tipo, fecha o persona.':'Aplica los filtros para consultar los recursos.'}</p>
            {view.ready && <><ol className="resource_results">{view.rows.map(row=><li key={`${identity}:${view.snapshot}:${view.page}:${row.id}`}><ResourceCard row={row} kind={kind} container={container} onContext={target=>callbacks.current.onContext(target)}/></li>)}</ol><nav aria-label="Páginas de recursos">{view.page>0 && <button type="button" disabled={busy} onClick={()=>load(view.trail[view.page-1],view.page-1)}>Recursos anteriores</button>}{view.next && <button type="button" disabled={busy} onClick={()=>load(view.next,view.page+1)}>Siguientes recursos</button>}</nav></>}
            {!busy && view.ready && !view.rows.length && <FolderOpen size={28} aria-hidden="true"/>}
        </div>
        </div>
    </section></div>,document.body);
}
