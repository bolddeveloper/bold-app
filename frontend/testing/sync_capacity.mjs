// Runs the real connection/permission lifecycle with simulated transport/time.
// No fetch, real WebSocket, credentials, customer data or Cloudflare quota.
import { getEventListeners, setMaxListeners } from "node:events";
import { createPermissionMonitor } from "../modulos/core/permission_monitor.js";
import { createPermissionCache } from "../modulos/core/permission_cache.js";
import { createNotificationRealtime } from "../modulos/core/session_realtime.js";
import { createTicketQueue } from "../modulos/core/realtime_channel.js";
import { createSyncDiagnostics } from "../modulos/core/sync_diagnostics.js";
import { createRealtimeAdapter } from "../modulos/tareas/src/services/realtime_adapter.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
export async function simulateSyncCapacity({ clients = 5, units = 1, hiddenTabs = 0, minutes = 60 } = {}) {
    if (![clients, units, minutes].every(n => Number.isInteger(n) && n > 0) || clients > 25 || units > 13 || minutes > 60
        || !Number.isInteger(hiddenTabs) || hiddenTabs < 0 || hiddenTabs > clients) throw new Error("Escenario simulado fuera de límites.");
    let time = 0, timerId = 0;
    const timers = new Map(), tabs = [];
    const setTimer = (fn, delay) => { timers.set(++timerId, { fn, at: time + delay }); return timerId; };
    const clearTimer = key => timers.delete(key);
    async function advance(ms) {
        const end = time + ms;
        for (;;) {
            const due = Math.min(...[...timers.values()].map(job => job.at));
            if (due > end) break;
            time = due;
            for (const [key, job] of [...timers]) if (job.at <= time) { timers.delete(key); job.fn(); }
            await flush();
        }
        time = end; await flush();
    }
    for (let index = 0; index < clients; index++) {
        const diagnostics = createSyncDiagnostics({ enabled: true, now: () => time, buildVersion: "simulation" });
        const sockets = [];
        let activeTickets = 0, peakTickets = 0, invalidations = 0, sequence = 0;
        class Socket {
            constructor() {
                this.readyState = 0; this.handlers = {}; sockets.push(this);
                queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.emit("open"); } });
            }
            addEventListener(name, fn) { this.handlers[name] = fn; }
            emit(name, detail) { this.handlers[name]?.(detail); }
            close() { this.readyState = 3; this.emit("close", { code: 1000 }); }
        }
        const assignmentId = `synthetic-${index}`;
        const cache = createPermissionCache({ now: () => time, authorize: async () => ({ allowed: true, policy_revision: 1 }) });
        const monitor = createPermissionMonitor({ assignmentId, cache, diagnostics, now: () => time,
            visible: () => index >= hiddenTabs, online: () => true, setTimer, clearTimer,
            fetchRevision: async () => {
                diagnostics.beginHttp("/api/v2/permissions/revision/", "GET")(200);
                return { revision: 1, state: "stable" };
            }, onInvalidate: () => invalidations++ });
        const getTicket = async () => {
            activeTickets++; peakTickets = Math.max(peakTickets, activeTickets);
            await flush(); activeTickets--;
            diagnostics.beginHttp("/api/v2/auth/websocket-ticket/", "POST")(200);
            return { ticket: "synthetic-only" };
        };
        // Like a browser tab: one shared queue for its Core and unit channels.
        const eventTarget = new EventTarget();
        // A tab intentionally has up to 14 channels, not Node's default 10.
        // Keep the limit finite and explicitly assert listeners are removed below.
        setMaxListeners(16, eventTarget);
        const deps = { WebSocketImpl: Socket, ticketQueue: createTicketQueue(2), diagnostics,
            setTimer, clearTimer, now: () => time, online: () => true, eventTarget, random: () => 0 };
        const core = createNotificationRealtime(deps), tasks = createRealtimeAdapter(deps);
        const pending = [core.connect({ assignmentId, getTicket, onControl: event => monitor.control(event), baseUrl: "https://synthetic.invalid" })];
        for (let unit = 0; unit < units; unit++) pending.push(tasks.connect({ unitId: `unit-${unit}`, assignmentId, getTicket, baseUrl: "https://synthetic.invalid" }));
        await Promise.all(pending); await flush();
        const heartbeat = (revision = 1, state = "stable", force = false) => sockets[0].emit("message", { data: JSON.stringify({
            event_version: 2, event_type: sequence ? "permissions.revision" : "control.ready", entity_id: `control-${index}`,
            payload: { assignment: assignmentId, capabilities: { permissions_revision: true }, sequence: ++sequence,
                revision, state, force, lease_ms: 45000, boundary_ms: 86400000 },
        }) });
        heartbeat();
        tabs.push({ diagnostics, sockets, heartbeat, cache, monitor, eventTarget, peak: () => peakTickets, invalidations: () => invalidations,
            stop: () => { tasks.disconnect(); core.disconnect(); monitor.dispose(); } });
    }
    const initial = tabs.reduce((sum, tab) => sum + (tab.diagnostics.snapshot().counters["http:GET /api/v2/permissions/revision"] || 0), 0);
    for (let i = 0; i < minutes * 2; i++) { await advance(30000); tabs.forEach(tab => tab.heartbeat()); }
    const snapshots = tabs.map(tab => tab.diagnostics.snapshot());
    const report = {
        scope: "simulated-time-and-transport-not-production-capacity", clients, unitsPerTab: units, hiddenTabs, simulatedMinutes: minutes,
        initialRevisionReads: initial,
        periodicRevisionReads: snapshots.reduce((sum, snap) => sum + (snap.counters["http:GET /api/v2/permissions/revision"] || 0), 0) - initial,
        initialTickets: snapshots.reduce((sum, snap) => sum + (snap.counters["http:POST /api/v2/auth/websocket-ticket"] || 0), 0),
        openSockets: tabs.reduce((sum, tab) => sum + tab.sockets.filter(socket => socket.readyState === 1).length, 0),
        peakConcurrentTicketsPerTab: Math.max(...tabs.map(tab => tab.peak())),
        idleInvalidations: tabs.reduce((sum, tab) => sum + tab.invalidations(), 0),
    };
    // Every tab keeps its own authenticated control; hiding does not suppress revocation.
    tabs.forEach(tab => tab.heartbeat(2, "revoked", true));
    report.revokedTabs = tabs.filter(tab => tab.cache.getRevision() === "2" || tab.cache.getRevision() === 2).length;
    tabs.forEach(tab => tab.stop());
    report.remainingTimers = timers.size;
    report.remainingSockets = tabs.reduce((sum, tab) => sum + tab.sockets.filter(socket => socket.readyState !== 3).length, 0);
    report.remainingOnlineListeners = tabs.reduce((sum, tab) => sum + getEventListeners(tab.eventTarget, "online").length, 0);
    return report;
}
