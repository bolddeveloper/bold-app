import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Copy,Forward,MessageSquare,MoreHorizontal,Pencil,Pin,PinOff} from 'lucide-react';
import {useAnchoredPopover} from '../core/shared/use_anchored_popover.js';
import SaveResource from './save_resource.jsx';
import ReadingReminder from './reading_reminder.jsx';
import MessageReactions from './message_reactions.jsx';
import MessageTasks from './message_tasks.jsx';
import {channelApi,channelError} from './channel_api.js';
import './message_actions.css';

function PinMessage({message,containerId,disabled,onChange,onDenied}){
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    const request=useRef(null),active=useRef(true),pending=useRef(false);
    useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
    async function change(){
        if(pending.current || disabled)return;pending.current=true;setBusy(true);setError('');
        const controller=new AbortController();request.current=controller;
        try{const result=await channelApi.pin(containerId,message.id,!message.pinned_at,{signal:controller.signal});if(active.current && !controller.signal.aborted){onChange?.(result.message);window.dispatchEvent(new CustomEvent('bold:slack-collection-change',{detail:{channel_id:containerId}}));}}
        catch(err){if(active.current && !controller.signal.aborted){if([401,403,404].includes(err.status))onDenied?.(err);setError(channelError(err));}}
        finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    return <><button type="button" disabled={disabled || busy} onClick={change}>{message.pinned_at ? <PinOff size={16}/>:<Pin size={16}/>}<span>{busy ? 'Guardando…':message.pinned_at ? 'Desfijar mensaje':'Fijar mensaje'}</span></button>{error && <p role="alert">{error}</p>}</>;
}

export default function MessageActions({message,kind="chat",containerId,scopeKey,disabled,forwardDisabled,canForward,canEdit,onForward,onEdit,onThread,canPin,onPinChange,onDenied}){
    const [open,setOpen]=useState(false),anchor=useRef(null),panel=useRef(null),id=useId();
    const [copyError,setCopyError]=useState('');
    useAnchoredPopover(open,anchor,panel,{minWidth:230,maxWidth:280,maxHeight:380});
    const close=()=>{panel.current?.hidePopover?.();setOpen(false);};
    useEffect(()=>{
        if(kind!=='channel' || disabled)return;
        const card=anchor.current?.closest('.slack_message_card');
        if(!card)return;
        const context=event=>{
            if(event.target.closest('.messaging_message_menu,input,textarea,[contenteditable="true"]'))return;
            event.preventDefault();event.stopPropagation();setOpen(true);
        };
        card.addEventListener('contextmenu',context);
        return()=>card.removeEventListener('contextmenu',context);
    },[kind,disabled]);
    useEffect(()=>{if(open)panel.current?.querySelector('button:not(:disabled)')?.focus();},[open]);
    useEffect(()=>{if(disabled)close();},[disabled]);
    const act=callback=>{close();anchor.current?.focus();callback();};
    return <MessageReactions kind={kind} containerId={containerId} message={message} disabled={disabled} anchorRef={anchor} renderTrigger={(reaction,quick)=><>
        {kind==='channel' && <div className="slack_message_toolbar">
            {[['thumbs_up','👍','De acuerdo'],['heart','❤️','Corazón'],['fire','🔥','Excelente']].map(([key,emoji,label])=><button key={key} type="button" disabled={disabled || quick.busy} aria-label={`Reaccionar: ${label}`} onClick={()=>quick.change(key)}>{emoji}</button>)}
            {reaction}{onThread && <button type="button" aria-label={message.reply_count || message.thread_started_at ? 'Abrir hilo':'Crear hilo desde este mensaje'} disabled={disabled} onClick={onThread}><MessageSquare size={16}/></button>}
        </div>}
        <button ref={anchor} type="button" className={`messaging_message_menu_trigger ${kind==='channel' ? 'slack_message_more':''}`} aria-label="Opciones de este mensaje" title="Opciones del mensaje" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>open ? close():setOpen(true)}>{kind==='channel' ? <MoreHorizontal size={16} aria-hidden="true"/>:<ChevronDown size={16} aria-hidden="true"/>}</button>
        <div ref={panel} id={id} popover="auto" hidden={!open} className="messaging_message_menu" role="group" aria-label="Acciones del mensaje" onToggle={event=>{if(event.newState==='closed')setOpen(false);}} onKeyDown={event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();anchor.current?.focus();}
            else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
                const buttons=[...panel.current.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
                if(buttons.length){event.preventDefault();buttons[event.key==='Home' ? 0:event.key==='End' ? buttons.length-1:(index+(event.key==='ArrowUp' ? -1:1)+buttons.length)%buttons.length].focus();}
            }
        }}>
            {reaction}
            {onThread && <button type="button" disabled={disabled} onClick={()=>act(onThread)}><MessageSquare size={16}/><span>{message.reply_count || message.thread_started_at ? 'Abrir hilo':'Crear hilo'}</span></button>}
            {kind==='channel' && message.body && <button type="button" disabled={disabled} onClick={async()=>{try{await navigator.clipboard.writeText(message.body);setCopyError('');close();}catch{setCopyError('No se pudo copiar. Selecciona el texto y cópialo.');}}}><Copy size={16}/><span>Copiar texto</span></button>}
            {copyError && <p role="alert">{copyError}</p>}
            {kind==='channel' && canPin && <PinMessage message={message} containerId={containerId} disabled={disabled} onChange={onPinChange} onDenied={onDenied}/>}
            <SaveResource kind={kind} sourceId={message.id} initialSaved={message.saved} documentId={message.saved_document_id} disabled={disabled}/>
            <ReadingReminder kind={kind} sourceId={message.id} scopeKey={scopeKey || 'chat:'+containerId} disabled={disabled}/>
            {canForward && <button type="button" aria-label={message.media ? 'Reenviar imagen':'Reenviar mensaje'} disabled={disabled || forwardDisabled} onClick={()=>act(onForward)}><Forward size={16} aria-hidden="true"/><span>Reenviar</span></button>}
            <MessageTasks kind={kind} containerId={containerId} message={message} disabled={disabled} showLabel onOpen={close} onClose={()=>anchor.current?.focus()}/>
            {canEdit && <button type="button" aria-label="Editar mi mensaje" title="Editar durante los primeros diez minutos" disabled={disabled} onClick={()=>act(onEdit)}><Pencil size={16} aria-hidden="true"/><span>Editar mi mensaje</span></button>}
        </div>
    </>}/>;
}
