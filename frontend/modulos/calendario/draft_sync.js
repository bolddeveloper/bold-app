import { contentCanRefresh } from "../core/refresh_coordinator.js";

// One request in flight, finite Meet wait and finite draft lifetime.
export function createDraftSync({ poll, heartbeat, needsMeet, onEvent = () => {}, onWarning = () => {}, onExpired = () => {},
    canRun = contentCanRefresh, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    pollMs = 5_000, waitMs = 60_000, maxPolls = 12, lifetimeMs = 30 * 60_000 } = {}) {
    const born = now(), controller = new AbortController();
    let stopped = false, running = false, timer = null, attempts = 0, failures = 0, heartbeatFailures = 0;
    let deadline = born + waitMs, nextPoll = born + pollMs, nextHeartbeat = born + 60_000, waiting = true;
    function schedule() { if (!stopped) timer = setTimer(tick, pollMs); }
    async function tick() {
        if (stopped || running) return;
        if (now() - born >= lifetimeMs) { stop(); onExpired("El borrador de Meet caducó. Tus campos se conservan; puedes generar otro enlace."); return; }
        if (!canRun()) { schedule(); return; }
        running = true;
        try {
            if (now() >= nextHeartbeat) {
                nextHeartbeat = now() + 60_000;
                try { await heartbeat({ signal: controller.signal }); heartbeatFailures = 0; }
                catch (error) {
                    if (stopped) return;
                    if ([400, 401, 403, 404].includes(error?.status) || ++heartbeatFailures >= 3) {
                        stop(); onExpired("No se pudo mantener el borrador de Meet. Tus campos se conservan; vuelve a generar el enlace."); return;
                    }
                }
            }
            if (!stopped && waiting && needsMeet() && now() >= nextPoll) {
                if (now() >= deadline || attempts >= maxPolls) { waiting = false; onWarning("Google Meet está tardando en responder. Puedes reintentar la consulta sin perder el formulario."); return; }
                attempts++; nextPoll = now() + pollMs;
                try {
                    const event = await poll({ signal: controller.signal });
                    if (!stopped) { failures = 0; onEvent(event); }
                } catch (error) {
                    if (!stopped && error?.name !== "AbortError" && ++failures >= 3) {
                        waiting = false; onWarning("No se pudo consultar Google Meet. Reintenta cuando tengas conexión.");
                    }
                }
            }
        } finally { running = false; schedule(); }
    }
    function stop() { stopped = true; clearTimer(timer); controller.abort(); }
    schedule();
    return { stop, retry() { if (stopped) return; attempts = 0; failures = 0; deadline = now() + waitMs; nextPoll = now(); waiting = true; } };
}
