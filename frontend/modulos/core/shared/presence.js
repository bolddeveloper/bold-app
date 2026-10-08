export const presenceLabels = {online: "En línea", away: "Ausente", busy: "Ocupado", vacation: "De vacaciones", offline: "Desconectado", meeting: "En reunión", custom: "Personalizado"};
export const editablePresenceStatuses = ["online", "away", "busy", "vacation", "custom"];
export const quickPresenceStatuses = ["online", "away", "busy"];
export const presenceDurations = [[15, "15 minutos"], [30, "30 minutos"], [60, "1 hora"], [120, "2 horas"], [0, "Hasta que lo cambie"]];
export function presencePatch(value) {
    return {status: value.status, title: value.title || "", description: value.description || "", calendar_automatic: value.calendar_automatic, duration_minutes: ["away", "busy"].includes(value.status) ? Number(value.duration_minutes || 0) : 0};
}
export const presenceLabel = person => person.status === "custom" ? person.title || presenceLabels.custom : presenceLabels[person.status] || "Estado desconocido";
export function filterPresence(rows, unit = "", query = "") {
    const text = query.trim().toLocaleLowerCase("es");
    return (rows || []).filter(row => row.status !== "offline" && (!unit || row.units?.some(item => item.id === unit)) && (!text || `${row.name} ${presenceLabel(row)} ${row.description || ""}`.toLocaleLowerCase("es").includes(text)));
}

export function groupPresence(rows, query = "") {
    const groups = new Map();
    for (const row of filterPresence(rows, "", query)) {
        for (const unit of new Map((row.units || []).map(unit => [unit.id, unit])).values()) {
            if (!groups.has(unit.id)) groups.set(unit.id, { ...unit, people: [] });
            groups.get(unit.id).people.push(row);
        }
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
