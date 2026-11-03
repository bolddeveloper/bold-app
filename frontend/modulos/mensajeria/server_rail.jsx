import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowDown,LockKeyhole,MessageSquare,MoreHorizontal,Plus,Search,X} from 'lucide-react';
import {channelApi,channelError} from './channel_api.js';
import {channelColor,channelMatches} from './channel_discovery.js';
import {initials} from './messaging_models.js';
import {SearchField} from './channel_picker.jsx';
import {AvatarImage} from '../core/shared/avatar_image.jsx';
import {useServerOrder} from './use_server_order.jsx';

function ServerButton({row,current,expanded,disabled,onSelect,onContext,onSortStart,onSortKey,sorting}){
    const [tip,setTip]=useState(false),anchor=useRef(null),panel=useRef(null),tipId=useId();
    useEffect(()=>{if(sorting)setTip(false);},[sorting]);
    useLayoutEffect(()=>{
        const node=panel.current;if(!tip || expanded || !node)return;
        node.showPopover?.();
        const rect=anchor.current.getBoundingClientRect(),width=Math.min(260,window.innerWidth-24);
        node.style.maxWidth=`${width}px`;
        node.style.left=`${Math.max(12,Math.min(rect.right+10,window.innerWidth-node.offsetWidth-12))}px`;
        node.style.top=`${Math.max(12,Math.min(rect.top+(rect.height-node.offsetHeight)/2,window.innerHeight-node.offsetHeight-12))}px`;
        const close=()=>setTip(false);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
        return()=>{node.hidePopover?.();window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};
    },[tip,expanded]);
    const type=row.private ? 'Privado':row.departmentId ? '':'Canales independientes';
    return <><button ref={anchor} type="button" data-server-id={row.id} className={`slack_rail_channel ${sorting ? 'is_sorting':''}`} title="Mantén pulsado y arrastra para ordenar. Alt + ↑/↓ también mueve el servidor." style={{'--channel-color':channelColor(row)}} aria-label={`Abrir servidor ${row.name}`} aria-describedby={tip && !expanded ? tipId:undefined} aria-current={current ? 'page':undefined} disabled={disabled} onPointerDown={event=>{setTip(false);onSortStart(event,row.id);}} onDragStart={event=>event.preventDefault()} onMouseEnter={()=>{if(!sorting)setTip(true);}} onMouseLeave={()=>setTip(false)} onFocus={()=>setTip(true)} onBlur={()=>setTip(false)} onContextMenu={event=>{event.preventDefault();setTip(false);onContext(row,event.currentTarget,event.clientX,event.clientY);}} onKeyDown={event=>{onSortKey(event,row.id);if(event.key==='Escape')setTip(false);if(event.key==='ContextMenu' || event.key==='F10' && event.shiftKey){event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();setTip(false);onContext(row,event.currentTarget,rect.right,rect.top);}}} onClick={()=>{setTip(false);onSelect(row);}}><span className="slack_server_icon" aria-hidden="true"><AvatarImage url={row.avatar_url} initials={initials(row.name).slice(0,2)}/>{row.private && <LockKeyhole className="slack_rail_lock" size={10}/>}</span><span className="slack_server_identity" aria-hidden="true"><strong>{row.name}</strong>{type && <small>{type}</small>}</span></button>
        {tip && !expanded && <div ref={panel} id={tipId} popover="manual" role="tooltip" className="slack_server_tooltip"><strong>{row.name}</strong>{type && <small>{type}</small>}</div>}
    </>;
}

export default function ServerRail({groups,activeId,identity,locked,disabled,canCreate,homeRef,next,loading,onMore,onSelect,onCreate,onChat,onIcon}){
    const [expanded,setExpanded]=useState(false),[query,setQuery]=useState(''),[found,setFound]=useState({query:'',rows:[],next:null}),[searching,setSearching]=useState(false),[error,setError]=useState('');
    const searchHost=useRef(null),request=useRef(null),menu=useRef(null),list=useRef(null);
    const [context,setContext]=useState(null);
    useEffect(()=>()=>request.current?.abort(),[]);
    useLayoutEffect(()=>{if(!context || !menu.current)return;const panel=menu.current;panel.showPopover?.();panel.style.left=`${Math.max(12,Math.min(context.x,window.innerWidth-panel.offsetWidth-12))}px`;panel.style.top=`${Math.max(12,Math.min(context.y,window.innerHeight-panel.offsetHeight-12))}px`;panel.querySelector("button:not(:disabled)")?.focus();return()=>panel.hidePopover?.();},[context]);
    useEffect(()=>{
        request.current?.abort();setError('');
        if(!expanded || !query.trim()){setFound({query:'',rows:[],next:null});setSearching(false);return;}
        const controller=new AbortController();request.current=controller;setSearching(true);
        const timer=setTimeout(()=>channelApi.servers({signal:controller.signal},null,query.trim()).then(page=>{if(!controller.signal.aborted)setFound({query,rows:page.results,next:page.next});}).catch(err=>{if(!controller.signal.aborted)setError(channelError(err));}).finally(()=>{if(!controller.signal.aborted)setSearching(false);}),180);
        return()=>{clearTimeout(timer);controller.abort();};
    },[query,expanded,identity]);
    useLayoutEffect(()=>{if(expanded)searchHost.current?.querySelector('input')?.focus();},[expanded]);
    async function more(){
        if(!query.trim()){onMore();return;}
        if(searching || !found.next || found.query!==query)return;
        const controller=new AbortController();request.current?.abort();request.current=controller;setSearching(true);setError('');
        try{const page=await channelApi.servers({signal:controller.signal},found.next,query.trim());if(!controller.signal.aborted)setFound(current=>({...current,rows:[...new Map([...current.rows,...page.results].map(row=>[row.id,row])).values()],next:page.next}));}
        catch(err){if(!controller.signal.aborted)setError(channelError(err));}
        finally{if(!controller.signal.aborted)setSearching(false);}
    }
    const rows=[...new Map([...groups,...(found.query===query ? found.rows.map(row=>({...row,id:`server:${row.id}`,serverId:row.id})):[])].map(row=>[row.id,row])).values()].filter(row=>channelMatches(row.name,query));
    const sort=useServerOrder({rows,identity,disabled:disabled || locked,list,onContext:(row,anchor,x,y)=>setContext({row,anchor,x,y})});
    const close=()=>{setExpanded(false);setQuery('');homeRef.current?.focus();};
    return <nav className={`slack_rail ${expanded ? 'is_expanded':''} ${sort.dragging ? 'is_ordering':''}`} aria-label="Servidores de Slack" inert={locked ? true:undefined} onClickCapture={sort.click} onKeyDown={event=>{if(event.key==='Escape' && expanded && !sort.dragging){event.preventDefault();close();}}}>
        <button ref={homeRef} type="button" className="slack_rail_home" aria-label={expanded ? 'Cerrar buscador de servidores':'Buscar servidores'} aria-expanded={expanded} aria-controls="slack_server_list" disabled={disabled} onClick={()=>expanded ? close():setExpanded(true)}>{expanded ? <X size={20}/>:<Search size={20}/>}<span>Servidores</span></button>
        <div ref={searchHost} className="slack_server_search" inert={!expanded ? true:undefined} aria-hidden={!expanded} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();event.currentTarget.nextElementSibling?.querySelector('button')?.focus();}}}><div><SearchField label="Buscar servidor" value={query} onChange={setQuery} placeholder="Nombre del servidor"/>{searching && <small role="status">Buscando servidores…</small>}</div></div>
        <div ref={list} id="slack_server_list" className="slack_rail_channels" aria-busy={searching || sort.busy} onKeyDown={event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(buttons.length){event.preventDefault();buttons[event.key==='Home' ? 0:event.key==='End' ? buttons.length-1:(index+(event.key==='ArrowUp' ? -1:1)+buttons.length)%buttons.length].focus();}}}}>
            {sort.rows.map(row=><ServerButton key={row.id} row={row} current={row.id===activeId} expanded={expanded} disabled={disabled} sorting={sort.dragging===row.id} onSortStart={sort.start} onSortKey={sort.key} onContext={sort.context} onSelect={async value=>{if(await onSelect(value)!==false){setExpanded(false);setQuery('');}}}/>)}
            {expanded && !rows.length && !searching && <p className="slack_server_empty">No hay servidores con ese nombre y tu acceso actual.</p>}
        </div>
        {error && <p role="alert" className="slack_server_empty">{error}</p>}
        {sort.error && <p role="alert" className="slack_server_empty">{sort.error}<button type="button" disabled={sort.busy} onClick={sort.reload}>Recargar orden</button></p>}
        <span role="status" className="slack_organization_status">{sort.notice}</span>
        {(query.trim() ? found.query===query && found.next:next) && <button type="button" className="slack_rail_more" aria-label="Cargar más servidores" disabled={loading || searching} onClick={more}><MoreHorizontal size={18}/></button>}
        <button type="button" className="slack_rail_create" aria-label="Crear servidor privado" title="Crear servidor privado" disabled={disabled || !canCreate} onClick={onCreate}><Plus size={21}/></button>
        <button type="button" className="slack_rail_chat" aria-label="Ir al Chat privado" title="Ir al Chat privado" disabled={disabled} onClick={onChat}><MessageSquare size={20}/></button>
        {context && <div ref={menu} popover="auto" role="menu" aria-label={`Opciones de ${context.row.name}`} className="slack_server_context" onToggle={event=>{if(event.newState==='closed'){setContext(null);context.anchor?.focus();}}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setContext(null);context.anchor?.focus();}}}>
            <small>Orden personal</small>
            {[[-1,'Subir servidor',ArrowUp],[1,'Bajar servidor',ArrowDown]].map(([direction,label,Icon])=><button key={direction} type="button" role="menuitem" disabled={!sort.ready || sort.busy || disabled || sort.rows.findIndex(row=>row.id===context.row.id)+direction<0 || sort.rows.findIndex(row=>row.id===context.row.id)+direction>=sort.rows.length} onClick={()=>{sort.step(context.row.id,direction);setContext(null);context.anchor?.focus();}}><Icon size={15}/>{label}</button>)}
            {context.row.can_edit_icon && <button type="button" role="menuitem" onClick={()=>{const row=context.row;setContext(null);onIcon(row);}}>Cambiar imagen del servidor</button>}
        </div>}
    </nav>;
}
