export const presenceLabels = {online: "En línea", away: "Ausente", busy: "Ocupado", vacation: "De vacaciones", offline: "Desconectado", meeting: "En reunión", custom: "Personalizado"};
export const presenceLabel = person => person.status === "custom" ? person.title || presenceLabels.custom : presenceLabels[person.status] || "Estado desconocido";
export function filterPresence(rows, unit = "", query = "") {
    const text = query.trim().toLocaleLowerCase("es");
    return (rows || []).filter(row => row.status !== "offline" && (!unit || row.units?.some(item => item.id === unit)) && (!text || `${row.name} ${presenceLabel(row)} ${row.description || ""}`.toLocaleLowerCase("es").includes(text)));
}
