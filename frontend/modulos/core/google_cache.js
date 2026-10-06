// Caché Google: solo metadatos, aislados por cuenta y cargo; IndexedDB con respaldo en memoria.
const TTL = 24 * 60 * 60 * 1000, MAX_BYTES = 10 * 1024 * 1024, MAX_ENTRIES = 100;
export function cacheScope(connection, assignment) { return connection?.connected && connection.connection_key ? `${connection.connection_key}:${assignment || "default"}` : ""; }
export function createGoogleCache({ now = () => Date.now(), indexedDB = globalThis.indexedDB } = {}) {
    const rows = new Map(); let database, failed = !indexedDB, queue = Promise.resolve(), epoch = 0;
    function db() {
        return database ||= new Promise((resolve, reject) => {
            const request = indexedDB.open("bold-google-metadata", 1);
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
            if (now() - row.saved > TTL || bytes + row.size > MAX_BYTES || count + 1 > MAX_ENTRIES) {rows.delete(row.id); await storage("delete", row.id);}
            else {bytes += row.size; count++;}
        }
    }
    return {
        get(scope, key) { return run(async () => {if (!scope) return null; await hydrate(); const row = rows.get(`${scope}:${key}`); if (!row) return null; if (now() - row.saved > TTL) {rows.delete(row.id); await storage("delete", row.id); return null;} row.used = now(); await storage("put", row); return structuredClone(row.value);}); },
        put(scope, key, value) { const generation = epoch; return run(async () => {if (!scope || generation !== epoch) return; await hydrate(); const clean = structuredClone(value), encoded = JSON.stringify(clean); const row = {id: `${scope}:${key}`, scope, key, value: clean, saved: now(), used: now(), size: new TextEncoder().encode(encoded).length}; if (row.size > MAX_BYTES) return; rows.set(row.id, row); await storage("put", row); await prune();}); },
        invalidate(scope, prefix = "") { return run(async () => {await hydrate(); for (const row of [...rows.values()]) if (row.scope === scope && row.key.startsWith(prefix)) {rows.delete(row.id); await storage("delete", row.id);}}); },
        clear() { epoch++; return run(async () => {rows.clear(); await storage("clear");}); },
    };
}
export const googleCache = createGoogleCache();
export async function confirmGoogleConnection(connection) {
    const key = `bold-google-account:${connection.preference_key || ""}`;
    try {const previous = localStorage.getItem(key), current = connection.connection_key || ""; if (previous && previous !== current) await googleCache.clear(); localStorage.setItem(key, current);} catch {}
    return connection;
}
const channel = typeof window !== "undefined" && globalThis.BroadcastChannel ? new BroadcastChannel("bold-google-cache") : null;
export function clearGoogleCache() { googleCache.clear(); channel?.postMessage("clear"); globalThis.dispatchEvent?.(new Event("bold:google-cache-cleared")); }
channel?.addEventListener("message", () => {googleCache.clear(); globalThis.dispatchEvent?.(new Event("bold:google-cache-cleared"));});
globalThis.addEventListener?.("bold:unauthorized", clearGoogleCache);

// Solo actualiza módulos visibles; foco y reconexión reutilizan la operación activa.
export function backgroundRefresh(refresh, {interval = 60000, now = () => Date.now(), document = globalThis.document, target = globalThis} = {}) {
    let last = now();
    const run = force => {if (document?.visibilityState === "hidden" || target.navigator?.onLine === false || !force && now() - last < 30000) return; last = now(); refresh();};
    const visible = () => run(false), online = () => run(true), timer = target.setInterval(() => run(true), interval);
    target.addEventListener?.("focus", visible); target.addEventListener?.("online", online); document?.addEventListener("visibilitychange", visible);
    return () => {target.clearInterval(timer); target.removeEventListener?.("focus", visible); target.removeEventListener?.("online", online); document?.removeEventListener("visibilitychange", visible);};
}
