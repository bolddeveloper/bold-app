// Cachés Google aisladas por cuenta y cargo; IndexedDB con respaldo en memoria.
const TTL = Infinity, MAX_BYTES = 10 * 1024 * 1024, MAX_ENTRIES = 100;
export function cacheScope(connection, assignment) { return connection?.connected && connection.connection_key ? `${connection.connection_key}:${assignment || "default"}` : ""; }
export function createGoogleCache({ now = () => Date.now(), indexedDB = globalThis.indexedDB, name = "bold-google-metadata", ttl = TTL, maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES } = {}) {
    const rows = new Map(); let database, failed = !indexedDB, queue = Promise.resolve(), epoch = 0;
    function db() {
        return database ||= new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () => request.result.createObjectStore("entries", {keyPath: "id"});
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("IndexedDB bloqueado"));
        });
    }
    async function storage(action, value) {
        if (failed) return;
        try {
            const store = await db();
            return await new Promise((resolve, reject) => {
                const transaction = store.transaction("entries", action === "getAll" ? "readonly" : "readwrite");
                const request = transaction.objectStore("entries")[action](...(value === undefined ? [] : [value]));
                let result; request.onsuccess = () => {result = request.result;};
                transaction.oncomplete = () => resolve(result); transaction.onerror = transaction.onabort = () => reject(transaction.error);
            });
        } catch { failed = true; }
    }
    function run(operation) { const job = queue.then(operation); queue = job.catch(() => {}); return job; }
    async function hydrate() { if (rows.size) return; for (const row of await storage("getAll") || []) rows.set(row.id, row); }
    async function prune() {
        const ordered = [...rows.values()].sort((a, b) => b.used - a.used); let bytes = 0, count = 0;
        for (const row of ordered) {
            if (now() - row.saved > ttl || bytes + row.size > maxBytes || count + 1 > maxEntries) {rows.delete(row.id); await storage("delete", row.id);}
            else {bytes += row.size; count++;}
        }
    }
    return {
        get(scope, key) { return run(async () => {if (!scope) return null; await hydrate(); const row = rows.get(`${scope}:${key}`); if (!row) return null; if (now() - row.saved > ttl) {rows.delete(row.id); await storage("delete", row.id); return null;} row.used = now(); await storage("put", row); return structuredClone(row.value);}); },
        put(scope, key, value) { const generation = epoch; return run(async () => {if (!scope || generation !== epoch) return; await hydrate(); const clean = structuredClone(value); const row = {id: `${scope}:${key}`, scope, key, value: clean, saved: now(), used: now(), size: clean instanceof Blob ? clean.size : new TextEncoder().encode(JSON.stringify(clean)).length}; if (row.size > maxBytes) return; rows.set(row.id, row); await storage("put", row); await prune();}); },
        invalidate(scope, prefix = "") { return run(async () => {await hydrate(); for (const row of [...rows.values()]) if (row.scope === scope && row.key.startsWith(prefix)) {rows.delete(row.id); await storage("delete", row.id);}}); },
        suspend() { epoch++; },
        clear() { epoch++; return run(async () => {rows.clear(); await storage("clear");}); },
    };
}
export const googleCache = createGoogleCache();
export const googleThumbnailCache = createGoogleCache({name: "bold-google-thumbnails", ttl: Infinity, maxBytes: 100 * 1024 * 1024, maxEntries: 2000});
export async function confirmGoogleConnection(connection) {
    const key = `bold-google-account:${connection.preference_key || ""}`;
    try {const previous = localStorage.getItem(key), current = connection.connection_key || ""; if (previous && previous !== current) await Promise.all([googleCache.clear(), googleThumbnailCache.clear()]); localStorage.setItem(key, current);} catch {}
    return connection;
}
let connectionGeneration = 0;
const channel = typeof window !== "undefined" && globalThis.BroadcastChannel ? new BroadcastChannel("bold-google-cache") : null;
export function clearGoogleCache() { connectionGeneration++; googleCache.clear(); googleThumbnailCache.clear(); channel?.postMessage("clear"); globalThis.dispatchEvent?.(new Event("bold:google-cache-cleared")); }
export function suspendGoogleCache(broadcast = true) {
    connectionGeneration++; googleCache.suspend(); googleThumbnailCache.suspend();
    if (broadcast) channel?.postMessage("suspend");
    globalThis.dispatchEvent?.(new Event("bold:google-cache-cleared"));
}
channel?.addEventListener("message", event => {
    if (event.data === "suspend") {suspendGoogleCache(false); return;}
    connectionGeneration++; googleCache.clear(); googleThumbnailCache.clear(); globalThis.dispatchEvent?.(new Event("bold:google-cache-cleared"));
});
globalThis.addEventListener?.("bold:unauthorized", () => suspendGoogleCache());

// Solo actualiza módulos visibles; foco y reconexión reutilizan la operación activa.
export function backgroundRefresh(refresh, {interval = 60000, now = () => Date.now(), document = globalThis.document, target = globalThis} = {}) {
    let last = now();
    const run = force => {if (document?.visibilityState === "hidden" || target.navigator?.onLine === false || !force && now() - last < 30000) return; last = now(); refresh();};
    const visible = () => run(false), online = () => run(true), timer = target.setInterval(() => run(true), interval);
    target.addEventListener?.("focus", visible); target.addEventListener?.("online", online); document?.addEventListener("visibilitychange", visible);
    return () => {target.clearInterval(timer); target.removeEventListener?.("focus", visible); target.removeEventListener?.("online", online); document?.removeEventListener("visibilitychange", visible);};
}

// Restore the last authenticated account before refreshing its connection status.
export async function restoreGoogleConnection(scope, service, load, publish) {
    const generation = connectionGeneration;
    const saved = await googleCache.get(scope, `connection:${service}`);
    if (generation !== connectionGeneration) return;
    if (saved?.connected) publish(saved);
    const current = await load();
    if (generation !== connectionGeneration) return;
    await googleCache.put(scope, `connection:${service}`, current);
    if (generation === connectionGeneration) publish(current);
    return current;
}
export function cachedContentChanged(before, after) {
    const stable = value => {
        if (Array.isArray(value)) return value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
        return value;
    };
    return Boolean(before) && JSON.stringify(stable(before)) !== JSON.stringify(stable(after));
}
export function announceBackgroundUpdate(title) {
    globalThis.dispatchEvent?.(new CustomEvent("bold:background-update", {detail: {title}}));
}
globalThis.addEventListener?.("bold:private-cache-clear", clearGoogleCache);

globalThis.addEventListener?.("bold:private-cache-suspend", () => suspendGoogleCache());
