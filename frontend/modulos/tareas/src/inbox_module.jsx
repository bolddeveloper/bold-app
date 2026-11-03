import {useContext, useId, useRef, useState} from 'react';
import {Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, AtSign, Bell, Bookmark, Check, CheckCheck, Inbox, MessageCircle, MoreHorizontal, Search, Settings2, X} from 'lucide-react';
import {AvatarImage} from '../../core/shared/avatar_image.jsx';
import {ResponsiveOverlay} from '../../core/shared/responsive_overlay.jsx';
import {notificationTime} from '../../core/notification_data.js';
import {inboxActivities, inboxTypes} from './inbox_data.js';
import {TaskText, TaskTextEditor} from './task_text_editor.jsx';
import {CommentItem, TaskActionsContext} from './comment_item.jsx';
import {PagedComments} from './paged_comments.jsx';
import {commentQueries, pagedCommentsEnabled} from './services/paged_comments.js';
import {mergeLocalComments} from './services/local_comments.js';
import {plainRichText} from './rich_text.js';
import {useAnchoredPopover} from '../../core/shared/use_anchored_popover.js';
import './inbox_v3.css';

const tabs=[['activity','Todas'],['unread','Sin leer'],['mentions','Menciones'],['saved','Guardadas'],['archived','Archivadas']];
const same=(a,b)=>String(a)===String(b);
const normalize=text=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('es');
function Sender({activity}) {
    return <span className="inbox_sender_avatar" aria-hidden="true">{activity.actor.name?<AvatarImage url={activity.actor.avatar_url} initials={activity.actor.initials}/>:<Bell size={18}/>}<span className="inbox_kind_badge">{activity.is_mention?<AtSign size={11}/>:activity.type==='comment'?<MessageCircle size={11}/>:<Check size={11}/>}</span></span>;
}

function MobileInboxActions({item,saved,archived,onSave,onRead,onArchive}) {
    const [open,setOpen]=useState(false),anchor=useRef(null),panel=useRef(null),id=useId();
    useAnchoredPopover(open,anchor,panel,{minWidth:190,maxWidth:220,maxHeight:200});
    const close=()=>{panel.current?.hidePopover?.();setOpen(false);anchor.current?.focus();};
    const choose=action=>{close();action();};
    return <div className="inbox_v3_more"><button ref={anchor} type="button" aria-label={`Opciones del aviso: ${item.title}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={18}/></button>{open&&<div ref={panel} id={id} popover="auto" role="dialog" aria-label="Opciones del aviso" className="inbox_v3_action_menu" onToggle={event=>{if(event.newState==='closed')setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
        <button type="button" onClick={()=>choose(onSave)}><Bookmark size={16}/>{saved?'Quitar de guardadas':'Guardar aviso'}</button>
        <button type="button" onClick={()=>choose(onRead)}><Check size={16}/>{item.is_read?'Marcar sin leer':'Marcar leída'}</button>
        <button type="button" onClick={()=>choose(onArchive)}>{archived?<ArchiveRestore size={16}/>:<Archive size={16}/>} {archived?'Restaurar':'Archivar'}</button>
    </div>}</div>;
}

export default function InboxModule(props) {
    const {notifications=[],tasks=[],projects=[],directory=[],archived_inbox_ids:archived=[],saved_inbox_ids:saved=[],inbox_selected_ids:checked=[],inbox_tab:tab='activity',inbox_query:query='',inbox_filters:filters,selected_inbox_id:selectedId}=props;
    const [drafts,setDrafts]=useState({}),[showFilters,setShowFilters]=useState(false);
    const activities=inboxActivities(notifications,tasks,projects,directory);
    const counts={activity:activities.filter(item=>!archived.includes(item.id)).length,unread:activities.filter(item=>!archived.includes(item.id)&&!item.is_read).length,mentions:activities.filter(item=>!archived.includes(item.id)&&item.is_mention).length,saved:activities.filter(item=>!archived.includes(item.id)&&saved.includes(item.id)).length,archived:activities.filter(item=>archived.includes(item.id)).length};
    const visible=activities.filter(item=>{
        if(tab==='archived'?!archived.includes(item.id):archived.includes(item.id))return false;
        if(tab==='saved'&&!saved.includes(item.id)||tab==='mentions'&&!item.is_mention||tab==='unread'&&item.is_read)return false;
        const text=[item.actor.name,item.title,item.body,item.task?.title,item.project?.label].join(' ');
        return (!query.trim()||normalize(text).includes(normalize(query.trim())))&&(filters.state==='all'||(filters.state==='read'?item.is_read:!item.is_read))&&(filters.type==='all'||item.type===filters.type)&&(filters.project_id==='all'||same(item.project?.id,filters.project_id));
    }).sort((a,b)=>filters.sort==='oldest'?a.timestamp-b.timestamp||b.index-a.index:filters.sort==='priority'?({Alta:3,Media:2,Baja:1}[b.task?.priority]||0)-({Alta:3,Media:2,Baja:1}[a.task?.priority]||0)||b.timestamp-a.timestamp:b.timestamp-a.timestamp||a.index-b.index);
    const activity=(props.inbox_detail_open && selectedId ? activities.find(item=>same(item.id,selectedId)) : visible.find(item=>same(item.id,selectedId))||visible[0])||null;
    const selected=checked.filter(id=>visible.some(item=>same(item.id,id))),allSelected=visible.length>0&&selected.length===visible.length;
    const selectVisible=()=>props.set_inbox_selected_ids(current=>allSelected?current.filter(id=>!visible.some(item=>same(item.id,id))):[...new Set([...current,...visible.map(item=>item.id)])]);
    const changeFilter=(key,value)=>props.set_inbox_filters(current=>({...current,[key]:value}));

    return <section className={`inbox_module inbox_v3${props.inbox_detail_open?' inbox_detail_open':''}`}>
        <header className="inbox_v3_header"><div><h1>Bandeja de entrada <span>{counts.unread} sin leer</span></h1><p>Personas, conversaciones y cambios de tu trabajo.</p></div><div>
            <button type="button" disabled={!counts.unread} onClick={props.handle_mark_notifications_read} title="Marcar todas como leídas"><CheckCheck size={17}/><span>Leer todas</span></button>
            <button type="button" onClick={props.onSettings} aria-label="Configurar notificaciones" title="Configurar notificaciones"><Settings2 size={17}/></button>
        </div></header>
        <nav className="inbox_v3_tabs" aria-label="Bandeja" title="Guardadas y archivadas se conservan en este navegador.">{tabs.map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{props.set_inbox_tab(id);props.set_inbox_selected_ids([]);props.close_inbox_detail();}}>{id==='mentions'&&<AtSign size={14}/>} {label}<span>{counts[id]}</span></button>)}</nav>
        {props.error&&<p className="inbox_v3_error" role="alert">{props.error}</p>}
        <div className="inbox_v3_layout"><div className="inbox_v3_list_panel">
            <div className="inbox_v3_search"><Search size={16}/><input type="search" aria-label="Buscar en la bandeja" placeholder="Buscar persona, tarea o mensaje…" value={query} onChange={event=>props.set_inbox_query(event.target.value)}/>{query&&<button type="button" aria-label="Limpiar búsqueda" onClick={()=>props.set_inbox_query('')}><X size={15}/></button>}</div>
            <div className="inbox_v3_list_tools"><label><input type="checkbox" checked={allSelected} disabled={!visible.length} onChange={selectVisible} aria-label="Seleccionar avisos visibles"/><span>{visible.length} avisos</span></label><button type="button" aria-expanded={showFilters} onClick={()=>setShowFilters(value=>!value)}>Filtros{[filters.type,filters.state,filters.project_id].filter(value=>value!=='all').length?' · Activos':''}</button><select aria-label="Ordenar avisos" value={filters.sort} onChange={event=>changeFilter('sort',event.target.value)}><option value="recent">Más recientes</option><option value="oldest">Más antiguos</option><option value="priority">Prioridad</option></select></div>
            {showFilters&&<div className="inbox_v3_filters"><label>Estado<select value={filters.state} onChange={event=>changeFilter('state',event.target.value)}><option value="all">Todos</option><option value="unread">Sin leer</option><option value="read">Leídos</option></select></label><label>Tipo<select value={filters.type} onChange={event=>changeFilter('type',event.target.value)}><option value="all">Todos</option>{Object.entries(inboxTypes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Proyecto<select value={filters.project_id} onChange={event=>changeFilter('project_id',event.target.value)}><option value="all">Todos</option>{projects.map(project=><option key={project.id} value={project.id}>{project.label}</option>)}</select></label><button type="button" onClick={()=>props.set_inbox_filters(current=>({...current,state:'all',type:'all',project_id:'all'}))}>Limpiar filtros</button></div>}
            {!!selected.length&&<div className="inbox_v3_bulk" role="group" aria-label="Acciones para avisos seleccionados"><strong>{selected.length} seleccionados</strong><button type="button" onClick={()=>{props.handle_inbox_bulk_read_state(true,selected);}}><Check size={14}/>Leer</button><button type="button" onClick={()=>{props.handle_inbox_bulk_read_state(false,selected);}}>Sin leer</button><button type="button" onClick={()=>{props.handle_inbox_bulk_save(selected);}}><Bookmark size={14}/>Guardar</button>{tab!=='archived'&&<button type="button" onClick={()=>{props.handle_inbox_bulk_archive(selected);}}><Archive size={14}/>Archivar</button>}</div>}
            <div className="inbox_v3_list" aria-label="Actividad">{visible.map((item,index)=><div key={item.id}>{(filters.sort==='recent'||filters.sort==='oldest')&&item.group!==visible[index-1]?.group&&<h2 className="inbox_v3_day">{item.group}</h2>}<article className={`inbox_v3_item${same(item.id,activity?.id)?' is_selected':''}${!item.is_read?' is_unread':''}`}>
                <label className="inbox_v3_select"><input type="checkbox" aria-label={`Seleccionar aviso: ${item.title}`} checked={checked.includes(item.id)} onChange={event=>props.set_inbox_selected_ids(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/></label>
                <button type="button" className="inbox_v3_open" aria-label={`Ver aviso: ${item.title}`} aria-current={same(item.id,activity?.id)?'true':undefined} onClick={()=>props.handle_inbox_activity_select(item.id)}><Sender activity={item}/><span className="inbox_v3_copy"><span><strong>{item.actor.name||'BOLD'}</strong><time dateTime={item.created_at}>{notificationTime(item.created_at,item.time_label)}</time></span><b>{item.title}</b><span>{plainRichText(item.body||'')}</span><small>{item.is_mention?'Te mencionó':inboxTypes[item.type]}{item.task&&` · ${item.task.title}`}{item.project&&` · ${item.project.label}`}</small></span></button>
                <MobileInboxActions item={item} saved={saved.includes(item.id)} archived={tab==='archived'} onSave={()=>props.handle_toggle_inbox_saved(item.id)} onRead={()=>props.handle_toggle_inbox_read(item.id)} onArchive={()=>props.handle_toggle_inbox_archive(item.id)}/><div className="inbox_v3_item_actions"><button type="button" aria-label={`${saved.includes(item.id)?'Quitar de guardadas':'Guardar aviso'}: ${item.title}`} title={saved.includes(item.id)?'Quitar de guardadas':'Guardar'} aria-pressed={saved.includes(item.id)} onClick={()=>props.handle_toggle_inbox_saved(item.id)}><Bookmark size={15}/></button><button type="button" aria-label={`${item.is_read?'Marcar sin leer':'Marcar leída'}: ${item.title}`} title={item.is_read?'Marcar sin leer':'Marcar leída'} onClick={()=>props.handle_toggle_inbox_read(item.id)}><Check size={15}/></button><button type="button" aria-label={`${tab==='archived'?'Restaurar':'Archivar'}: ${item.title}`} title={tab==='archived'?'Restaurar':'Archivar'} onClick={()=>props.handle_toggle_inbox_archive(item.id)}>{tab==='archived'?<ArchiveRestore size={15}/>:<Archive size={15}/>}</button></div>
            </article></div>)}{!visible.length&&<div className="inbox_v3_empty" role="status"><Inbox size={30}/><strong>{tab==='unread'?'Todo al día':'No hay avisos aquí'}</strong><p>{query||filters.state!=='all'||filters.type!=='all'||filters.project_id!=='all'?'Prueba otra búsqueda o limpia los filtros.':'Los nuevos avisos aparecerán aquí.'}</p></div>}</div>
        </div>
        <ResponsiveOverlay query="(max-width: 899px)" onClose={props.inbox_detail_open?props.close_inbox_detail:undefined}><aside className={`inbox_detail_panel inbox_v3_detail${props.inbox_detail_open?' inbox_detail_panel_open':''}`} aria-label="Detalle del aviso">
            <button type="button" className="inbox_v3_back" onClick={props.close_inbox_detail}><ArrowLeft size={16}/>Volver a la bandeja</button>
            {activity?<><header className="inbox_v3_detail_header"><Sender activity={activity}/><div><strong>{activity.actor.name||'BOLD'}</strong><small>{inboxTypes[activity.type]} · {notificationTime(activity.created_at,activity.time_label)}</small></div><button type="button" aria-label="Cerrar detalle del aviso" onClick={props.close_inbox_detail}><X size={17}/></button></header><div className="inbox_v3_context"><h2>{activity.title}</h2><TaskText value={activity.body||''}/>{activity.task&&<button type="button" className="inbox_v3_task_context" aria-label={`Abrir detalles de ${activity.task.title}`} onClick={()=>props.onOpenContext(activity)}><strong>{activity.task.title}</strong><small>{activity.project?.label||'Tarea'} · {activity.task.completed?'Completada':'Pendiente'} · {activity.task.due_label||'Sin fecha'}</small></button>}<button type="button" className="inbox_v3_context_link" disabled={!activity.taskId&&!activity.projectId&&!activity.route?.module} onClick={()=>props.onOpenContext(activity)}>{activity.taskId?'Abrir tarea':'Abrir contexto'}<ArrowUpRight size={15}/></button></div>
                {activity.taskId?<InboxConversation key={String(activity.taskId)} activity={activity} body={drafts[activity.taskId]||''} setBody={body=>setDrafts(current=>({...current,[activity.taskId]:body}))} onSend={props.onReply} disabled={props.replyDisabled}/>:<p className="inbox_v3_reply_hint">Abre el contexto para participar en esta conversación.</p>}
            </>:<div className="inbox_v3_empty"><MessageCircle size={30}/><strong>Tu actividad, con contexto</strong><p>Selecciona un aviso para ver sus detalles.</p></div>}
        </aside></ResponsiveOverlay></div>
    </section>;
}

function InboxConversation({activity,body,setBody,onSend,disabled}) {
    const sending=useRef(false),actions=useContext(TaskActionsContext),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const comments=mergeLocalComments(activity.task?.comments||[],actions?.localComments||[],[{tasks:String(activity.taskId)}]);
    async function send(){
        if(sending.current||disabled||!plainRichText(body).trim())return;
        sending.current=true;setBusy(true);setError('');
        try {const result=await onSend(activity.taskId,body);if(result===false)setError('No se pudo enviar. Tu respuesta sigue en el borrador.');else setBody('');}
        catch(problem){setError(problem.message||'No se pudo enviar. Tu respuesta sigue en el borrador.');}
        finally {sending.current=false;setBusy(false);}
    }
    return <section className="inbox_v3_conversation" aria-label="Conversación de la tarea"><h3><MessageCircle size={16}/>Conversación de la tarea</h3><div className="inbox_v3_history">{pagedCommentsEnabled()?<PagedComments queries={commentQueries({taskIds:[activity.taskId]})}/>:comments.length?comments.map(comment=><CommentItem key={comment.id} comment={comment} taskId={activity.taskId}/>):<p>Aún no hay comentarios.</p>}</div><div className="inbox_v3_reply"><label>Responder en la tarea</label><TaskTextEditor compact label="Respuesta" placeholder="Escribe tu respuesta… Usa @ para mencionar." value={body} onChange={setBody} disabled={busy||disabled} allowImages={false} allowVoiceNotes={false} onSubmit={send} submitDisabled={!plainRichText(body).trim()||busy||disabled} maxLength={10000}/><small>Se publica como comentario de la tarea. @ avisa a la persona mencionada.</small>{error&&<p role="alert">{error}</p>}</div></section>;
}
