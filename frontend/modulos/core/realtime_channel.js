import { syncDiagnostics } from "./sync_diagnostics.js";

export function createTicketQueue(limit = 2) {
    let active = 0; const waiting = [];
    function drain() {
        while (active < limit && waiting.length) {
            const job = waiting.shift(); active++;
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; drain(); });
        }
    }
    return run => new Promise((resolve, reject) => { waiting.push({ run, resolve, reject }); drain(); });
}
const queueTicket = createTicketQueue();

export function createRealtimeChannel({ getTicket, urlForTicket, onMessage = () => {}, onConnected = () => {}, onReconnect = () => {},
    onError = () => {}, onTerminal = () => {}, WebSocketImpl = globalThis.WebSocket,
    setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), random = Math.random,
    online = () => globalThis.navigator?.onLine !== false, eventTarget = globalThis.window,
    ticketQueue = queueTicket, diagnostics = syncDiagnostics } = {}) {
    let stopped = false, opening = false, attempt = 0, socket = null, timer = null, openedAt = 0, hasOpened = false, settled = false;
    let finishReady;
    const ready = new Promise(resolve => { finishReady = resolve; });
    const settle = () => { if (!settled) { settled = true; finishReady(); } };
    function schedule(error) {
        if (stopped) return;
        settle();
        if (error?.name === "AbortError" || [401, 403].includes(error?.status)) { stop(); onTerminal(error); return; }
        if (!online()) { onError("Sin conexión. La sincronización se reanudará al recuperar Internet."); return; }
        const backoff = Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6));
        const delay = Math.max(error?.retryAfterMs || 0, Math.round(backoff * (1 + random() * 0.25)));
        diagnostics.record("socket", "retry");
        clearTimer(timer); timer = setTimer(open, delay);
        onError(error?.quotaExceeded ? "El servicio alcanzó su límite de peticiones. La sincronización está pausada temporalmente." : "Reconectando. Tus cambios guardados siguen en el servidor.");
    }
    async function open() {
        timer = null;
        if (stopped || opening || (socket && [0, 1].includes(socket.readyState))) return;
        if (!online()) { schedule(); return; }
        opening = true;
        try {
            const ticket = await ticketQueue(() => {
                if (stopped) throw new DOMException("Canal cancelado", "AbortError");
                diagnostics.record("socket", "ticket"); return getTicket();
            });
            if (stopped) return;
            const current = new WebSocketImpl(urlForTicket(ticket)); socket = current;
            current.addEventListener("open", () => {
                if (stopped || socket !== current) return;
                openedAt = now(); diagnostics.record("socket", "open");
                const recovered = hasOpened || settled; hasOpened = true;
                settle(); recovered ? onReconnect() : onConnected();
            });
            current.addEventListener("message", message => { if (!stopped && socket === current) onMessage(message); });
            current.addEventListener("error", () => { /* close owns retry scheduling */ });
            current.addEventListener("close", event => {
                if (stopped || socket !== current) return;
                socket = null; diagnostics.record("socket", "close");
                if ([4401, 4403].includes(event.code)) { settle(); stop(); onTerminal({ status: event.code === 4401 ? 401 : 403 }); return; }
                if (hasOpened && now() - openedAt >= 30_000) attempt = 0;
                schedule();
            });
        } catch (error) { if (!stopped) schedule(error); }
        finally { opening = false; }
    }
    function wake() { if (!stopped && !opening && (!socket || socket.readyState === 3)) { clearTimer(timer); timer = null; open(); } }
    function stop() {
        if (stopped) return;
        stopped = true; clearTimer(timer); eventTarget?.removeEventListener("online", wake);
        const current = socket; socket = null; current?.close(); settle();
    }
    eventTarget?.addEventListener("online", wake);
    open();
    return { ready, stop };
}
