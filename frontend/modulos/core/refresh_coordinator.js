import { syncDiagnostics } from "./sync_diagnostics.js";

// One pending batch, one operation in flight. Security is never visibility-gated.
export function createRefreshCoordinator({ run, canRun = () => true, delayMs = 400,
    setTimer = setTimeout, clearTimer = clearTimeout, diagnostics = syncDiagnostics } = {}) {
    let pending = null, running = false, timer = null, disposed = false;
    const abort = () => new DOMException("Contexto cancelado", "AbortError");
    function flush() {
        if (disposed || running || !pending) return;
        if (!pending.force && !pending.security && !canRun()) return;
        clearTimer(timer); timer = null;
        const batch = pending; pending = null; running = true;
        diagnostics.record("refresh", batch.security ? "security" : [...batch.reasons].sort().join("+"));
        Promise.resolve().then(() => {
            if (disposed) throw abort();
            return run({ reasons: [...batch.reasons], resources: [...batch.resources], security: batch.security });
        }).then(value => disposed ? batch.reject(abort()) : batch.resolve(value), batch.reject)
            .finally(() => { running = false; if (pending && !disposed) schedule(); });
    }
    function schedule(immediate = false) {
        if (disposed || running || !pending) return;
        if (immediate || pending.security) { flush(); return; }
        if (timer === null) timer = setTimer(() => { timer = null; flush(); }, delayMs);
    }
    function request({ reason = "mutation", resources = ["all"], immediate = false, force = false, security = false } = {}) {
        if (disposed) return Promise.reject(abort());
        diagnostics.record("refresh-trigger", reason);
        if (!pending) {
            let resolve, reject;
            const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
            pending = { promise, resolve, reject, reasons: new Set(), resources: new Set(), force: false, security: false };
        }
        const promise = pending.promise;
        pending.reasons.add(reason); resources.forEach(resource => pending.resources.add(resource));
        pending.force ||= force; pending.security ||= security;
        schedule(immediate);
        return promise;
    }
    return { request, resume: () => schedule(),
        dispose() { disposed = true; clearTimer(timer); timer = null; if (pending) pending.reject(abort()); pending = null; },
    };
}

export function contentCanRefresh() {
    return globalThis.document?.visibilityState !== "hidden" && globalThis.navigator?.onLine !== false;
}
