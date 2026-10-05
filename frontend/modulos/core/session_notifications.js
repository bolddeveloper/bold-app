import { http } from "./http_client.js";
import { contentCanRefresh, createRefreshCoordinator } from "./refresh_coordinator.js";

// One store per authenticated assignment. No domain imports or cross-user cache.
export function createSessionNotifications({ client = http, onChange = () => {}, canRun = contentCanRefresh, coordinatorOptions = {} } = {}) {
    let rows = [], epoch = 0, writeRevision = 0, disposed = false, uncertain = false;
    let controller = new AbortController();
    const mutations = new Map();
    const committed = new Map();
    const publish = next => { rows = next; if (!disposed) onChange(rows); };
    const valid = version => !disposed && !uncertain && epoch === version;
    const abort = () => new DOMException("Contexto de notificaciones cancelado", "AbortError");
    const coordinator = createRefreshCoordinator({ ...coordinatorOptions, canRun,
        run: async () => {
            if (disposed || uncertain) return;
            const version = epoch, revision = writeRevision;
            const next = await client.list("notifications", {}, { signal: controller.signal });
            if (!valid(version)) return;
            const visible = new Set(next.map(row => String(row.id)));
            for (const [id, commit] of committed) if (!visible.has(id) || commit.revision <= revision) committed.delete(id);
            publish(next.map(row => {
                const id = String(row.id), mutation = mutations.get(id), commit = committed.get(id);
                // A stale list can still deliver new notifications, without
                // undoing a write that completed after that list started.
                const accepted = commit ? { ...row, is_read: commit.is_read, read_at: commit.read_at } : row;
                return mutation ? { ...accepted, is_read: mutation.desired } : accepted;
            }));
        },
    });
    const refresh = options => disposed || uncertain ? Promise.resolve() : coordinator.request(options);
    function invalidate({ uncertain: pending = false } = {}) {
        epoch++; uncertain = pending; controller.abort(); controller = new AbortController();
        mutations.clear(); committed.clear(); publish([]);
        return refresh({ reason: "permissions", security: true });
    }
    function setRead(id, desired) {
        if (disposed || uncertain) return Promise.reject(abort());
        const key = String(id), row = rows.find(item => String(item.id) === key);
        if (!row) return Promise.resolve();
        let mutation = mutations.get(key);
        if (!mutation) {
            mutation = { desired: Boolean(desired), confirmed: row, promise: null };
            mutations.set(key, mutation);
        } else mutation.desired = Boolean(desired);
        publish(rows.map(item => String(item.id) === key ? { ...item, is_read: mutation.desired } : item));
        if (mutation.promise) return mutation.promise;
        const version = epoch;
        mutation.promise = (async () => {
            try {
                while (valid(version) && mutations.get(key) === mutation && Boolean(mutation.confirmed.is_read) !== mutation.desired) {
                    const requested = mutation.desired;
                    const accepted = await client.request(`/api/v2/notifications/${id}/${requested ? "mark-read" : "mark-unread"}/`, { method: "POST", signal: controller.signal });
                    if (!valid(version)) throw abort();
                    // Use the authorized write response; no extra list GET per click.
                    mutation.confirmed = accepted; writeRevision++;
                    committed.set(key, { revision: writeRevision, is_read: accepted.is_read, read_at: accepted.read_at });
                    publish(rows.map(item => String(item.id) === key ? { ...accepted, is_read: mutation.desired } : item));
                }
                if (!valid(version)) throw abort();
            } catch (error) {
                if (valid(version)) publish(rows.map(item => String(item.id) === key ? mutation.confirmed : item));
                throw error;
            } finally {
                if (mutations.get(key) === mutation) mutations.delete(key);
            }
        })();
        return mutation.promise;
    }
    async function clear() {
        if (disposed || uncertain) throw abort();
        await Promise.allSettled([...mutations.values()].map(item => item.promise));
        const version = epoch;
        await client.request("/api/v2/notifications/clear/", {method: "POST", signal: controller.signal});
        if (!valid(version)) throw abort();
        epoch++; controller.abort(); controller = new AbortController(); committed.clear(); publish([]);
        await refresh({reason: "notification-clear", immediate: true});
    }
    return { getRows: () => rows, refresh, invalidate, setRead, clear,
        dispose() { disposed = true; epoch++; controller.abort(); coordinator.dispose(); mutations.clear(); committed.clear(); rows = []; },
    };
}
