import { create_task_event } from "./task_events.js";
import { task_event_types } from "./task_events.js";


// Defines the WebSocket base URL, derived from the same API base used by
// api_client.js (http -> ws, https -> wss).
const api_base_url = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const websocket_base_url = api_base_url.replace(/^http/, "ws");


// Tracks the live WebSocket connection and its registered listeners.
const realtime_state = {
    is_connected: false,
    transport: "none",
    socket: null,
    listeners: new Set()
};


// Subscribes to task events broadcast over the live connection.
export function subscribe_to_task_events(listener) {
    realtime_state.listeners.add(listener);

    return () => {
        realtime_state.listeners.delete(listener);
    };
}


// Publishes an event to every registered listener.
export function publish_task_event(event_payload) {
    realtime_state.listeners.forEach((listener) => {
        listener(event_payload);
    });

    return Promise.resolve({
        ok: true,
        mode: realtime_state.transport,
        event_payload
    });
}


// Opens a live WebSocket connection to boldApp for the given workspace, so
// this client receives task/comment events from any other connected client
// (including other browsers/devices) in real time.
export function connect_realtime_stream(workspace_id) {
    if (realtime_state.socket) {
        return Promise.resolve({
            ok: true,
            mode: "already_connected"
        });
    }

    const socket = new WebSocket(`${websocket_base_url}/ws/workspace/${workspace_id}/`);
    realtime_state.socket = socket;
    realtime_state.transport = "websocket";

    socket.addEventListener("open", () => {
        realtime_state.is_connected = true;
        publish_task_event(create_task_event(task_event_types.sync_connected, "workspace", {
            transport: "websocket"
        }));
    });

    socket.addEventListener("message", (message_event) => {
        publish_task_event(JSON.parse(message_event.data));
    });

    socket.addEventListener("close", () => {
        realtime_state.is_connected = false;
        realtime_state.socket = null;
    });

    return Promise.resolve({
        ok: true,
        mode: "websocket"
    });
}


// Closes the live WebSocket connection, if one is open.
export function disconnect_realtime_stream() {
    const event_payload = create_task_event(task_event_types.sync_disconnected, "workspace", {
        transport: realtime_state.transport
    });

    if (realtime_state.socket) {
        realtime_state.socket.close();
        realtime_state.socket = null;
    }

    realtime_state.is_connected = false;
    realtime_state.transport = "none";

    return publish_task_event(event_payload);
}
