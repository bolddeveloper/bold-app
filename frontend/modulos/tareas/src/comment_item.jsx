import { createContext, useContext, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ImageGallery } from "./image_gallery.jsx";
import { VoiceNotes } from "./voice_notes.jsx";
import { TaskText, TaskTextEditor } from "./task_text_editor.jsx";
import { confirmBold } from "../../core/shared/bold_dialog.js";

export const TaskActionsContext = createContext(null);

export function CommentItem({ comment, author, taskId }) {
    const actions = useContext(TaskActionsContext);
    const [audioBusy, setAudioBusy] = useState(false);
    const [editing, setEditing] = useState(false), [body, setBody] = useState(comment.body || ""), [notes, setNotes] = useState(comment.voice_notes || []), [busy, setBusy] = useState(false);
    async function save() {
        if (busy || audioBusy || (!body.trim() && !notes.length)) return;
        setBusy(true);
        const saved = await actions.changeComment(comment, { body: body.trim(), voice_notes: notes });
        setBusy(false); if (saved !== false) setEditing(false);
    }
    async function remove() {
        if (!await confirmBold("¿Eliminar este comentario?")) return;
        setBusy(true); await actions.deleteComment(comment); setBusy(false);
    }
    return <article className="detail_comment_item"><header className="comment_item_header"><strong>{author || comment.author_name || "Asignación anterior"}</strong>{actions && !comment.local_status && <span className="comment_item_actions"><button type="button" disabled={busy} aria-label="Editar comentario" onClick={() => { setBody(comment.body || ""); setNotes(comment.voice_notes || []); setEditing(true); }}><Pencil size={14} /></button><button type="button" disabled={busy} aria-label="Eliminar comentario" onClick={remove}><Trash2 size={14} /></button></span>}</header>{editing ? <><TaskTextEditor compact label="Editar comentario" value={body} onChange={setBody} notes={notes} onNotesChange={setNotes} resource="comments" resourceId={comment.id} onBusyChange={setAudioBusy} disabled={busy} /><div className="comment_edit_actions"><button type="button" disabled={busy || audioBusy || (!body.trim() && !notes.length)} onClick={save}>Guardar</button><button type="button" disabled={busy || audioBusy} onClick={() => setEditing(false)}>Cancelar</button></div></> : <>{comment.body && <TaskText value={comment.body} imageTaskId={taskId || comment.task || comment.task_id} imageHistory imageSection={comment.image_section} imageProjectId={comment.image_project_id} />}<VoiceNotes value={comment.voice_notes || []} resource="comments" resourceId={comment.id} /><ImageGallery images={(comment.images || []).map(image => image.url)} taskId={taskId || comment.task || comment.task_id} history imageSection={comment.image_section} imageProjectId={comment.image_project_id}/></>}{comment.local_status === "failed" && <div className="comment_sync_error" role="alert"><small>No se pudo confirmar el envío. Comprueba el historial antes de reintentar. {comment.local_error}</small><button type="button" onClick={() => actions?.retryComment(comment)}>Reintentar envío</button></div>}<small>{new Date(comment.created_at).toLocaleString("es")}{comment.updated_at && Date.parse(comment.updated_at) - Date.parse(comment.created_at) > 1000 ? " · Editado" : ""}</small></article>;
}
