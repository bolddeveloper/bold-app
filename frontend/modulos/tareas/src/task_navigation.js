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
