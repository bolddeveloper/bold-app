import { create_task_event } from "./task_events.js";
import { task_event_types } from "./task_events.js";


// Keeps the future realtime adapter disabled for the frontend-only MVP.
const realtime_state = {
    is_connected: false,
    transport: "none",
    listeners: new Set()
};


// Subscribes to future task events without opening a network connection yet.
export function subscribe_to_task_events(listener) {
    realtime_state.listeners.add(listener);

    return () => {
        realtime_state.listeners.delete(listener);
    };
}


// Publishes local template events to registered listeners only.
export function publish_task_event(event_payload) {
    realtime_state.listeners.forEach((listener) => {
        listener(event_payload);
    });

    return Promise.resolve({
        ok: true,
        mode: "local_template",
        event_payload
    });
}


// Prepares a WebSocket-style connection contract for the future backend.
export function connect_realtime_stream() {
    const event_payload = create_task_event(task_event_types.sync_connected, "workspace", {
        transport: "websocket_or_sse_pending"
    });

    realtime_state.is_connected = false;
    realtime_state.transport = "template";

    return publish_task_event(event_payload);
}


// Prepares a disconnect contract for the future realtime backend.
export function disconnect_realtime_stream() {
    const event_payload = create_task_event(task_event_types.sync_disconnected, "workspace", {
        transport: realtime_state.transport
    });

    realtime_state.is_connected = false;
    realtime_state.transport = "none";

    return publish_task_event(event_payload);
}
