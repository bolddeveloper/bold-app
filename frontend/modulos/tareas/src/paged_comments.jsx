import { Children, useContext, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTaskPages } from "./task_pages.jsx";
import {mergeLocalComments} from "./services/local_comments.js";
import { CommentItem, TaskActionsContext } from "./comment_item.jsx";

export function CommentsSection({ children, title = "Comentarios" }) {
    const section = useRef(null);
    const [expanded, setExpanded] = useState(false);
    const [history, ...composer] = Children.toArray(children);
    useEffect(() => { if (expanded) section.current?.scrollIntoView({ block: "start" }); }, [expanded]);
    return <section ref={section} className={`task_comments_section${expanded ? " is_expanded" : ""}`} aria-label={title}>
        <header className="task_comments_section_header"><span>{title}</span><button type="button" className="detail_action_btn" aria-label={expanded ? "Contraer comentarios" : "Expandir comentarios"} title={expanded ? "Contraer comentarios" : "Expandir comentarios"} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></header>
        <div className="task_comments_history" tabIndex={0} role="region" aria-label={`Historial de ${title.toLowerCase()}`}>{history}</div>
        <div className="task_comments_composer">{composer}</div>
    </section>;
}

export function PagedComments({ queries, timeline = false }) {
    const { session, state, current, rows: serverRows, blocked, controller } = useTaskPages({ queries });
    const actions = useContext(TaskActionsContext);
    const rows = blocked ? [] : mergeLocalComments(serverRows, actions?.localComments || [], queries);
    const confirm = actions?.confirmComments;
    useEffect(() => {
        if (current && !blocked) confirm?.(serverRows.map(comment => comment.id));
    }, [serverRows, current, blocked, confirm, actions?.localComments]);
    const security = { current: blocked };
    const members = new Map(session.directory.map(person => [String(person.id), person.name]));
    return <div className="detail_comments_disclosure" aria-busy={state.loading}>
        <div className="detail_comments_heading"><span className="meta_label">MÁS RECIENTES ABAJO</span><span>{security.current ? "—" : (current ? state.count : 0) + rows.length - serverRows.length}</span></div>
        {current && state.error && <p role="alert">{state.error}</p>}
        {(!current || state.loading) && <p role="status">Cargando comentarios…</p>}
        {rows.length ? <div className={timeline ? "timeline_comments_list" : "detail_comments_list"} tabIndex={0} role="region" aria-label="Historial paginado de comentarios">
            {rows.map(comment => <CommentItem key={comment.id} comment={comment} author={members.get(String(comment.author_assignment))} />)}
        </div> : current && !state.loading && !state.error && !security.current ? <p className="detail_comments_empty">Aún no hay comentarios.</p> : null}
        {current && state.hasMore && !security.current && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.more()}>Cargar más comentarios</button>}
        {current && (state.error || state.dirty) && !security.current && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.refresh()}>Actualizar comentarios</button>}
    </div>;
}
