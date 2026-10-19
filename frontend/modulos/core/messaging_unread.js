// One bootstrap/recovery read, then versioned pushes. No idle polling.
export function createMessagingUnread({fetchSummary, onChange = () => {}, now = Date.now} = {}) {
    const rows = new Map();
    let stopped = false, pending = null, last = -Infinity, retryAt = 0, mutations = 0;
    const abort = new AbortController();
    function snapshot() {
        const byEmployee = {}, byConversation = Object.fromEntries(rows);
        let total = 0;
        for (const row of rows.values()) {
            total += row.count;
            byEmployee[row.employee_id] = (byEmployee[row.employee_id] || 0) + row.count;
        }
        return {byConversation, byEmployee, total};
    }
    function apply(row) {
        if (!row?.conversation_id || !row.employee_id || !Number.isSafeInteger(row.version)
            || !Number.isSafeInteger(row.count) || row.count < 0) return;
        const old = rows.get(row.conversation_id);
        if (!old || row.version >= old.version) rows.set(row.conversation_id, {...row, touched: ++mutations});
    }
    return {
        receive(event) {
            if (stopped || event?.event_version !== 2 || !event.event_type?.startsWith("messaging.")) return;
            if (event.payload?.unread) {apply(event.payload.unread); onChange(snapshot());}
        },
        recover() {
            if (stopped || pending || now() < retryAt || now() - last < 15_000) return pending;
            last = now(); const boundary = mutations;
            pending = Promise.resolve().then(() => fetchSummary({signal: abort.signal})).then(value => {
                if (stopped) return;
                const present = new Set((value.conversations || []).map(row => row.conversation_id));
                for (const [id,row] of rows) if (!present.has(id) && row.touched <= boundary) rows.delete(id);
                for (const row of value.conversations || []) apply(row);
                retryAt = 0; onChange(snapshot());
            }).catch(error => {
                if (stopped || error.name === "AbortError") return;
                retryAt = now() + Math.max(60_000,error.retryAfterMs || 0);
                if ([401,403].includes(error.status)) {rows.clear(); onChange(snapshot());}
            }).finally(() => {pending = null;});
            return pending;
        },
        snapshot,
        dispose() {stopped = true; abort.abort(); rows.clear();},
    };
}
