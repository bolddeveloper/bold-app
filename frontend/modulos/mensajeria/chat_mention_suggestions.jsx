import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AtSign,LoaderCircle} from 'lucide-react';
import {useAnchoredPopover} from '../core/shared/use_anchored_popover.js';
import {mentionPeople} from '../tareas/src/mentions.js';
import {messagingApi} from './messaging_api.js';
import {channelApi} from './channel_api.js';
import './mention_suggestions.css';

export default function ChatMentionSuggestions({conversationId,channelId,anchorRef,panelRef,listId,query,onActiveChange,onSelect,onClose,onDenied}){
    const [people,setPeople]=useState([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[index,setIndex]=useState(0);
    const [refine,setRefine]=useState(false),complete=useRef(null);
    const scope=channelId ? `channel:${channelId}`:`chat:${conversationId}`,searchQuery=channelId ? query.trim():'';
    const callbacks=useRef(null);callbacks.current={onSelect,onClose,onDenied};
    useAnchoredPopover(true,anchorRef,panelRef,{minWidth:300,maxWidth:420,maxHeight:290});
    useEffect(()=>{
        const controller=new AbortController();setBusy(true);setError('');setPeople([]);setRefine(false);
        if(complete.current?.scope===scope){setPeople(complete.current.people);setBusy(false);return()=>controller.abort();}
        const timer=setTimeout(()=>{
            const request=channelId ? channelApi.mentionPeople(channelId,searchQuery,{signal:controller.signal}):messagingApi.mentionPeople(conversationId,'',{signal:controller.signal});
            request.then(page=>{
                if(controller.signal.aborted)return;
                const rows=[...page.results,...(page.references || []).map(row=>({...row,referenceOnly:true}))];
                setPeople(rows);setRefine(Boolean(page.refine));
                if(!searchQuery && !page.refine)complete.current={scope,people:rows};
            }).catch(err=>{
                if(controller.signal.aborted)return;
                if([401,403,404].includes(err.status))callbacks.current.onDenied(err);
                else setError(err.status===429 ? 'Espera un momento antes de reintentar.':'No se pudieron cargar las personas. Tu borrador se conserva.');
            }).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
        },searchQuery ? 180:0);
        return()=>{clearTimeout(timer);controller.abort();};
    },[scope,searchQuery,attempt]);
    const rows=mentionPeople(people,query),selected=rows.length ? index%rows.length:0,activeId=rows.length ? `${listId}-${selected}`:undefined;
    useEffect(()=>setIndex(0),[query]);
    useLayoutEffect(()=>{onActiveChange(activeId);panelRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});return()=>onActiveChange(undefined);},[activeId,onActiveChange,panelRef]);
    useEffect(()=>{
        const field=anchorRef.current;
        const keydown=event=>{
            if(event.isComposing || event.keyCode===229)return;
            if(event.key==='Tab'){callbacks.current.onClose();return;}
            if(!['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key))return;
            event.preventDefault();event.stopPropagation();
            if(event.key==='Escape')callbacks.current.onClose();
            else if(event.key==='Enter'){if(!busy && rows.length)callbacks.current.onSelect(rows[selected]);}
            else if(rows.length)setIndex(current=>(current+(event.key==='ArrowUp' ? -1:1)+rows.length)%rows.length);
        };
        const outside=event=>{if(!field?.contains(event.target) && !panelRef.current?.contains(event.target))callbacks.current.onClose();};
        field?.addEventListener('keydown',keydown,true);document.addEventListener('pointerdown',outside);
        return()=>{field?.removeEventListener('keydown',keydown,true);document.removeEventListener('pointerdown',outside);};
    },[anchorRef,panelRef,rows,selected,busy]);
    return <section ref={panelRef} popover="manual" className="messaging_mention_suggestions" aria-label={channelId ? "Menciones en este canal":"Menciones en este chat"} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();anchorRef.current?.focus();}}}>
        <header><AtSign size={16} aria-hidden="true"/><strong>Mencionar persona</strong><small>Esc para cerrar</small></header>
        {busy && <p role="status"><LoaderCircle size={15} className="messaging_spin" aria-hidden="true"/>Cargando personas…</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" onClick={()=>{setAttempt(value=>value+1);anchorRef.current?.focus();}}>Reintentar</button></div>}
        <div id={listId} role="listbox" aria-label="Personas que puedes mencionar" aria-busy={busy}>{rows.map((person,row)=><button key={person.employee_id} id={`${listId}-${row}`} type="button" role="option" aria-selected={selected===row} tabIndex={-1} onMouseDown={event=>event.preventDefault()} onClick={()=>onSelect(person)}><span className="messaging_mention_initial" aria-hidden="true">{person.name?.trim().slice(0,1)}</span><span><strong>{person.name}</strong><small>{person.email}{person.referenceOnly && ' · Solo referencia'}</small></span></button>)}</div>
        {!busy && !error && !rows.length && <p role="status">No hay personas que coincidan.</p>}
        {refine && <p>Escribe más del nombre o correo para buscar otras personas.</p>}
        <footer>{channelId ? 'Solo se avisa a personas con acceso':'Solo participantes de este chat'} · ↑ ↓ elegir · Enter insertar</footer>
    </section>;
}
