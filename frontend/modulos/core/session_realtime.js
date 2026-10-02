import { api_base_url } from "./http_client.js";
import { createRealtimeChannel } from "./realtime_channel.js";

export function notificationWebsocketURL({ ticket, baseUrl = api_base_url }) {
    const url = new URL("/ws/notifications/", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({ ticket }); return url.href;
}
// The authenticated session/control channel is owned by Core, not a content module.
export function createNotificationRealtime(dependencies = {}) {
    let channel = null;
    function disconnect() { channel?.stop(); channel = null; }
    function connect({ assignmentId, getTicket, onNotification = () => {}, onConnected = () => {}, onReconnect = () => {}, onError = () => {}, onControl = () => {}, onState = () => {}, onTerminal = () => {}, baseUrl }) {
        disconnect();
        if (!assignmentId || !getTicket) throw new Error("Falta el contexto para recibir notificaciones.");
        channel = createRealtimeChannel({ ...dependencies,
            getTicket: () => getTicket({ assignment: assignmentId, channel: "notifications" }),
            urlForTicket: ticket => notificationWebsocketURL({ ticket: ticket.ticket, baseUrl }),
            onConnected, onReconnect, onError, onState,
            onTerminal: error => { onTerminal(error); onError("El canal de notificaciones perdió autorización."); },
            onMessage: message => {
                try {
                    const event = JSON.parse(message.data);
                    if (event?.event_version !== 2) return;
                    if (event.event_type === "notification.created") onNotification(event);
                    else if (["control.ready", "permissions.revision", "assignment.changed"].includes(event.event_type)) onControl(event);
                } catch { /* Invalid envelope */ }
            },
        });
        return channel.ready;
    }
    return { connect, disconnect };
}
