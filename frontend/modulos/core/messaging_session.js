// Receipts share Core's existing authenticated socket. No polling or extra socket.
export function createMessagingSession({employeeId, acknowledge, emit = () => {}, onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
    const pending = new Map(), confirmed = new Map();
    let timer = null, busy = false, stopped = false, failures = 0;
    const abort = new AbortController();
    const keyFor = (conversation, id) => `${conversation}:${id}`;
    function queue(conversation, ids, state) {
        if (stopped) return;
        for (const id of ids.slice(0, 100)) {
            const key = keyFor(conversation, id), rank = state === "read" ? 2 : 1;
            if ((confirmed.get(key) || 0) >= rank) continue;
            const old = pending.get(key);
            if (!old || old.rank < rank) pending.set(key, {conversation, id, state, rank});
        }
        // Bounded memory; dropped items reconcile when paginated history is opened.
        while (pending.size > 1000) pending.delete(pending.keys().next().value);
        if (pending.size && !busy && !timer && failures < 3) timer = setTimer(flush, 180);
    }
    async function flush() {
        timer = null;
        if (stopped || busy || !pending.size) return;
        busy = true;
        const first = pending.values().next().value;
        const batch = [...pending.values()].filter(row => row.conversation === first.conversation && row.state === first.state).slice(0, 100);
        for (const row of batch) pending.delete(keyFor(row.conversation, row.id));
        let retryMs = 180;
        try {
            const result = await acknowledge(first.conversation, batch.map(row => row.id), first.state, {signal: abort.signal});
            if (stopped) return;
            for (const row of batch) confirmed.set(keyFor(row.conversation, row.id), Math.max(confirmed.get(keyFor(row.conversation, row.id)) || 0, row.rank));
            while (confirmed.size > 2000) confirmed.delete(confirmed.keys().next().value);
            failures = 0;
            emit({event_version: 2, event_type: "messaging.receipt.updated", payload: result});
        } catch (error) {
            if (stopped || error.name === "AbortError") return;
            if ([400, 404].includes(error.status)) {onError(error);}
            else {
                failures++;
                for (const row of batch) {const key = keyFor(row.conversation, row.id); if (!pending.has(key) || pending.get(key).rank < row.rank) pending.set(key, row);}
                retryMs = Math.max(error.retryAfterMs || 0, Math.min(60_000, 1000 * 2 ** failures));
                if ([401, 403].includes(error.status)) {stopped = true; onError(error);}
                else if (failures >= 3) onError(error);
            }
        } finally {
            busy = false;
            if (!stopped && pending.size && failures < 3) timer = setTimer(flush, retryMs);
        }
    }
    function receive(envelope) {
        if(!stopped && envelope?.event_version===2 && envelope.event_type==='messaging.reactions.updated'){emit(envelope);return;}
        if (stopped || envelope?.event_version !== 2 || !["messaging.message.created", "messaging.message.updated", "messaging.receipt.updated", "messaging.sync"].includes(envelope.event_type)) return;
        emit(envelope);
        for (const message of (envelope.payload?.messages || []).slice(0, 100)) {
            if (message.author_id !== employeeId && !message.delivered_at) queue(message.conversation_id, [message.id], "delivered");
        }
    }
    return {
        receive,
        delivered: (conversation, ids) => queue(conversation, ids, "delivered"),
        read: (conversation, ids) => queue(conversation, ids, "read"),
        recover() {if (!stopped && !busy && pending.size) {failures = 0; clearTimer(timer); timer = setTimer(flush, 180);}},
        dispose() {stopped = true; clearTimer(timer); abort.abort(); pending.clear(); confirmed.clear();},
    };
}
