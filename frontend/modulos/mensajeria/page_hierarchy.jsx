import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,FileText,X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {pageApi,pageError} from './page_api.js';
import {createChannelRefresh} from './channel_api.js';

function merge(old,rows){return [...new Map([...old,...rows].map(row=>[row.id,row])).values()];}
function Branch({row,channelId,archived,revision,selected,disabled,onOpen,onError,depth=0}){
    const [expanded,setExpanded]=useState(false),[rows,setRows]=useState([]),[next,setNext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const request=useRef(null),live=useRef(false);
    async function load(signal,cursor=null){
        setBusy(true);setError('');
        try{const result=await pageApi.branch(channelId,row.id,archived,cursor,{signal});if(live.current && !signal.aborted){setRows(old=>cursor ? merge(old,result.results):result.results);setNext(result.next);}}
        catch(err){if(live.current && !signal.aborted){if([401,403,404].includes(err.status))onError(err);else setError(pageError(err));}}
        finally{if(live.current && !signal.aborted)setBusy(false);}
    }
    useEffect(()=>{live.current=true;if(expanded){request.current=new AbortController();load(request.current.signal);}return()=>{live.current=false;request.current?.abort();};},[channelId,row.id,archived,revision,expanded]);
    const childrenId=`page_children_${row.id}`;
    return <li className="slack_page_tree_node">
        <div className="slack_page_tree_row">
            {row.has_children ? <button className="slack_page_expand" type="button" aria-label={`${expanded ? 'Plegar':'Desplegar'} subpáginas de ${row.title}`} aria-expanded={expanded} aria-controls={childrenId} disabled={disabled} onClick={()=>setExpanded(!expanded)}>{expanded ? <ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>:<span className="slack_page_expand_space"/>}
            <button type="button" aria-current={selected===row.id ? 'page':undefined} disabled={disabled} onClick={()=>onOpen(row.id)}><FileText size={18} aria-hidden="true"/><span><strong>{row.title}</strong><small>{row.archived_at ? 'Archivada':`Versión ${row.version}`}</small></span></button>
        </div>
        {expanded && <div id={childrenId}>{busy && <p role="status">Cargando subpáginas…</p>}{error && <p role="alert">{error} <button type="button" onClick={()=>{request.current?.abort();request.current=new AbortController();load(request.current.signal);}}>Reintentar</button></p>}
            <ul className={depth>=3 ? 'slack_page_tree_deep':undefined}>{depth<19 && rows.map(child=><Branch key={child.id} {...{channelId,archived,revision,selected,disabled,onOpen,onError}} row={child} depth={depth+1}/>)}</ul>
            {next && <button type="button" disabled={busy || disabled} onClick={()=>{request.current?.abort();request.current=new AbortController();load(request.current.signal,next);}}>Más subpáginas</button>}
        </div>}
    </li>;
}

export function PageTree({rows,...props}){return <nav aria-label="Páginas disponibles"><ul className="slack_page_tree">{rows.map(row=><Branch key={row.id} row={row} {...props}/>)}</ul></nav>;}

export function PageBreadcrumbs({channelId,pageId,onOpen,onDenied,revision}){
    const [value,setValue]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
    useEffect(()=>{setValue(null);setError('');const refresh=createChannelRefresh(async signal=>{const result=await pageApi.structure(channelId,pageId,{signal});if(!signal.aborted)setValue(result);},err=>{if([401,403,404].includes(err.status))onDenied(err);else setError('No se pudo comprobar la ubicación.');});refresh.request();return()=>refresh.dispose();},[channelId,pageId,revision,retry]);
    return <nav className="slack_page_breadcrumbs" aria-label="Ubicación de la página">{value ? <><span>Páginas del canal</span>{value.ancestors.map(row=><span key={row.id}><ChevronRight size={14} aria-hidden="true"/><button type="button" onClick={()=>onOpen(row.id)}>{row.title}{row.archived ? ' (archivada)':''}</button></span>)}</>:error ? <span role="alert">{error}<button type="button" onClick={()=>setRetry(value=>value+1)}>Reintentar ubicación</button></span>:<span role="status">Comprobando ubicación…</span>}</nav>;
}

export function MovePage({channelId,page,onClose,onMoved,onDenied}){
    const [structure,setStructure]=useState(null),[rows,setRows]=useState([]),[next,setNext]=useState(null),[query,setQuery]=useState(''),[choice,setChoice]=useState(null),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null);
    const live=useRef(false),reads=useRef(null),writes=useRef(null),search=useRef(''),acting=useRef(false);search.current=query;
    useDialog(true,'.slack_page_move',()=>{if(!saving)onClose();});
    function failed(err){if([401,403,404].includes(err.status))onDenied(err);else setError(pageError(err));}
    async function options(signal,cursor=null){
        const term=search.current;setBusy(true);setError('');
        try{const result=await pageApi.parents(channelId,page.id,term,cursor,{signal});if(live.current && !signal.aborted && term===search.current){setRows(old=>cursor ? merge(old,result.results):result.results);setNext(result.next);}}
        catch(err){if(live.current && !signal.aborted)failed(err);}finally{if(live.current && !signal.aborted)setBusy(false);}
    }
    async function location(signal){const result=await pageApi.structure(channelId,page.id,{signal});if(live.current && !signal.aborted){setStructure(result);setChoice(null);}}
    useEffect(()=>{live.current=true;reads.current=new AbortController();location(reads.current.signal).catch(err=>{if(!reads.current.signal.aborted)failed(err);});return()=>{live.current=false;reads.current?.abort();writes.current?.abort();};},[]);
    useEffect(()=>{const c=new AbortController(),timer=setTimeout(()=>options(c.signal),200);return()=>{clearTimeout(timer);c.abort();};},[query]);
    async function move(){
        if(acting.current || busy || !structure || !choice)return;
        const values=pending || {parent_id:choice.id,version:structure.structure_version,client_id:crypto.randomUUID()};
        acting.current=true;setPending(values);setSaving(true);setError('');writes.current=new AbortController();const c=writes.current;
        try{const result=await pageApi.move(channelId,page.id,values,{signal:c.signal});if(live.current && !c.signal.aborted){setPending(null);onMoved(result);}}
        catch(err){if(live.current && !c.signal.aborted){if(err.status===409){setPending(null);if(err.fields?.current){setStructure(err.fields.current);setChoice(null);}}else if(err.status===400)setPending(null);failed(err);}}
        finally{acting.current=false;if(live.current && !c.signal.aborted)setSaving(false);}
    }
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_move" role="dialog" aria-modal="true" aria-labelledby="move_page_title">
        <header><h2 id="move_page_title">Mover página</h2><button type="button" disabled={saving} aria-label="Cerrar ubicación" onClick={onClose}><X size={20}/></button></header>
        <p>Mueve «{page.title}» con todas sus subpáginas dentro de este canal. No cambia el acceso ni el contenido; no se pueden crear ciclos.</p>
        {error && <p role="alert">{error}</p>}
        <label>Buscar página superior<input type="search" value={query} maxLength={80} disabled={!!pending} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="slack_page_parent_options" role="group" aria-label="Ubicación de destino"><button type="button" disabled={!!pending} aria-pressed={choice?.id===null} onClick={()=>setChoice({id:null,title:'Raíz del canal'})}>Raíz del canal</button>{rows.map(row=><button type="button" key={row.id} disabled={!!pending} aria-pressed={choice?.id===row.id} onClick={()=>setChoice(row)}>{row.title}</button>)}</div>
        {(busy || saving) && <p role="status">Comprobando ubicación…</p>}{next && <button type="button" disabled={busy || !!pending} onClick={()=>{reads.current?.abort();reads.current=new AbortController();options(reads.current.signal,next);}}>Más ubicaciones</button>}
        <p>{choice ? `Destino: ${choice.title}`:'Elige la raíz del canal o una página superior.'}</p>
        {pending && !saving && <p>El movimiento aún no está confirmado. Reintenta con la misma operación o cierra y comprueba la ubicación actual antes de elegir otro destino.</p>}
        <footer><button type="button" disabled={saving} onClick={onClose}>{pending ? 'Cerrar sin confirmar':'Cancelar'}</button><button type="button" className="slack_primary" disabled={busy || saving || !choice || !structure} onClick={move}>{saving ? 'Moviendo…':pending ? 'Reintentar movimiento':'Confirmar ubicación'}</button></footer>
    </section></div>;
}
