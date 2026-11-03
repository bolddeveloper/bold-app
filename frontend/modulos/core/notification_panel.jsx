import {useState} from "react";
import {AtSign, Bell, Check, CheckCheck, MessageCircle, Settings2, Trash2, X} from "lucide-react";
import {AvatarImage} from "./shared/avatar_image.jsx";
import "./notification_panel.css";

import {isMention, notificationTaskId, notificationTime} from "./notification_data.js";
export {isMention} from "./notification_data.js";

export function NotificationPanel({notifications = [], error: loadError, onClose, onSelect, onRead, onReadAll, onDismiss, onClear, onSettings, onReply, onInbox}) {
    const [filter, setFilter] = useState("all"), [error, setError] = useState("");
    const [pending, setPending] = useState([]), [confirmClear, setConfirmClear] = useState(false);
    const unread = notifications.filter(item => !item.is_read).length;
    const visible = notifications.filter(item => filter === "unread" ? !item.is_read : filter === "mentions" ? isMention(item) : true);
    async function run(key, action) {
        if (pending.includes(key)) return;
        setError(""); setPending(current => [...current, key]);
        try {await action();} catch (problem) {setError(problem.message || "No se pudo guardar el cambio. Inténtalo de nuevo.");}
        finally {setPending(current => current.filter(value => value !== key));}
    }
    const busy = pending.length > 0;
    return <section className="task_tool_panel notifications_panel" role="dialog" aria-label="Notificaciones">
        <header className="notifications_panel_header">
            <div><h3>Notificaciones{unread > 0 && <span className="notification_count" aria-label={`${unread} sin leer`}>{unread}</span>}</h3><p>Tu actividad, en un lugar.</p></div>
            <div className="notification_header_actions">
                <button type="button" aria-label="Configurar notificaciones" title="Configurar notificaciones" onClick={onSettings}><Settings2 size={17}/></button>
                <button type="button" aria-label="Cerrar notificaciones" title="Cerrar" onClick={onClose}><X size={18}/></button>
            </div>
        </header>
        <div className="notification_toolbar">
            <div className="notification_filters" role="group" aria-label="Filtrar notificaciones">
                {[["all","Todas"],["unread","Sin leer"],["mentions","Menciones"]].map(([key,label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
            </div>
            <button type="button" className="notification_read_all" disabled={!unread || busy} title="Marcar todas como leídas" aria-label="Marcar todas como leídas" onClick={() => run("read-all", onReadAll)}><CheckCheck size={18}/></button>
        </div>
        {(error || loadError) && <p className="notification_error" role="alert">{error || loadError}</p>}
        <div className="notification_list" aria-label="Avisos">
            {visible.map(item => {
                const name = item.actor_name || item.actor?.name || item.actor?.employee_name;
                const initials = name?.trim().split(/\s+/).slice(0,2).map(word => word[0]).join("");
                const mention = isMention(item), ItemIcon = mention ? AtSign : item.icon || Bell;
                return <article className={`notification_item${item.is_read ? "" : " notification_item_unread"}`} key={item.id}>
                    <button type="button" className="notification_open" onClick={() => onSelect?.(item)}>
                        <span className="notification_avatar" aria-hidden="true" style={item.actor?.color ? {backgroundColor:item.actor.color} : undefined}>
                            {name ? <AvatarImage url={item.actor_avatar_url || item.actor?.avatar_url} initials={initials}/> : <ItemIcon size={18}/>}
                            {mention && <span className="notification_mention_badge"><AtSign size={10}/></span>}
                        </span>
                        <span className="notification_body">
                            <span className="notification_heading">{name && <strong>{name}</strong>}<span className="notification_title">{mention && (item.task || item.task_id || item.route?.task_id) ? "Te mencionó en una tarea" : item.title}</span></span>
                            <span className="notification_text">{item.body}</span>
                            <span className="notification_meta">{mention && <span>Mención</span>}{!item.is_read && <span className="notification_unread_label">Sin leer</span>}<time dateTime={item.created_at} title={item.created_at ? new Date(item.created_at).toLocaleString("es") : item.time_label}>{notificationTime(item.created_at) || item.time_label}</time></span>
                        </span>
                    </button>
                    <div className="notification_item_actions">
                        {onReply && notificationTaskId(item) && <button type="button" aria-label={`Responder: ${item.title}`} title="Responder en bandeja" onClick={() => onReply(item)}><MessageCircle size={15}/></button>}
                        <button type="button" disabled={pending.includes(String(item.id)) || pending.includes("clear") || pending.includes("read-all")} aria-label={`${item.is_read ? "Marcar sin leer" : "Marcar como leída"}: ${item.title}`} title={item.is_read ? "Marcar sin leer" : "Marcar como leída"} onClick={() => run(String(item.id), () => onRead(item.id, !item.is_read))}><Check size={15}/></button>
                        <button type="button" disabled={pending.includes(String(item.id)) || pending.includes("clear")} aria-label={`Quitar aviso: ${item.title}`} title="Quitar aviso" onClick={() => run(String(item.id), () => onDismiss(item.id))}><X size={15}/></button>
                    </div>
                </article>;
            })}
            {!visible.length && <div className="notification_empty" role="status"><Bell size={25}/><strong>{filter === "mentions" ? "Sin menciones" : filter === "unread" ? "Todo al día" : "Sin notificaciones"}</strong><p>{filter === "mentions" ? "Aquí verás cuando alguien te mencione." : "Los nuevos avisos aparecerán aquí."}</p></div>}
        </div>
        <footer className="notification_footer">
            {onInbox && !confirmClear && <button type="button" onClick={onInbox}>Abrir bandeja</button>}
            {confirmClear && notifications.length ? <><span>¿Limpiar todos los avisos?</span><div><button type="button" disabled={busy} onClick={() => setConfirmClear(false)}>Cancelar</button><button type="button" className="notification_clear_confirm" disabled={busy} onClick={() => run("clear", async () => {await onClear(); setConfirmClear(false);})}>{pending.includes("clear") ? "Limpiando…" : "Limpiar"}</button></div></> : <><span>{notifications.length} {notifications.length === 1 ? "aviso" : "avisos"}</span><button type="button" disabled={busy || !notifications.length} onClick={() => setConfirmClear(true)}><Trash2 size={14}/>Limpiar todo</button></>}
        </footer>
    </section>;
}
