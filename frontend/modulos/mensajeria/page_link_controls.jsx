import {useEffect,useRef,useState} from 'react';
import {FileText,Link,Search,X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {pageApi,pageError} from './page_api.js';
import {createChannelRefresh} from './channel_api.js';

const merge=(old,rows)=>[...new Map([...old,...rows].map(row=>[row.id,row])).values()];

export function PageLinkPicker({channelId,pageId,onClose,onSelect,onDenied}){
    const [query,setQuery]=useState(''),[searched,setSearched]=useState(''),[rows,setRows]=useState([]),[next,setNext]=useState(null),[chosen,setChosen]=useState(null),[alias,setAlias]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const live=useRef(false),request=useRef(null),field=useRef(null);
    useDialog(true,'.slack_page_link_picker',onClose);
    useEffect(()=>{live.current=true;field.current?.focus();return()=>{live.current=false;request.current?.abort();};},[]);
    async function search(event,cursor=null){
        event?.preventDefault();const term=cursor ? searched:query.trim();
        if(term.length<2 || term.length>80)return;
        request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError('');
        if(!cursor){setRows([]);setNext(null);setChosen(null);setSearched(term);}
        try{const value=await pageApi.linkOptions(channelId,pageId,term,cursor,{signal:c.signal});if(live.current && !c.signal.aborted){setRows(old=>cursor ? merge(old,value.results):value.results);setNext(value.next);}}
        catch(err){if(live.current && !c.signal.aborted){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}}
        finally{if(live.current && !c.signal.aborted)setBusy(false);}
    }
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_link_picker" role="dialog" aria-modal="true" aria-labelledby="page_link_title">
        <header><h2 id="page_link_title">Enlazar otra página</h2><button type="button" aria-label="Cerrar selector de páginas" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
        <p>Solo se ofrecen páginas que puedes leer. El enlace no concede acceso a los demás ni copia su título al contenido compartido.</p>
        <form className="slack_task_search" onSubmit={search}><label>Buscar página por título<input ref={field} type="search" minLength={2} maxLength={80} required value={query} onChange={e=>setQuery(e.target.value)}/></label><button type="submit" disabled={busy || query.trim().length<2}><Search size={18} aria-hidden="true"/>Buscar páginas</button></form>
        {busy && <p role="status">Buscando páginas autorizadas…</p>}{error && <p role="alert">{error}</p>}
        <ul className="slack_task_results" aria-label="Páginas para enlazar">{rows.filter(row=>row.available).map(row=><li key={row.id}><button type="button" aria-pressed={chosen?.id===row.id} disabled={busy} onClick={()=>setChosen(row)}><FileText size={18} aria-hidden="true"/><span><strong>{row.title}</strong><small>{row.channel_name}</small></span></button></li>)}</ul>
        {searched && !busy && !error && !rows.length && <p role="status">No se encontraron páginas accesibles con ese título.</p>}
        {next && <button type="button" disabled={busy} onClick={()=>search(null,next)}>Más páginas para enlazar</button>}
        <label>Nombre opcional del enlace<input value={alias} maxLength={160} onChange={e=>setAlias(e.target.value)}/></label>
        <small>Si escribes un nombre, será texto compartido de esta página. Si lo dejas vacío, cada persona verá el título actual solo si tiene acceso al destino.</small>
        {chosen && <p>Destino: {chosen.title} · {chosen.channel_name}</p>}
        <footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="slack_primary" disabled={!chosen || busy} onClick={()=>onSelect(chosen,alias.trim())}><Link size={18} aria-hidden="true"/>Insertar enlace</button></footer>
    </section></div>;
}

export function PageBacklinks({channelId,pageId,onOpen,onDenied,disabled=false}){
    const [expanded,setExpanded]=useState(false),[rows,setRows]=useState([]),[next,setNext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const live=useRef(false),refresh=useRef(null),request=useRef(null),generation=useRef(0),callbacks=useRef({});callbacks.current={onOpen,onDenied};
    async function load(signal,cursor=null){
        const read=++generation.current;
        if(request.current && request.current.signal!==signal)request.current.abort();
        setBusy(true);setError('');
        try{const value=await pageApi.backlinks(channelId,pageId,cursor,{signal});if(live.current && !signal.aborted && read===generation.current){setRows(old=>cursor ? merge(old,value.results):value.results);setNext(value.next);}}
        catch(err){if(live.current && !signal.aborted && read===generation.current){setRows([]);setNext(null);if([401,403,404].includes(err.status))callbacks.current.onDenied(err);else setError(pageError(err));}}
        finally{if(live.current && !signal.aborted && read===generation.current)setBusy(false);}
    }
    useEffect(()=>{
        setRows([]);setNext(null);setError('');
        if(!expanded || disabled){setBusy(false);return;}
        live.current=true;refresh.current=createChannelRefresh(signal=>load(signal),err=>setError(pageError(err)));refresh.current.request();
        const hint=event=>{const payload=event.detail?.payload;if(!payload || payload.kind!=='page.comments_changed' && payload.channel_id===channelId && (payload.kind?.startsWith('page.') || payload.kind?.startsWith('channel.')))refresh.current?.request();};
        window.addEventListener('bold:slack-event',hint);window.addEventListener('bold:messaging-reconnect',hint);
        return()=>{live.current=false;request.current?.abort();refresh.current?.dispose();window.removeEventListener('bold:slack-event',hint);window.removeEventListener('bold:messaging-reconnect',hint);};
    },[channelId,pageId,expanded,disabled]);
    return <section className="slack_page_backlinks" aria-label="Referencias a esta página"><button type="button" aria-expanded={expanded} aria-controls={`page_backlinks_${pageId}`} disabled={disabled} onClick={()=>setExpanded(!expanded)}><Link size={18} aria-hidden="true"/>Páginas que enlazan aquí</button>
        {expanded && !disabled && <div id={`page_backlinks_${pageId}`}>
            {busy && <p role="status">Comprobando referencias autorizadas…</p>}{error && <p role="alert">{error} <button type="button" onClick={()=>refresh.current?.request()}>Reintentar referencias</button></p>}
            {!busy && !error && !rows.length && <p>No hay referencias visibles para tu asignación activa.</p>}
            <ul>{rows.filter(row=>row.available).map(row=><li key={row.id}><button type="button" onClick={()=>callbacks.current.onOpen({kind:'page',channel_id:row.channel_id,page_id:row.id,block_id:row.block_ids?.[0]})}><FileText size={18} aria-hidden="true"/><span><strong>{row.title}</strong><small>{row.channel_name}{row.archived ? ' · Archivada':''}</small></span></button></li>)}</ul>
            {next && <button type="button" disabled={busy} onClick={()=>{request.current?.abort();request.current=new AbortController();load(request.current.signal,next);}}>Más referencias</button>}
        </div>}
    </section>;
}
