const PREFIX = "bold-module-view:v1:", MAX_BYTES = 4 * 1024 * 1024;
export const moduleScope = core => core.account?.id && core.activeAssignment?.id
    ? `${core.account.id}:${core.activeAssignment.id}` : "";

export function createModuleCache(storage = () => globalThis.localStorage) {
    let generation = 0;
    const entries = store => Array.from({length: store.length}, (_, i) => store.key(i)).filter(key => key?.startsWith(PREFIX));
    return {
        get generation() { return generation; },
        read(scope, key) {
            if (!scope) return null;
            try { return JSON.parse(storage().getItem(`${PREFIX}${scope}:${key}`))?.value ?? null; }
            catch { return null; }
        },
        write(scope, key, value, expectedGeneration = generation) {
            if (!scope || expectedGeneration !== generation) return;
            try {
                const store = storage(), id = `${PREFIX}${scope}:${key}`;
                const serialized = JSON.stringify({saved: Date.now(), value});
                if (serialized.length * 2 > MAX_BYTES) return;
                const rows = entries(store).filter(entry => entry !== id).flatMap(entry => {
                    try {const raw = store.getItem(entry), saved = JSON.parse(raw)?.saved || 0; return [{id: entry, raw, saved}];}
                    catch {store.removeItem(entry); return [];}
                });
                rows.sort((a, b) => a.saved - b.saved);
                let size = serialized.length * 2 + rows.reduce((total, row) => total + row.raw.length * 2, 0);
                for (const row of rows) { if (size <= MAX_BYTES) break; store.removeItem(row.id); size -= row.raw.length * 2; }
                try { store.setItem(id, serialized); }
                catch { for (const row of rows) store.removeItem(row.id); store.setItem(id, serialized); }
            } catch { /* Storage is optional; server data remains authoritative. */ }
        },
        suspend() { generation++; },
        invalidate(scope, prefix = "") {
            generation++;
            try { const store = storage(); for (const key of entries(store)) if (!scope || key.startsWith(`${PREFIX}${scope}:${prefix}`)) store.removeItem(key); } catch {}
        },
    };
}
export const moduleCache = createModuleCache();
globalThis.addEventListener?.("bold:private-cache-suspend", () => moduleCache.suspend());
globalThis.addEventListener?.("bold:permissions-revision", () => moduleCache.invalidate());
globalThis.addEventListener?.("bold:private-cache-clear", () => moduleCache.invalidate());
globalThis.addEventListener?.("storage", event => { if (event.key?.startsWith(PREFIX)) moduleCache.suspend(); });
