import {useEffect,useRef,useState} from 'react';
import {Bell,BellOff,Check,ChevronLeft,ChevronRight,Copy,DoorOpen,Lock,MoreHorizontal,Pencil,Star,Trash2,Unlock,X} from 'lucide-react';
import {useAnchoredPopover} from '../core/shared/use_anchored_popover.js';
import {channelApi,channelError,threadPreferenceMessage} from './channel_api.js';
import {threadLink} from './channel_links.js';
import './thread_actions.css';

const muteOptions=[['15m','15 minutos'],['1h','1 hora'],['3h','3 horas'],['8h','8 horas'],['24h','24 horas'],['forever','Hasta que lo active'],['off','Activar avisos']];
const noticeOptions=[['inherit','Usar seguimiento del canal o hilo'],['all','Todos los mensajes'],['mentions','Solo menciones'],['none','Ninguna']];
export function ThreadActions({channel,message,disabled,onChange,onRead,onDenied,onOpenChange,children}){
    const [open,setOpen]=useState(false),[view,setView]=useState('menu'),[title,setTitle]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[link,setLink]=useState(''),[notice,setNotice]=useState('');
    const trigger=useRef(null),panel=useRef(null),attempt=useRef(null),request=useRef(null),mounted=useRef(true);
    useAnchoredPopover(open,trigger,panel,{minWidth:260,maxWidth:300,maxHeight:590,overlapAnchor:true});
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
    useEffect(()=>{onOpenChange?.(open);return()=>onOpenChange?.(false);},[open,onOpenChange]);
    function close(){if(busy)return;panel.current?.hidePopover?.();setOpen(false);trigger.current?.focus();}
    function show(event){event?.preventDefault();event?.stopPropagation();if(disabled)return;setView('menu');setLink('');setNotice('');setError('');setOpen(true);}
    useEffect(()=>{if(!open)return;(panel.current?.querySelector('input:not(:disabled),[role^="menuitem"]:not(:disabled)') || panel.current?.querySelector('button:not(:disabled)'))?.focus();
        const outside=event=>{if(!panel.current?.contains(event.target) && !trigger.current?.contains(event.target) && !busy){panel.current?.hidePopover?.();setOpen(false);}};
        document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
    },[open,view,busy]);
    function keyboard(event){
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(view!=='menu')setView('menu');else close();return;}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.target.tagName==='INPUT')return;
        const buttons=[...panel.current.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
        if(!buttons.length)return;event.preventDefault();buttons[event.key==='Home' ? 0:event.key==='End' ? buttons.length-1:(index+(event.key==='ArrowUp' ? -1:1)+buttons.length)%buttons.length]?.focus();
    }
    async function run(operation){
        if(busy)return;
        const pending=attempt.current || operation;attempt.current=pending;
        const controller=new AbortController();request.current=controller;setBusy(true);setError('');
        try{
            let result;
            if(pending.kind==='read')result=await channelApi.readThread(channel.id,message.id,{signal:controller.signal});
            else if(pending.kind==='preference')result=await channelApi.threadPreferences(channel.id,message.id,pending.values,{signal:controller.signal});
            else result=await channelApi.manageThread(channel.id,message.id,pending.values,{signal:controller.signal});
            if(!mounted.current || controller.signal.aborted)return;
            attempt.current=null;setBusy(false);setNotice(pending.kind==='read' ? 'Hilo marcado como leído.':'Cambio guardado.');
            onChange(pending.kind==='preference' ? threadPreferenceMessage(message,result):result.message);
            if(result.channel)onRead?.(result.channel);
            window.dispatchEvent(new CustomEvent('bold:slack-collection-change',{detail:{channel_id:channel.id}}));
            panel.current?.hidePopover?.();setOpen(false);trigger.current?.focus();
        }catch(err){
            if(!mounted.current || controller.signal.aborted)return;
            if([400,401,403,404,409].includes(err.status))attempt.current=null;
            setError(channelError(err));
            if([401,403,404].includes(err.status))onDenied?.(err);
            if(err.status===409){try{const latest=await channelApi.message(channel.id,message.id,{signal:controller.signal});if(mounted.current && !controller.signal.aborted)onChange(latest.message);}catch{/* Preserve the entered title and show the original conflict. */}}
        }finally{if(mounted.current && !controller.signal.aborted)setBusy(false);}
    }
    const preference=values=>run({kind:'preference',values:{...values,version:message.thread_state_version || 0,client_id:crypto.randomUUID()}});
    function manage(action,values={}){
        if(action==='delete' && view!=='delete'){setView('delete');return;}
        if(mounted.current)run({kind:'manage',values:{action,version:message.version,...values}});
    }
    async function copy(){const value=threadLink(channel.id,message.id);try{await navigator.clipboard.writeText(value);setNotice('Enlace copiado.');close();}catch{setLink(value);setView('link');}}
    const muted=message.thread_muted_forever || Date.parse(message.thread_muted_until)>Date.now();
    const locked=busy || !!attempt.current;
    const item=(label,Icon,action,options={})=><button key={label} type="button" role={options.checked!==undefined ? 'menuitemcheckbox':'menuitem'} aria-checked={options.checked} aria-haspopup={options.submenu ? 'menu':undefined} disabled={locked || options.disabled} className={options.danger ? 'is_danger':''} onClick={action}><Icon size={16}/><span>{label}</span>{options.checked && <Check size={14}/>} {options.submenu && <ChevronRight size={14}/>}</button>;
    return <div className={children ? 'slack_thread_action_card':'slack_thread_action_header'} onContextMenu={show} onKeyDown={event=>{if(event.key==='ContextMenu' || event.key==='F10' && event.shiftKey)show(event);}}>
        {children}<button ref={trigger} className="slack_thread_more" type="button" aria-label="Opciones del hilo" title="Opciones del hilo" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={event=>open ? close():show(event)}><MoreHorizontal size={18}/></button>
        <section ref={panel} popover="manual" hidden={!open} className="slack_thread_menu" role={view==='delete' ? 'alertdialog':view==='edit' || view==='link' ? 'dialog':'menu'} aria-label="Opciones del hilo" aria-busy={busy} onKeyDown={keyboard}>
            <header><strong>{view==='mute' ? 'Silenciar hilo':view==='notifications' ? 'Notificaciones del hilo':view==='edit' ? 'Editar hilo':'Opciones del hilo'}</strong><button type="button" aria-label="Cerrar opciones del hilo" disabled={busy} onClick={close}><X size={16}/></button></header>
            {view!=='menu' && <button type="button" className="slack_thread_menu_back" disabled={locked} onClick={()=>setView('menu')}><ChevronLeft size={15}/>Volver</button>}
            {view==='menu' && <>
                {item('Marcar como leído',Check,()=>run({kind:'read'}))}<hr/>
                {item(message.thread_favorite ? 'Quitar de favoritos':'Añadir a favoritos',Star,()=>preference({favorite:!message.thread_favorite}),{checked:message.thread_favorite})}<hr/>
                {message.thread_deleted_at ? item('Restaurar hilo',DoorOpen,()=>manage('restore'),{disabled:!message.can_manage_thread}):<>
                    {item(message.thread_closed_at ? 'Reabrir hilo':'Cerrar hilo',DoorOpen,()=>manage(message.thread_closed_at ? 'open':'close'),{disabled:!message.can_close_thread || message.thread_locked})}
                    {item(message.thread_locked ? 'Desbloquear hilo':'Bloquear hilo',message.thread_locked ? Unlock:Lock,()=>manage(message.thread_locked ? 'unlock':'lock'),{disabled:!message.can_manage_thread})}
                    {item('Editar hilo',Pencil,()=>{setTitle(message.thread_title || message.body?.split('\n')[0]?.slice(0,120) || 'Conversación');setView('edit');},{disabled:!message.can_edit_thread})}
                </>}
                {item('Copiar enlace',Copy,copy)}<hr/>
                {item(muted ? 'Hilo silenciado':'Silenciar hilo',BellOff,()=>setView('mute'),{submenu:true})}
                {item('Ajustes de notificaciones',Bell,()=>setView('notifications'),{submenu:true})}<hr/>
                {!message.thread_deleted_at && item('Eliminar hilo',Trash2,()=>manage('delete'),{danger:true,disabled:!message.can_manage_thread})}
                {item(message.thread_left ? 'Volver al hilo':'Abandonar hilo',DoorOpen,()=>preference({left:!message.thread_left}))}
            </>}
            {view==='mute' && muteOptions.map(([value,label])=>item(label,BellOff,()=>preference({mute:value}),{checked:value==='off' && !muted || value==='forever' && message.thread_muted_forever}))}
            {view==='notifications' && <>{noticeOptions.map(([value,label])=>item(label,Bell,()=>preference({notifications:value}),{checked:(message.thread_notifications || 'inherit')===value}))}<p>Abandonar o silenciar pausa los avisos del hilo, incluso sus menciones. El acceso al canal se conserva.</p></>}
            {view==='edit' && <form onSubmit={event=>{event.preventDefault();manage('rename',{title:title.trim()});}}><label>Nombre del hilo<input required maxLength={120} value={title} disabled={locked} onChange={event=>setTitle(event.target.value)}/></label><button className="slack_primary" type="submit" disabled={locked || !title.trim()}>Guardar nombre</button></form>}
            {view==='link' && <label>Enlace del hilo<input readOnly value={link} onFocus={event=>event.target.select()}/></label>}
            {view==='delete' && <><p>¿Enviar este hilo a Eliminados? Se cerrará. Conservaremos sus respuestas y el mensaje original. Quien administra el canal podrá restaurarlo.</p><button type="button" className="is_danger" disabled={locked} onClick={()=>manage('delete')}><Trash2 size={16}/>Confirmar eliminación</button></>}
            {error && <p role="alert">{error}</p>}{attempt.current && !busy && <button type="button" className="slack_primary" onClick={()=>run(attempt.current)}>Reintentar cambio</button>}{busy && <p role="status">Guardando…</p>}
        </section><span className="slack_thread_action_status" role="status">{notice}</span>
    </div>;
}
