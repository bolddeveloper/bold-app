// Aggregate, opt-in counters only. Never retain URLs, queries, payloads or identities.
export function diagnosticRoute(path) {
    const parts = new URL(path, "http://diagnostic.invalid").pathname.split("/").filter(Boolean);
    const safe = new Set(["api", "v2", "auth", "core", "permissions", "administration", "notifications", "suggestions", "calendar", "projects", "sections", "task-statuses", "tasks", "task-projects", "comments", "task-followers", "project-members", "attachments", "task-tags", "tags", "revision", "authorize", "websocket-ticket", "session", "login", "logout", "mfa", "verify", "step-up", "totp", "setup", "confirm", "disable", "bulk", "move", "mark-read", "mark-unread", "unread-count", "mark-all-read"]);
    return "/" + parts.map(part => safe.has(part) ? part : ":id").join("/");
}

export function createSyncDiagnostics({ enabled = false, now = () => Date.now(), buildVersion = "local" } = {}) {
    let startedAt = now(), active = 0, peak = 0;
    const counters = new Map();
    function record(kind, label = "total") {
        if (!enabled) return;
        const key = `${kind}:${label}`;
        if (!counters.has(key) && counters.size >= 256) return;
        counters.set(key, (counters.get(key) || 0) + 1);
    }
    function beginHttp(path, method) {
        if (!enabled) return () => {};
        const label = `${method.toUpperCase()} ${diagnosticRoute(path)}`;
        const start = now(); let finished = false;
        active++; peak = Math.max(peak, active); record("http", label);
        return status => {
            if (finished) return;
            finished = true; active--;
            record("http-result", `${label} ${status}`);
            const elapsed = Math.max(0, now() - start);
            record("duration", elapsed < 250 ? "under-250ms" : elapsed < 1000 ? "under-1s" : elapsed < 5000 ? "under-5s" : "over-5s");
        };
    }
    return { record, beginHttp,
        snapshot: () => ({ enabled, buildVersion, startedAt, elapsedMs: now() - startedAt, activeHttp: active, peakHttp: peak, counters: Object.fromEntries(counters) }),
        reset() { counters.clear(); startedAt = now(); peak = active; },
    };
}

export const syncDiagnostics = createSyncDiagnostics({ enabled: import.meta.env?.VITE_SYNC_DIAGNOSTICS === "true", buildVersion: import.meta.env?.VITE_APP_VERSION || "local" });
if (typeof window !== "undefined" && import.meta.env?.VITE_SYNC_DIAGNOSTICS === "true") {
    window.boldSyncDiagnostics = { snapshot: syncDiagnostics.snapshot, reset: syncDiagnostics.reset };
}
