import {imageFileError} from "./media_helpers.js";

export const MAX_FORWARD_MESSAGES = 10;

export function canForward(message) {
    return !!message && (!message.media || message.media.kind === "image") && !!(message.body?.trim() || message.media);
}

const snapshot = row => ({...row, media: row.media && {...row.media}});

export function toggleForwardSelection(current, message) {
    if (current.some(row => row.id === message.id)) return current.filter(row => row.id !== message.id);
    if (!canForward(message)) throw new Error("Selecciona mensajes de texto o imágenes.");
    if (current.length >= MAX_FORWARD_MESSAGES) throw new Error(`Puedes reenviar hasta ${MAX_FORWARD_MESSAGES} mensajes a la vez.`);
    return [...current, snapshot(message)];
}

export function createForwardBatch(sources) {
    const rows = [...new Map(sources.map(row => [row.id, row])).values()];
    if (!rows.length || rows.length > MAX_FORWARD_MESSAGES || rows.some(row => !canForward(row))) throw new Error(`Selecciona de uno a ${MAX_FORWARD_MESSAGES} mensajes de texto o imágenes.`);
    if (new Set(rows.map(row => row.conversation_id)).size !== 1) throw new Error("Selecciona mensajes de una misma conversación.");
    rows.sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
    return {pending:rows.map(snapshot), total:rows.length, confirmed:0, employeeId:null, running:null};
}

// This is a serial, resumable batch, not an all-or-nothing server transaction.
export async function forwardMessageBatch(batch, employeeId, forward, {signal, onConfirmed, onProgress} = {}) {
    if (batch.employeeId && batch.employeeId !== employeeId) throw new Error("El destinatario no puede cambiar durante un reintento del lote.");
    if (batch.running) return batch.running;
    signal?.throwIfAborted(); batch.employeeId = employeeId;
    batch.running = (async () => {
        while (batch.pending.length) {
            signal?.throwIfAborted();
            onProgress?.({current:batch.confirmed + 1, total:batch.total});
            const source = batch.pending[0];
            const result = await forward(source, employeeId, {signal});
            batch.pending.shift(); batch.confirmed++;
            if (!signal?.aborted) onConfirmed?.(result, source);
        }
        return {confirmed:batch.confirmed, total:batch.total};
    })();
    try {return await batch.running;} finally {batch.running = null;}
}

// Session-local retries. Do not expose a Drive id, source chat link or author to
// the destination. The server authorizes both media downloads and new sends.
export function createMessageForwarder(api, makeId = () => crypto.randomUUID()) {
    const pending = new Map(), destinations = new Map();
    return async function forward(source, employeeId, {signal} = {}) {
        if (!canForward(source)) throw new Error("Solo se pueden reenviar mensajes de texto e imágenes.");
        const key = `${source.conversation_id}:${source.id}:${source.version}:${employeeId}`;
        let attempt = pending.get(key);
        if (!attempt) {
            if (pending.size >= 20) throw new Error("Confirma los reenvíos pendientes antes de iniciar más.");
            attempt = {id: makeId(), body: source.body || "", source: {...source, media: source.media && {...source.media}}};
            pending.set(key, attempt);
        }
        if (attempt.running) return attempt.running;
        attempt.running = (async () => {
            signal?.throwIfAborted();
            // Reuse the canonical pair during this module session so a ten-item
            // batch does not spend ten conversation-open requests. Every send
            // still checks participant and pilot permissions on the server.
            let conversation = destinations.get(employeeId);
            if (!conversation) {
                conversation = await api.open(employeeId, {signal});
                signal?.throwIfAborted(); destinations.set(employeeId, conversation);
            }
            signal?.throwIfAborted();
            if (attempt.source.media && !attempt.file) {
                const blob = await api.media(attempt.source.conversation_id, attempt.source.id, {signal});
                signal?.throwIfAborted();
                const problem = imageFileError(blob);
                if (problem) throw new Error(problem);
                const extension = {"image/webp":"webp", "image/png":"png", "image/jpeg":"jpg"}[blob.type];
                attempt.file = new File([blob], `imagen-reenviada.${extension}`, {type: blob.type});
            }
            signal?.throwIfAborted();
            attempt.writeStarted = true;
            const result = attempt.file
                ? await api.sendMedia(conversation.id, attempt.body, attempt.id, attempt.file, {signal})
                : await api.send(conversation.id, attempt.body, attempt.id, {signal});
            pending.delete(key);
            return {...result, conversation};
        })();
        try {return await attempt.running;}
        catch (error) {
            if ([403,404].includes(error?.status)) destinations.delete(employeeId);
            // No send was made: do not retain failed authorization/downloads as
            // uncertain deliveries, or let them exhaust the pending retry budget.
            if (!attempt.writeStarted && pending.get(key) === attempt) pending.delete(key);
            throw error;
        } finally {attempt.running = null;}
    };
}
