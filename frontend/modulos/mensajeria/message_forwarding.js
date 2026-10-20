import {imageFileError} from "./media_helpers.js";

export function canForward(message) {
    return !!message && (!message.media || message.media.kind === "image") && !!(message.body?.trim() || message.media);
}

// Session-local retries. Do not expose a Drive id, source chat link or author to
// the destination. The server authorizes both media downloads and new sends.
export function createMessageForwarder(api, makeId = () => crypto.randomUUID()) {
    const pending = new Map();
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
            const conversation = await api.open(employeeId, {signal});
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
            // No send was made: do not retain failed authorization/downloads as
            // uncertain deliveries, or let them exhaust the pending retry budget.
            if (!attempt.writeStarted && pending.get(key) === attempt) pending.delete(key);
            throw error;
        } finally {attempt.running = null;}
    };
}
