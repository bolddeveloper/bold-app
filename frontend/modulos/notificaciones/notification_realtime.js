import { api_base_url } from "../core/http_client.js";


export function notificationWebsocketURL({ ticket, baseUrl = api_base_url }) {
    const url = new URL("/ws/notifications/", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = new URLSearchParams({ ticket });
    return url.href;
}

export function createNotificationRealtime({ WebSocketImpl = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let state = null;
    function disconnect() {
        if (!state) return;
        state.stopped = true;
        clearTimer(state.timer);
        state.socket?.close();
        state = null;
    }
    function connect({ assignmentId, getTicket, onNotification = () => {}, onReconnect = () => {}, onError = () => {}, baseUrl }) {
        disconnect();
        if (!assignmentId || !getTicket) throw new Error("Falta el contexto para recibir notificaciones.");
        state = { stopped: false, attempt: 0, socket: null, timer: null };
        const current = state;
        async function open() {
            if (current.stopped) return;
            let ticket;
            try {
                ticket = await getTicket({ assignment: assignmentId, channel: "notifications" });
            } catch {
                if (!current.stopped) current.timer = setTimer(open, Math.min(30000, 1000 * 2 ** Math.min(current.attempt++, 5)));
                return;
            }
            if (current.stopped) return;
            const socket = new WebSocketImpl(notificationWebsocketURL({ ticket: ticket.ticket, baseUrl }));
            current.socket = socket;
            socket.addEventListener("open", () => { current.attempt = 0; onReconnect(); });
            socket.addEventListener("message", message => {
                try {
                    const event = JSON.parse(message.data);
                    if (event?.event_version === 2 && event.event_type === "notification.created") onNotification(event);
                } catch { /* Ignore malformed envelopes. */ }
            });
            socket.addEventListener("error", () => onError("No se pudo sincronizar las notificaciones. Reintentando…"));
            socket.addEventListener("close", event => {
                if (current.stopped) return;
                if ([4401, 4403].includes(event.code)) { onError("La sesión de notificaciones perdió autorización."); return; }
                current.timer = setTimer(open, Math.min(30000, 1000 * 2 ** Math.min(current.attempt++, 5)));
            });
        }
        open();
    }
    return { connect, disconnect };
}

const realtime = createNotificationRealtime();
export const connectNotificationStream = options => realtime.connect(options);
export const disconnectNotificationStream = () => realtime.disconnect();
