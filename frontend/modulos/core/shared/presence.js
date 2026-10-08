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
    return (rows || []).filter(row => (!unit || row.units?.some(item => item.id === unit)) && (!text || `${row.name} ${presenceLabel(row)} ${row.description || ""}`.toLocaleLowerCase("es").includes(text)));
}

export function groupPresence(rows, query = "", unitId = "", firstUnitId = "", units = []) {
    const groups = new Map(units.filter(unit => !unitId || unit.id === unitId).map(unit => [unit.id, {...unit, people: []}]));
    for (const row of filterPresence(rows, unitId, query)) {
        for (const unit of new Map((row.units || []).map(unit => [unit.id, unit])).values()) {
            if (unitId && unit.id !== unitId) continue;
            if (!groups.has(unit.id)) groups.set(unit.id, { ...unit, people: [] });
            groups.get(unit.id).people.push(row);
        }
    }
    return [...groups.values()].filter(group => !query.trim() || group.people.length).sort((a, b) => Number(b.id === firstUnitId) - Number(a.id === firstUnitId) || a.name.localeCompare(b.name, "es"));
}
