// Defines the event names reserved for the future task backend.
export const task_event_types = {
    task_created: "task.created",
    task_updated: "task.updated",
    task_status_changed: "task.status_changed",
    task_deleted: "task.deleted",
    comment_created: "comment.created",
    sync_connected: "sync.connected",
    sync_disconnected: "sync.disconnected"
};


// Creates a normalized event envelope for future webhook or realtime delivery.
export function create_task_event(event_type, entity_id, payload = {}) {
    return {
        event_id: crypto.randomUUID(),
        event_type,
        entity_type: "task",
        entity_id,
        occurred_at: new Date().toISOString(),
        payload,
        source: "bold_tasks_pwa"
    };
}
