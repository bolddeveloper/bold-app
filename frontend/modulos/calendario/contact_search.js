// Caché limitada al campo de invitados y su cuenta; nunca persiste contactos.
export function createContactSearch(fetchContacts, {prepare = true} = {}) {
    let warmup = null;
    const cached = new Map();
    const warm = () => warmup ||= fetchContacts("", {signal: AbortSignal.timeout(6000)}).catch(() => null);
    return {warm, async search(query, signal) {
        signal.throwIfAborted();
        const key = query.trim().toLowerCase(), saved = cached.get(key);
        if (saved && Date.now()-saved.time < 60000) return saved.value;
        if (prepare) await warm();
        signal.throwIfAborted();
        const result = await fetchContacts(key, {signal});
        signal.throwIfAborted();
        cached.set(key,{time:Date.now(),value:result});
        if (cached.size>20) cached.delete(cached.keys().next().value);
        return result;
    }};
}

export function mergeContactSuggestions(previous, incoming) {
    const rows = new Map();
    for (const person of [...previous, ...incoming]) {
        if (!person.email) continue;
        const email = person.email.trim().toLowerCase();
        rows.set(email, {...person, email, name: person.name || rows.get(email)?.name || ""});
    }
    return [...rows.values()].slice(-400);
}
