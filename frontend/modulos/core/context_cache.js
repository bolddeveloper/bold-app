// Memory only; each owner creates one cache for its authenticated context.
export function createContextCache({ ttlMs = 15 * 60_000, now = () => Date.now() } = {}) {
    const entries = new Map(); let generation = 0;
    return {
        get(key, load) {
            const existing = entries.get(key);
            if (existing && existing.expiresAt > now()) return existing.promise;
            const version = generation, entry = { expiresAt: Infinity, promise: null };
            entry.promise = Promise.resolve().then(load).then(value => {
                if (version !== generation) throw new DOMException("Caché invalidada", "AbortError");
                entry.expiresAt = now() + ttlMs;
                return value;
            }).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
            entries.set(key, entry);
            return entry.promise;
        },
        clear() { generation++; entries.clear(); },
    };
}
