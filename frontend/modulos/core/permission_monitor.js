// Control leases are not authorization. Every write is still checked by Django,
// and individual authorization decisions retain their conservative five-second TTL.
import { syncDiagnostics } from "./sync_diagnostics.js";

export function createPermissionMonitor({ assignmentId, cache, fetchRevision,
    onInvalidate = () => {}, onUnauthorized = () => {},
    online = () => globalThis.navigator?.onLine !== false,
    visible = () => globalThis.document?.visibilityState !== "hidden",
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, diagnostics = syncDiagnostics } = {}) {
    let disposed = false, inFlight = false, timer = null, epoch = 0;
    let leaseUntil = 0, boundaryAt = Infinity, channel = null, sequence = 0, state = null, context = null;
    let lastAttempt = -Infinity, retryAt = 0, uncertain = false;
    const retiredChannels = new Set();
    const healthy = () => leaseUntil > now() && boundaryAt > now() && online();
    const older = value => {
        const current = cache.getRevision();
        return current !== null && /^\d+$/.test(String(value)) && /^\d+$/.test(String(current)) && BigInt(value) < BigInt(current);
    };

    function invalidate(reason, pending = false) {
        cache.invalidate();
        onInvalidate({ reason, uncertain: pending });
    }
    function lose(reason) {
        leaseUntil = 0; boundaryAt = Infinity; epoch++;
        if (!uncertain) {
            diagnostics.record("permission-control", "uncertain");
            lastAttempt = -Infinity;
            uncertain = true; cache.setUncertain(true);
            onInvalidate({ reason, uncertain: true });
        }
    }
    function apply(result, reason) {
        const changed = cache.setRevision(result.revision);
        const temporal = state !== null && result.state !== undefined && state !== result.state;
        const contextChanged = context !== null && result.context !== undefined && context !== result.context;
        if (result.context !== undefined) context = result.context;
        if (result.state !== undefined) state = result.state;
        const recovered = uncertain;
        uncertain = false; cache.setUncertain(false);
        if (contextChanged) { cache.invalidate(); onInvalidate({ reason, uncertain: true, contextChanged: true }); }
        else if (result.force || temporal) invalidate(reason);
        else if (changed || recovered) onInvalidate({ reason, uncertain: false });
    }
    async function refresh({ force = false } = {}) {
        if (disposed || inFlight || !online() || now() < retryAt) return;
        if (!force && healthy() && !visible()) return;
        if (!force && now() - lastAttempt < (healthy() ? 60_000 : 5_000)) return;
        diagnostics.record("permission-control", healthy() ? "fallback-healthy" : "fallback-degraded");
        inFlight = true; lastAttempt = now();
        const requestEpoch = epoch;
        try {
            const result = await fetchRevision();
            if (disposed || requestEpoch !== epoch) return;
            if (older(result.revision)) { lose("stale-permission-check"); return; }
            apply(result, "permission-fallback");
            if (Number.isFinite(result.boundary_ms) && result.boundary_ms >= 0) boundaryAt = Math.min(boundaryAt, now() + result.boundary_ms);
            schedule();
        } catch (error) {
            if (disposed || requestEpoch !== epoch) return;
            retryAt = now() + Math.max(5_000, error?.retryAfterMs || 0);
            lose("permission-check-failed");
            if (error?.status === 401 || error?.status === 403) onUnauthorized(error);
        } finally { inFlight = false; }
    }
    function tick() {
        if (disposed) return;
        if ((leaseUntil && (!online() || now() >= leaseUntil)) || now() >= boundaryAt) lose("control-expired");
        refresh(); schedule();
    }
    function schedule() {
        clearTimer(timer);
        if (disposed) return;
        const due = Math.min(leaseUntil || Infinity, boundaryAt);
        timer = setTimer(tick, Math.max(1, Math.min(5_000, due - now())));
    }
    function control(event) {
        if (disposed || event?.event_version !== 2) return;
        const payload = event.payload;
        if (payload?.assignment !== assignmentId || payload?.capabilities?.permissions_revision !== true) return;
        const next = Number(payload.sequence);
        if (!Number.isSafeInteger(next) || next < 1 || !event.entity_id) return;
        const newChannel = channel !== event.entity_id;
        if (retiredChannels.has(event.entity_id)) return;
        if (newChannel && (event.event_type !== "control.ready" || next !== 1)) return;
        if (!newChannel && next <= sequence) return;
        if (!/^\d+$/.test(String(payload.revision)) || typeof payload.state !== "string") return;
        if (older(payload.revision)) return;
        const lease = Number(payload.lease_ms), boundary = Number(payload.boundary_ms);
        if (!Number.isFinite(lease) || lease <= 0 || lease > 45_000 || !Number.isFinite(boundary) || boundary < 0) return;
        if (newChannel) {
            if (channel) retiredChannels.add(channel);
            if (retiredChannels.size > 64) retiredChannels.delete(retiredChannels.values().next().value);
            channel = event.entity_id;
        }
        sequence = next; epoch++;
        diagnostics.record("permission-control", "verified-event");
        leaseUntil = now() + lease;
        boundaryAt = now() + boundary;
        retryAt = 0;
        apply(payload, event.event_type);
        schedule();
    }
    function disconnected() {
        if (disposed) return;
        // Legacy servers never established a control lease: keep their 5s fallback.
        if (channel) lose("control-disconnected");
        schedule();
    }
    function recover() {
        if (disposed) return;
        // Recheck expiry before a suspended/hidden browser reuses cached decisions.
        if ((leaseUntil && (!online() || now() >= leaseUntil)) || now() >= boundaryAt) lose("control-expired");
        refresh({ force: true }); schedule();
    }
    function localChange(revision) {
        if (disposed) return;
        epoch++;
        if (revision !== undefined && older(revision)) return;
        if (revision !== undefined) cache.setRevision(revision);
        invalidate("local-permission-change", uncertain);
    }
    refresh({ force: true }); schedule();
    return { control, disconnected, recover, localChange,
        dispose() { disposed = true; epoch++; clearTimer(timer); },
        snapshot: () => ({ healthy: healthy(), uncertain, intervalMs: healthy() ? 60_000 : 5_000 }) };
}
