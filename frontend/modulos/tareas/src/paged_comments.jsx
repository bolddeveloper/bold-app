import { useEffect, useRef, useState } from "react";
import { useCore } from "../../core/core_provider.jsx";
import { api } from "./services/tasks_api.js";
import { createPagedComments } from "./services/paged_comments.js";
import { contentCanRefresh } from "../../core/refresh_coordinator.js";

export function PagedComments({ queries, timeline = false }) {
    const session = useCore(), controller = useRef(null);
    const security = useRef(session.securityUncertain); security.current = session.securityUncertain;
    const [state, setState] = useState({ rows: [], count: 0, loading: true, error: "", hasMore: false });
    const scope = JSON.stringify(queries);
    useEffect(() => {
        let mounted = true;
        const store = createPagedComments({ queries: JSON.parse(scope), listPage: api.listPage,
            emit: next => { if (mounted) setState({ ...next, scope, assignment: session.activeAssignment?.id }); }, canRun: () => !security.current && contentCanRefresh() });
        controller.current = store;
        store.refresh();
        const changed = event => {
            const tasks = event.detail?.tasks;
            const ids = queries.flatMap(query => query.tasks?.split(",") || []);
            if (tasks?.length && ids.length && !tasks.some(id => ids.includes(String(id)))) return;
            store.invalidate({ purge: Boolean(event.detail?.purge) });
        };
        const invalidateSecurity = event => {
            security.current = Boolean(event.detail?.uncertain);
            store.suspend(); // purge synchronously, including hidden/offline views
            if (!security.current) store.resume();
        };
        const resume = () => store.resume();
        window.addEventListener("bold:task-comments", changed);
        window.addEventListener("bold:permissions-revision", invalidateSecurity);
        window.addEventListener("focus", resume); window.addEventListener("online", resume);
        document.addEventListener("visibilitychange", resume);
        return () => {
            mounted = false; store.dispose(); controller.current = null;
            window.removeEventListener("bold:task-comments", changed);
            window.removeEventListener("bold:permissions-revision", invalidateSecurity);
            window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
            document.removeEventListener("visibilitychange", resume);
        };
    }, [scope, session.activeAssignment?.id]);
    const current = state.scope === scope && state.assignment === session.activeAssignment?.id;
    const rows = security.current || !current ? [] : state.rows;
    const members = new Map(session.directory.map(person => [String(person.id), person.name]));
    return <div aria-busy={state.loading}>
        <div className="detail_comments_heading"><span className="meta_label">COMENTARIOS · MÁS RECIENTES PRIMERO</span><span>{security.current || !current ? "—" : state.count}</span></div>
        {current && state.error && <p role="alert">{state.error}</p>}
        {(!current || state.loading) && <p role="status">Cargando comentarios…</p>}
        {rows.length ? <div className={timeline ? "timeline_comments_list" : "detail_comments_list"} tabIndex={0} role="region" aria-label="Historial paginado de comentarios">
            {rows.map(comment => <article className="detail_comment_item" key={comment.id}>
                <strong>{members.get(String(comment.author_assignment)) || "Asignación anterior"}</strong>
                <p>{comment.body}</p><small>{new Date(comment.created_at).toLocaleString("es")}</small>
            </article>)}
        </div> : current && !state.loading && !state.error && !security.current ? <p className="detail_comments_empty">Aún no hay comentarios.</p> : null}
        {current && state.hasMore && !security.current && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.more()}>Cargar más comentarios</button>}
        {current && (state.error || state.dirty) && !security.current && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.refresh()}>Actualizar comentarios</button>}
    </div>;
}
