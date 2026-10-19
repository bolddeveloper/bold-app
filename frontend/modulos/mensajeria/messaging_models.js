export const initials = name => (name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
export const normalizeQuery = text => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();

export function linkParts(text) {
    const source = String(text || ""), parts = [];
    let offset = 0;
    for (const match of source.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
        let label = match[0].replace(/[.,;:!?]+$/, "");
        while (label.endsWith(")") && (label.match(/\)/g) || []).length > (label.match(/\(/g) || []).length) label = label.slice(0, -1);
        try {
            const href = new URL(/^www\./i.test(label) ? `https://${label}` : label);
            if (!["http:", "https:"].includes(href.protocol) || !href.hostname) continue;
            if (match.index > offset) parts.push({text: source.slice(offset, match.index)});
            parts.push({text: label, href: href.href});
            offset = match.index + label.length;
        } catch { /* Leave malformed URLs as plain text. Never fetch previews. */ }
    }
    if (offset < source.length) parts.push({text: source.slice(offset)});
    return parts;
}

export function mergeMessages(current, incoming) {
    const rows = new Map(current.map(row => [row.id, row]));
    for (const row of incoming) {
        const old = rows.get(row.id);
        if (!old) {rows.set(row.id, row); continue;}
        const newer = row.version >= old.version ? {...old, ...row} : {...old};
        // Content events and receipt events can arrive out of order. Neither may
        // erase a confirmed delivery/read state or an already-edited body.
        newer.delivered_at = old.delivered_at || row.delivered_at || null;
        newer.read_at = old.read_at || row.read_at || null;
        rows.set(row.id, newer);
    }
    return [...rows.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

export function applyReceipts(messages, receipts) {
    const byId = new Map(receipts.map(row => [row.id, row]));
    return messages.map(message => {const receipt = byId.get(message.id); return receipt ? {...message, delivered_at: message.delivered_at || receipt.delivered_at || null, read_at: message.read_at || receipt.read_at || null} : message;});
}

export function reconcileMessages(current, latestPage) {
    if (!latestPage.length) return current;
    const oldest = Math.min(...latestPage.map(row => Date.parse(row.created_at)));
    // A disconnected interval can exceed one page. Start a contiguous recent
    // window; its fresh cursor can then load the omitted history without gaps.
    return mergeMessages(current.filter(row => Date.parse(row.created_at) >= oldest), latestPage);
}

export const deliveryState = message => message.read_at ? "read" : message.delivered_at ? "delivered" : "sent";
export const enterSends = (event, behavior) => event.key === "Enter" && !event.isComposing && (behavior === "send" ? !event.shiftKey : behavior === "newline" && (event.ctrlKey || event.metaKey));

export function canEditMessage(message, actorId, serverNow = Date.now()) {
    return Boolean(message.can_edit && message.author_id === actorId && serverNow < Date.parse(message.editable_until));
}

export function dayLabel(date, now = new Date()) {
    const value = new Date(date);
    return value.toDateString() === now.toDateString() ? "Hoy" : new Intl.DateTimeFormat("es", {day: "numeric", month: "long", year: "numeric"}).format(value);
}

export function messageError(error) {
    const detail = error?.fields?.detail;
    if (error?.status === 409) return typeof detail === "string" ? `${detail} Conservamos tu texto y los adjuntos.` : "El mensaje cambió en otra ventana. Conservamos tu texto; actualiza antes de volver a editar o enviar.";
    if (error?.status === 429) return "Has realizado varias acciones seguidas. Conservamos tu texto; espera un momento antes de reintentar.";
    if (error?.status === 404) return "Esta conversación no está disponible para tu cuenta.";
    if (error?.status >= 500 || error?.status === 0) return "No se pudo confirmar la operación. Conservamos tu texto. Actualiza para comprobar si se guardó antes de reintentar.";
    if (typeof detail === "string") return detail;
    if (error?.status === 400) {
        const fields = error.fields;
        const messages = Array.isArray(fields) ? fields : [fields?.detail, fields?.file, fields?.body, fields?.non_field_errors].flat();
        const safe = messages.find(value => typeof value === "string" && value.length <= 400);
        return safe || "Escribe hasta 5.000 caracteres o adjunta una imagen o nota de voz de hasta 10 MB. El destinatario debe tener una cuenta activa.";
    }
    return "No se pudo completar la acción. Conservamos tu texto; puedes volver a intentarlo.";
}
