import { create_task_event } from "./task_events.js";
import { task_event_types } from "./task_events.js";


// Defines the disabled API client configuration for the frontend-only MVP.
const api_client_config = {
    base_url: "",
    is_connected: false
};


// Returns a predictable response while the backend is not available.
function create_offline_response(action_name, payload = null) {
    return Promise.resolve({
        ok: true,
        mode: "template_only",
        action_name,
        payload,
        message: "Backend connection is not configured yet."
    });
}


// Lists tasks from the future backend endpoint.
export function list_tasks(query_params = {}) {
    return create_offline_response("list_tasks", {
        query_params,
        config: api_client_config
    });
}


// Creates a task through the future backend endpoint.
export function create_task(task_payload) {
    const event_payload = create_task_event(task_event_types.task_created, task_payload.id, task_payload);

    return create_offline_response("create_task", event_payload);
}


// Updates a task through the future backend endpoint.
export function update_task(task_id, task_payload) {
    const event_payload = create_task_event(task_event_types.task_updated, task_id, task_payload);

    return create_offline_response("update_task", event_payload);
}


// Moves a task between workflow sections through the future backend endpoint.
export function move_task(task_id, section) {
    const event_payload = create_task_event(task_event_types.task_status_changed, task_id, {
        section
    });

    return create_offline_response("move_task", event_payload);
}


// Deletes a task through the future backend endpoint.
export function delete_task(task_id) {
    const event_payload = create_task_event(task_event_types.task_deleted, task_id, {
        deleted: true
    });

    return create_offline_response("delete_task", event_payload);
}
