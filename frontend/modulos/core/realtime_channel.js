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
    onError = () => {}, onTerminal = () => {}, onState = () => {}, WebSocketImpl = globalThis.WebSocket,
    setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), random = Math.random,
    online = () => globalThis.navigator?.onLine !== false, eventTarget = globalThis.window,
    ticketQueue = queueTicket, diagnostics = syncDiagnostics, connectionTimeoutMs = 15_000 } = {}) {
    let stopped = false, opening = false, attempt = 0, socket = null, timer = null, connectionTimer = null, retryAt = 0, openedAt = 0, hasOpened = false, settled = false;
    let finishReady;
    const ready = new Promise(resolve => { finishReady = resolve; });
    const settle = () => { if (!settled) { settled = true; finishReady(); } };
    function schedule(error) {
        if (stopped) return;
        onState("disconnected");
        settle();
        if (error?.name === "AbortError" || [401, 403].includes(error?.status)) { stop(); onTerminal(error); return; }
        if (!online()) { onError("Sin conexión. La sincronización se reanudará al recuperar Internet."); return; }
        const backoff = Math.min(60_000, 1000 * 2 ** Math.min(attempt++, 6));
        const delay = Math.max(error?.retryAfterMs || 0, Math.round(backoff * (1 + random() * 0.25)));
        retryAt = now() + delay;
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
            connectionTimer = setTimer(() => {
                connectionTimer = null;
                if (stopped || socket !== current || current.readyState === 1) return;
                // A silent handshake must not block bootstrap forever. Detach first:
                // close/error events from this abandoned socket cannot retry twice.
                socket = null;
                diagnostics.record("socket", "connect-timeout");
                current.close(); schedule();
            }, connectionTimeoutMs);
            current.addEventListener("open", () => {
                if (stopped || socket !== current) return;
                clearTimer(connectionTimer); connectionTimer = null; retryAt = 0;
                openedAt = now(); diagnostics.record("socket", "open");
                onState("open");
                const recovered = hasOpened || settled; hasOpened = true;
                settle(); recovered ? onReconnect() : onConnected();
            });
            current.addEventListener("message", message => { if (!stopped && socket === current) onMessage(message); });
            current.addEventListener("error", () => { /* close owns retry scheduling */ });
            current.addEventListener("close", event => {
                if (stopped || socket !== current) return;
                clearTimer(connectionTimer); connectionTimer = null;
                socket = null; diagnostics.record("socket", "close");
                onState("disconnected");
                if ([4401, 4403].includes(event.code)) { settle(); stop(); onTerminal({ status: event.code === 4401 ? 401 : 403 }); return; }
                if (hasOpened && now() - openedAt >= 30_000) attempt = 0;
                schedule();
            });
        } catch (error) { if (!stopped) schedule(error); }
        finally { opening = false; }
    }
    function wake() {
        // Network recovery is not permission to ignore Retry-After/quota/backoff.
        if (!stopped && !opening && online() && now() >= retryAt && (!socket || socket.readyState === 3)) {
            clearTimer(timer); timer = null; open();
        }
    }
    function stop() {
        if (stopped) return;
        stopped = true; clearTimer(timer); clearTimer(connectionTimer); connectionTimer = null; eventTarget?.removeEventListener("online", wake);
        onState("stopped");
        const current = socket; socket = null; current?.close(); settle();
    }
    eventTarget?.addEventListener("online", wake);
    open();
    return { ready, stop };
}
