// Navigation preferences never grant access to a project or module.
export function restoreTaskNavigation(saved, search = "") {
    const project = new URLSearchParams(search).get("project");
    const scope = project ? "project" : ["mine", "project", "workspace"].includes(saved?.scope) ? saved.scope : "mine";
    return {
        scope,
        projectId: project || (typeof saved?.projectId === "string" ? saved.projectId : ""),
        section: ["tasks", "timeline", "states", ...(scope === "mine" ? ["team"] : [])].includes(saved?.section) ? saved.section : "tasks",
        view: saved?.view === "board" ? "board" : "list",
    };
}

export function readTaskNavigation(key, search) {
    try { return restoreTaskNavigation(JSON.parse(globalThis.sessionStorage?.getItem(key) || localStorage.getItem(key)), search); }
    catch { return restoreTaskNavigation(null, search); }
}

export function readCollapsedSections(key) {
    try {
        const ids = JSON.parse(globalThis.localStorage?.getItem(key) || "[]");
        return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === "string" || typeof id === "number" && Number.isFinite(id)))] : [];
    } catch { return []; }
}
export function writeCollapsedSections(key, ids) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(ids)); } catch { /* Mantener el estado de esta sesión si el navegador no permite guardar. */ }
}

export function normalizeTaskFilters(value) {
    return Object.fromEntries(["assignee_ids", "collaborator_ids", "priorities", "sections"].map(key => [key,
        Array.isArray(value?.[key]) ? [...new Set(value[key].filter(item => typeof item === "string" && item.length <= 200))].slice(0, 100) : [],
    ]));
}
export function readTaskFilters(key) {
    try {return normalizeTaskFilters(JSON.parse(globalThis.localStorage?.getItem(key) || "null"));}
    catch {return normalizeTaskFilters(null);}
}
export function writeTaskFilters(key, value) {
    try {globalThis.localStorage?.setItem(key, JSON.stringify(normalizeTaskFilters(value)));} catch { /* Los filtros siguen funcionando sin almacenamiento. */ }
}
