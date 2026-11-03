import {useEffect,useRef,useState} from 'react';
import {Hash,MessageSquare,Pin,Plus,Search,Send,X} from 'lucide-react';
import {AvatarImage} from '../core/shared/avatar_image.jsx';
import {useAnchoredPopover} from '../core/shared/use_anchored_popover.js';
import {channelApi,channelError,createChannelRefresh,mergeChannelMessage,mergeChannelMessages} from './channel_api.js';
import {initials,dayLabel} from './messaging_models.js';
import MentionText from './mention_text.jsx';
import {MessageMedia} from './message_media.jsx';
import MessageActions from './chat_message_actions.jsx';
import {useChannelReader} from './use_channel_reader.js';
import {ThreadActions} from './thread_actions.jsx';
import {ReadingScopeBadge} from './reading_reminder.jsx';
import './channel_threads.css';

export const threadTitle=message=>message.thread_title || message.body?.split('\n')[0]?.slice(0,120) || (message.media ? 'Archivo compartido':'Conversación');
export function ThreadNotice({message,disabled,onBrowse}){
    if(!message.thread_started_at && !message.reply_count && !message.unread_reply_count)return null;
    return <div className="slack_thread_started"><MessageSquare size={14}/><span>{message.thread_starter_name ? `${message.thread_starter_name} abrió un hilo:`:'Se abrió un hilo:'} <strong>{threadTitle(message)}</strong></span><ReadingScopeBadge scopeKey={'thread:'+message.id}/>{message.unread_reply_count>0 && <strong className="slack_unread_badge">{message.unread_reply_count} sin leer</strong>}<button type="button" disabled={disabled} onClick={onBrowse}>Ver todos los hilos</button></div>;
}
const time=value=>new Date(value).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
function Author({message}){
    return <header><span className="slack_catalog_avatar"><AvatarImage url={message.author.avatar_url} initials={initials(message.author.name)}/></span><strong>{message.author.name}</strong><time dateTime={message.created_at}>{time(message.created_at)}</time></header>;
}

export function ChannelCatalog({channel,disabled,onThread,onMessage,onDenied,onOpenChange,openRequest,onThreadChange,onRead}){
    const [tab,setTab]=useState(null),[query,setQuery]=useState(''),[rows,setRows]=useState([]),[next,setNext]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
    const [creating,setCreating]=useState(false),[name,setName]=useState(''),[sending,setSending]=useState(false);
    const [filter,setFilter]=useState('all');
    const anchor=useRef(null),threadButton=useRef(null),panel=useRef(null),request=useRef(null),refresh=useRef(null),attempt=useRef(null),active=useRef(true),live=useRef({});
    live.current={tab,query,channel,filter};
    useAnchoredPopover(tab,anchor,panel,{minWidth:400,maxWidth:480,maxHeight:560});
    function close(){if(sending)return;panel.current?.hidePopover?.();setTab(null);onOpenChange(false);anchor.current?.focus();}
    function open(value,event){if(tab===value){close();return;}anchor.current=event.currentTarget;setRows([]);setNext(null);setQuery('');setCreating(false);setError('');setTab(value);onOpenChange(true);}
    async function load(signal,cursor=null){
        const snapshot=live.current;if(!snapshot.tab)return;
        const filters=snapshot.filter==='favorite' ? {favorite:'true'}:snapshot.filter==='all' ? {}:{state:snapshot.filter};
        const page=snapshot.tab==='threads' ? await channelApi.threads(channel.id,snapshot.query,cursor,{signal},filters):await channelApi.pins(channel.id,cursor,{signal});
        if(signal.aborted || !active.current || snapshot.tab!==live.current.tab || snapshot.query!==live.current.query || snapshot.filter!==live.current.filter)return;
        setRows(old=>{const known=new Map(old.map(row=>[row.id,row])),incoming=page.results.map(row=>mergeChannelMessage(known.get(row.id),row));return cursor ? [...new Map([...old,...incoming].map(row=>[row.id,row])).values()]:incoming;});setNext(page.next);
    }
    function fail(err){if(err.name==='AbortError')return;if([401,403,404].includes(err.status))onDenied(err);else setError(channelError(err));}
    useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
    useEffect(()=>{if(openRequest && !disabled){anchor.current=threadButton.current;setTab('threads');setQuery('');onOpenChange(true);}},[openRequest]);
    useEffect(()=>{
        if(!tab)return;
        const controller=new AbortController();request.current=controller;setLoading(true);setError('');
        const timer=setTimeout(()=>load(controller.signal).catch(fail).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),query ? 180:0);
        return()=>{clearTimeout(timer);controller.abort();};
    },[tab,query,filter]);
    useEffect(()=>{
        if(!tab)return;
        const queue=createChannelRefresh(signal=>load(signal),fail);refresh.current=queue;
        const changed=event=>{const payload=event.detail?.payload || event.detail;if(!payload || payload.channel_id===channel.id)queue.request();};
        window.addEventListener('bold:slack-event',changed);window.addEventListener('bold:slack-collection-change',changed);window.addEventListener('bold:messaging-reconnect',changed);
        return()=>{queue.dispose();window.removeEventListener('bold:slack-event',changed);window.removeEventListener('bold:slack-collection-change',changed);window.removeEventListener('bold:messaging-reconnect',changed);};
    },[tab,query,filter,channel.id]);
    useEffect(()=>{if(tab)(panel.current?.querySelector('input') || panel.current?.querySelector('button:not(:disabled)'))?.focus();},[tab]);
    async function create(event){
        event.preventDefault();if(sending || !name.trim())return;
        const controller=new AbortController();request.current=controller;setSending(true);setError('');
        const values=attempt.current || {body:name.trim(),thread_title:name.trim(),client_id:crypto.randomUUID()};attempt.current=values;
        try{const result=await channelApi.send(channel.id,values,{signal:controller.signal});if(active.current && !controller.signal.aborted){const visible=live.current.tab==='threads';attempt.current=null;setSending(false);setName('');panel.current?.hidePopover?.();setTab(null);onOpenChange(false);if(visible)onThread(result.message);window.dispatchEvent(new CustomEvent('bold:slack-collection-change',{detail:{channel_id:channel.id}}));}}
        catch(err){if(!controller.signal.aborted){if([400,401,403,404].includes(err.status))attempt.current=null;fail(err);}}
        finally{if(active.current && !controller.signal.aborted)setSending(false);}
    }
    return <>
        <button ref={threadButton} type="button" className="slack_catalog_trigger" title="Hilos del canal" aria-label="Hilos del canal" aria-expanded={tab==='threads'} disabled={disabled} onClick={event=>open('threads',event)}><MessageSquare size={18} aria-hidden="true"/></button>
        <button type="button" className="slack_catalog_trigger" title="Mensajes fijados" aria-label="Mensajes fijados" aria-expanded={tab==='pins'} disabled={disabled} onClick={event=>open('pins',event)}><Pin size={18} aria-hidden="true"/></button>
        <section ref={panel} popover="auto" hidden={!tab} className="slack_channel_catalog" aria-label={tab==='threads' ? 'Hilos del canal':'Mensajes fijados'} onToggle={event=>{if(event.target===event.currentTarget && event.newState==='closed'){setTab(null);onOpenChange(false);}}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
            <header><div>{tab==='threads' ? <MessageSquare size={18}/>:<Pin size={18}/>}<h3>{tab==='threads' ? 'Hilos':'Mensajes fijados'}</h3><small>#{channel.name}</small></div><button type="button" aria-label="Cerrar lista" disabled={sending} onClick={close}><X size={17}/></button></header>
            {tab==='threads' && <div className="slack_thread_search"><label><Search size={16}/><input aria-label="Buscar hilo" placeholder="Buscar hilo por nombre o mensaje" maxLength={120} value={query} onChange={event=>setQuery(event.target.value)}/></label><button type="button" className="slack_primary" disabled={!channel.can_send || sending} onClick={()=>setCreating(value=>!value)}><Plus size={15}/>Crear</button></div>}
            {tab==='threads' && <div className="slack_thread_filters" aria-label="Filtrar hilos">{[['all','Todos'],['active','Activos'],['closed','Cerrados'],['favorite','Favoritos'],['deleted','Eliminados']].map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(value);setRows([]);setNext(null);}}>{label}</button>)}</div>}
            {creating && <form className="slack_thread_create" onSubmit={create}><label>Nombre del hilo<input value={name} maxLength={120} disabled={sending || !!attempt.current} onChange={event=>setName(event.target.value)} required/></label><button className="slack_primary" type="submit" disabled={sending || !name.trim()}>{sending ? 'Creando…':attempt.current ? 'Reintentar creación':'Crear hilo'}</button></form>}
            {error && <p role="alert">{error}</p>}
            <div className="slack_catalog_rows">{rows.map(message=>{const card=<button type="button" key={message.id} className="slack_catalog_card" disabled={disabled || sending} onClick={()=>{close();tab==='threads' ? onThread(message):onMessage(message);}}>
                <Author message={message}/>{tab==='threads' ? <><strong>{threadTitle(message)}</strong><small>{message.reply_count || 0} respuestas{message.thread_following ? ' · Siguiendo':''}{message.unread_reply_count ? ` · ${message.unread_reply_count} sin leer`:''}</small></>:<><span className="slack_pin_excerpt">{message.body || (message.media ? 'Archivo compartido':message.page ? 'Página compartida':'Tarea compartida')}</span><small>{message.parent_id ? 'En un hilo · ':''}Ver mensaje original</small></>}
                {tab==='threads' && <small>{[message.thread_favorite && 'Favorito',message.thread_deleted_at ? 'En Eliminados':message.thread_locked ? 'Bloqueado':message.thread_closed_at ? 'Cerrado':null,message.thread_left && 'Abandonado'].filter(Boolean).join(' · ')}</small>}
            </button>;return tab==='threads' ? <ThreadActions key={message.id} channel={channel} message={message} disabled={disabled || sending} onChange={value=>{setRows(current=>current.map(row=>row.id===value.id ? mergeChannelMessage(row,value):row));onThreadChange?.(value);}} onRead={onRead} onDenied={onDenied}>{card}</ThreadActions>:card;})}</div>
            {loading && <p role="status">Cargando…</p>}{!loading && !rows.length && <p className="slack_catalog_empty">{tab==='threads' ? query ? 'No hay hilos con esa búsqueda.':'Aquí aparecerán los hilos de este canal.':'Todavía no hay mensajes fijados en este canal.'}</p>}
            {next && <button type="button" disabled={loading} onClick={async()=>{const controller=new AbortController();request.current=controller;setLoading(true);try{await load(controller.signal,next);}catch(err){fail(err);}finally{if(!controller.signal.aborted)setLoading(false);}}}>Mostrar más</button>}
        </section>
    </>;
}

// Keep the channel visible while the existing protected composer works in its thread.
export function ChannelContext({channel,source,disabled,readerEnabled,onThread,onReturn,onTask,onPage,onRead,onDenied,onMessageChanged,onBrowseThreads}){
    const [rows,setRows]=useState([]),[next,setNext]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
    const viewport=useRef(null),callbacks=useRef({}),queue=useRef(null),shownSource=useRef(null);callbacks.current={onDenied,onRead};
    const markRead=useChannelReader({channelId:channel.id,messages:rows,viewport,enabled:readerEnabled && !loading,onRead:value=>callbacks.current.onRead(value),onError:err=>{if([401,403,404].includes(err.status))callbacks.current.onDenied(err);}});
    useEffect(()=>{
        let active=true;const controller=new AbortController();
        async function load(signal,cursor=null){const page=await channelApi.messages(channel.id,null,cursor,{signal});if(active && !signal.aborted){setRows(current=>mergeChannelMessages(current,page.results,{recent:!cursor}));setNext(page.next);setLoading(false);}}
        function fail(err){if(active && err.name!=='AbortError'){setLoading(false);if([401,403,404].includes(err.status))callbacks.current.onDenied(err);else setError(channelError(err));}}
        const refresh=createChannelRefresh(signal=>load(signal),fail);queue.current={load,fail,controller};
        refresh.request();
        const changed=event=>{const payload=event.detail?.payload || event.detail;if(!payload || payload.channel_id===channel.id)refresh.request();};
        window.addEventListener('bold:slack-event',changed);window.addEventListener('bold:slack-collection-change',changed);window.addEventListener('bold:messaging-reconnect',changed);
        return()=>{active=false;controller.abort();refresh.dispose();window.removeEventListener('bold:slack-event',changed);window.removeEventListener('bold:slack-collection-change',changed);window.removeEventListener('bold:messaging-reconnect',changed);};
    },[channel.id]);
    useEffect(()=>{if(shownSource.current===source.id)return;const node=viewport.current?.querySelector(`[data-slack-message="${source.id}"]`);if(node){node.scrollIntoView?.({block:'nearest'});shownSource.current=source.id;}},[rows,source.id]);
    return <section className="slack_channel_context" aria-label="Conversación del canal">
        <header><Hash size={17}/><strong>{channel.name}</strong><button type="button" title="Marcar canal visible como leído" aria-label="Marcar canal visible como leído" onClick={markRead}>Leído</button></header>
        {error && <p role="alert">{error}<button type="button" onClick={()=>queue.current.load(queue.current.controller.signal).catch(queue.current.fail)}>Reintentar</button></p>}
        <div ref={viewport} className="slack_messages" aria-label="Mensajes del canal">
            {next && <button type="button" disabled={loading} onClick={()=>{setLoading(true);queue.current.load(queue.current.controller.signal,next).catch(queue.current.fail);}}>Cargar mensajes anteriores</button>}
            {loading && <p role="status">Cargando canal…</p>}
            {rows.map((message,index)=><div key={message.id}>
                {(!index || dayLabel(rows[index-1].created_at)!==dayLabel(message.created_at)) && <p className="slack_day">{dayLabel(message.created_at)}</p>}
                <article className={`slack_message ${message.id===source.id ? 'slack_thread_source':''}`} data-slack-message={message.id}><span className="slack_avatar"><AvatarImage url={message.author.avatar_url} initials={initials(message.author.name)}/></span><div className="slack_message_card"><Author message={message}/>
                    {message.body && <p className="slack_message_body"><MentionText text={message.body} mentions={message.mentions}/></p>}
                    {message.media && <MessageMedia message={message} author={message.author} fetchMedia={channelApi.media}/>}
                    {message.task && <button type="button" disabled={!message.task.available || disabled} onClick={()=>onTask(message.task)}>{message.task.available ? message.task.title:'Tarea no disponible'}</button>}
                    {message.page && <button type="button" disabled={!message.page.available || disabled} onClick={()=>onPage(message.page)}>{message.page.available ? message.page.title:'Página no disponible'}</button>}
                    <MessageActions kind="channel" containerId={channel.id} scopeKey={'channel:'+channel.id} message={message} disabled={disabled} canPin={channel.can_manage && channel.can_send} onPinChange={onMessageChanged} onDenied={onDenied} onThread={()=>onThread(message)} canEdit={message.can_edit && Date.now()<Date.parse(message.editable_until)} onEdit={()=>onReturn(message)}/>
                    <ThreadNotice message={message} disabled={disabled} onBrowse={onBrowseThreads}/>
                </div></article>
            </div>)}
        </div>
        <button type="button" className="slack_return_composer" disabled={disabled} onClick={()=>onReturn()}><Send size={17}/>Escribir en #{channel.name}<small>El borrador del hilo se conserva</small></button>
    </section>;
}
