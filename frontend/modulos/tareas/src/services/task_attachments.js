export const pagedAttachmentsEnabled = () => import.meta.env?.VITE_USE_REAL_BACKEND === "true" && import.meta.env?.VITE_TASK_INCREMENTAL_SYNC === "true" && import.meta.env?.VITE_TASK_PAGED_ATTACHMENTS === "true";
export function notifyAttachmentViews(tasks = null, purge = false) {
    globalThis.window?.dispatchEvent(new CustomEvent("bold:task-attachments", { detail: { tasks, purge } }));
}

// The editor needs the complete baseline for this task, never for the department.
export function createTaskEditLoader(client) {
    let generation = 0, pending = null;
    const cancel = () => { generation++; pending?.controller.abort(); pending = null; };
    function load(task) {
        if (pending?.id === task.id) return pending.promise;
        cancel();
        const epoch = generation, controller = new AbortController();
        const promise = (async () => {
            const rows = await client.list("attachments", { tasks: task.id, recent: "1" }, { signal: controller.signal });
            if (epoch !== generation || controller.signal.aborted) throw new DOMException("Edición cancelada", "AbortError");
            const ids = new Set();
            for (const row of rows) {
                if (!row.id || String(row.task) !== String(task.id) || row.deleted_at || ids.has(String(row.id)))
                    throw new Error("La respuesta de adjuntos no pertenece completamente a esta tarea.");
                ids.add(String(row.id));
            }
            const attachments = rows.map(row => ({ ...row, name: row.file_name, url: row.file_url }));
            return { ...task, attachments, attachmentsLoaded: true, attachmentCount: attachments.length, attachmentBaseline: attachments };
        })().finally(() => { if (epoch === generation) pending = null; });
        pending = { id: task.id, controller, promise };
        return promise;
    }
    return { load, cancel };
}
