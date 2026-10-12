export const brandFields = [
    ["client_name", "Contacto del cliente"], ["client_role", "Cargo del contacto"],
    ["client_email", "Correo del contacto"], ["client_phone", "Teléfono de trabajo"],
    ["communication", "Canales y preferencias de comunicación"], ["budget", "Presupuesto y moneda de la pauta"],
    ["designer", "Diseñador a cargo"], ["trafficker", "Trafficker a cargo"], ["notes", "Contexto para relevos y notas"],
];
export const emptyBrand = () => ({name: "", description: "", logo: null, details: {paid_ads: false, audiovisual: false, extra: {}}, project_ids: [], task_ids: []});
export function brandDraft(row) {
    return {name: row.name, description: row.description, logo: row.logo, details: structuredClone(row.details), project_ids: [...row.project_ids], task_ids: [...row.task_ids], revision: row.revision};
}
export const toggleBrandLink = (ids, id) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
