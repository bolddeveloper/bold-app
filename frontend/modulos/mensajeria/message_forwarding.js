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
export async function forwardMessageBatch(batch, employeeId, forward, {signal, onConfirmed, onProgress, checkpoint=async()=>{}} = {}) {
    if (batch.employeeId && batch.employeeId !== employeeId) throw new Error("El destinatario no puede cambiar durante un reintento del lote.");
    if (batch.running) return batch.running;
    signal?.throwIfAborted(); batch.employeeId = employeeId;
    batch.running = (async () => {
        await checkpoint(); signal?.throwIfAborted();
        while (batch.pending.length) {
            signal?.throwIfAborted();
            onProgress?.({current:batch.confirmed + (batch.discarded || 0) + 1, total:batch.total});
            const source = batch.pending[0];
            const result = await forward(source, employeeId, {signal});
            batch.pending.shift(); batch.confirmed++;
            await checkpoint();
            if (!signal?.aborted) onConfirmed?.(result, source);
        }
        return {confirmed:batch.confirmed, total:batch.total};
    })();
    try {return await batch.running;} finally {batch.running = null;}
}

// By default session-local; durable reviews supply their private attempt map
// and mandatory checkpoint. Never export a Drive ID, source chat link or author.
export function createMessageForwarder(api, makeId = () => crypto.randomUUID(), {pending=new Map(),checkpoint=async()=>{},revalidate=false}={}) {
    const destinations = new Map();
    return async function forward(source, employeeId, {signal} = {}) {
        if (!canForward(source)) throw new Error("Solo se pueden reenviar mensajes de texto e imágenes.");
        const key = `${source.conversation_id}:${source.id}:${source.version}:${employeeId}`;
        let attempt = pending.get(key);
        if (!attempt) {
            if (pending.size >= 20) throw new Error("Confirma los reenvíos pendientes antes de iniciar más.");
            attempt = {id: makeId(), body: source.body || "", source: snapshot(source)};
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
            if(attempt.destinationId && attempt.destinationId!==conversation.id)throw Error("El destino del reenvío no coincide. Conservamos el intento para revisarlo.");
            attempt.destinationId=conversation.id;
            if(revalidate){
                const current=await api.message(attempt.source.conversation_id,attempt.source.id,{signal});
                signal?.throwIfAborted();
                if(!current?.message || current.message.id!==attempt.source.id)throw Error("No se pudo verificar el mensaje de origen.");
                if(!attempt.writeStarted && current.message.version!==attempt.source.version)throw Error("El mensaje de origen cambió. Descarta esta revisión y selecciona su versión actual.");
                if(attempt.writeStarted){
                    const published=await api.resolveIntent(conversation.id,attempt.id,{signal});
                    signal?.throwIfAborted();
                    if(published?.message){pending.delete(key);return {...published,conversation};}
                }
            }
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
            // Durable callers must protect the immutable nonce AND actual file
            // bytes before any message/upload request can reach the server.
            await checkpoint();signal?.throwIfAborted();
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
