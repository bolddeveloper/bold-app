import { useTaskPages } from "./task_pages.jsx";

export function PagedComments({ queries, timeline = false }) {
    const { session, state, current, rows, blocked, controller } = useTaskPages({ queries });
    const security = { current: blocked };
    const members = new Map(session.directory.map(person => [String(person.id), person.name]));
    return <details className="detail_comments_disclosure" open aria-busy={state.loading}>
        <summary className="detail_comments_heading"><span className="meta_label">COMENTARIOS · MÁS RECIENTES PRIMERO</span><span>{security.current || !current ? "—" : state.count}</span><span className="detail_comments_toggle"><span className="when_open">Plegar</span><span className="when_closed">Desplegar</span></span></summary>
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
    </details>;
}
