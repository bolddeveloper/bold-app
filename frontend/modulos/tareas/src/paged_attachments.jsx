import { useTaskPages } from "./task_pages.jsx";

export function PagedAttachments({ taskId }) {
    const { state, current, rows, blocked, controller } = useTaskPages({
        queries: [{ tasks: taskId, recent: "1" }], resource: "attachments", eventName: "bold:task-attachments",
        errorMessage: "No se pudieron cargar los adjuntos. Puedes reintentar sin perder tus cambios.",
    });
    return <div aria-busy={state.loading}>
        <div className="detail_comments_heading"><span className="meta_label">ADJUNTOS</span><span>{blocked || !current ? "—" : state.count}</span></div>
        {current && state.error && <p role="alert">{state.error}</p>}
        {(!current || state.loading) && <p role="status">Cargando adjuntos…</p>}
        {rows.length ? <div className="detail_comments_list" tabIndex={0} role="region" aria-label="Adjuntos paginados">
            {rows.map(item => <p key={item.id}><a href={/^https?:\/\//i.test(item.file_url) ? item.file_url : undefined} target="_blank" rel="noreferrer">{item.file_name}</a></p>)}
        </div> : current && !state.loading && !state.error && !blocked ? <p className="detail_comments_empty">Sin adjuntos.</p> : null}
        {current && state.hasMore && !blocked && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.more()}>Cargar más adjuntos</button>}
        {current && (state.error || state.dirty) && !blocked && <button className="secondary_button" type="button" disabled={state.loading} onClick={() => controller.current?.refresh()}>Actualizar adjuntos</button>}
    </div>;
}
