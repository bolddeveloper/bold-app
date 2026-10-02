import { api_base_url } from "../../../core/http_client.js";
import { createRealtimeChannel } from "../../../core/realtime_channel.js";

export function createEventDeduplicator(limit = 1000) {
    const seen = new Set();
    return event => {
        if (event?.event_version !== 2 || !event.event_id || seen.has(event.event_id)) return false;
        seen.add(event.event_id);
        if (seen.size > limit) seen.delete(seen.values().next().value);
        return true;
    };
}
export function websocketURL({ unitId, ticket, baseUrl = api_base_url }) {
    const url = new URL(`/ws/unit/${encodeURIComponent(unitId)}/`, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({ ticket }); return url.href;
}
export function createRealtimeAdapter(dependencies = {}) {
    const connections = new Map(); let accept = createEventDeduplicator();
    function connect({ unitId, assignmentId, getTicket, onEvent = () => {}, onConnected = () => {}, onReconnect = () => {}, onError = () => {}, baseUrl }) {
        if (!unitId || !assignmentId || !getTicket) throw new Error("Falta el contexto de la conexión en vivo.");
        if (connections.has(unitId)) return connections.get(unitId).ready;
        const channel = createRealtimeChannel({ ...dependencies,
            getTicket: () => getTicket({ unit: unitId, assignment: assignmentId, channel: "tasks" }),
            urlForTicket: ticket => websocketURL({ unitId, ticket: ticket.ticket, baseUrl }),
            onConnected, onReconnect, onError,
            onTerminal: () => { connections.delete(unitId); onError("El canal perdió autorización. Se revisará cuando cambien los permisos."); },
            onMessage: message => { try { const event = JSON.parse(message.data); if (accept(event)) onEvent(event); } catch { /* Invalid envelope */ } },
        });
        connections.set(unitId, channel); return channel.ready;
    }
    function disconnectUnit(unitId) { const channel = connections.get(unitId); if (channel) { connections.delete(unitId); channel.stop(); } }
    function retain(unitIds) { const wanted = new Set(unitIds); for (const unitId of connections.keys()) if (!wanted.has(unitId)) disconnectUnit(unitId); }
    function disconnect() { retain([]); accept = createEventDeduplicator(); }
    return { connect, disconnect, retain };
}
const realtime = createRealtimeAdapter();
export const connect_realtime_stream = options => realtime.connect(options);
export const disconnect_realtime_stream = () => realtime.disconnect();
export const retain_realtime_streams = unitIds => realtime.retain(unitIds);
export const publish_task_event = () => Promise.resolve();
