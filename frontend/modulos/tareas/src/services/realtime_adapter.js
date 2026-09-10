import { api_base_url } from "../core/http_client.js";

export function createEventDeduplicator(limit = 1000) {
    const seen = new Set();
    return event => {
        if (event?.event_version !== 2 || !event.event_id || seen.has(event.event_id)) return false;
        seen.add(event.event_id);
        if (seen.size > limit) seen.delete(seen.values().next().value);
        return true;
    };
}
export function websocketURL({ unitId, token, assignmentId, baseUrl = api_base_url }) {
    const url = new URL(`/ws/unit/${encodeURIComponent(unitId)}/`, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({ token, assignment: assignmentId });
    return url.href;
}
export function createRealtimeAdapter({ WebSocketImpl = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const connections = new Map();
    let accept = createEventDeduplicator();
    function connect({ unitId, token, assignmentId, onEvent = () => {}, onReconnect = () => {}, onError = () => {}, baseUrl }) {
        if (!unitId || !token || !assignmentId) throw new Error("Falta el contexto de la conexión en vivo.");
        if (connections.has(unitId)) return;
        const state = { stopped: false, attempt: 0, socket: null, timer: null };
        connections.set(unitId, state);
        function open() {
            if (state.stopped) return;
            const socket = new WebSocketImpl(websocketURL({ unitId, token, assignmentId, baseUrl }));
            state.socket = socket;
            socket.addEventListener("open", () => {
                if (state.stopped) return;
                state.attempt = 0;
                // Includes the first connection: REST may have changed during the handshake.
                onReconnect();
            });
            socket.addEventListener("message", message => {
                if (state.stopped) return;
                try { const event = JSON.parse(message.data); if (accept(event)) onEvent(event); } catch { /* Ignore malformed envelopes. */ }
            });
            socket.addEventListener("error", () => onError("No se pudo conectar en vivo. Reintentando…"));
            socket.addEventListener("close", event => {
                if (state.stopped) return;
                if ([4401, 4403].includes(event.code)) { onError("Sin permiso para observar esta unidad."); return; }
                state.timer = setTimer(open, Math.min(30000, 1000 * 2 ** Math.min(state.attempt++, 5)));
            });
        }
        open();
    }
    function disconnect() {
        for (const state of connections.values()) { state.stopped = true; clearTimer(state.timer); state.socket?.close(); }
        connections.clear(); accept = createEventDeduplicator();
    }
    return { connect, disconnect };
}
const realtime = createRealtimeAdapter();
export const connect_realtime_stream = options => realtime.connect(options);
export const disconnect_realtime_stream = () => realtime.disconnect();
// Template events never enter the server's V2 event stream.
export const publish_task_event = () => Promise.resolve();
