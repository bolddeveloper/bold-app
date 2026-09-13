export const workspaceStorageKey = unitId => `bold_workspaces:v2:${unitId || "demo"}`;
export const activeWorkspaceStorageKey = unitId => `bold_workspaces_active:v1:${unitId || "demo"}`;

export function cleanWorkspaces(value) {
    if (!Array.isArray(value)) throw new Error("Datos de carpetas inválidos.");
    const seen = new Set();
    const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === "string" && id))] : [];
    const items = value.flatMap(item => {
        if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id) || typeof item.name !== "string" || !item.name.trim()) return [];
        seen.add(item.id);
        return [{ id: item.id, name: item.name.trim(), parentId: typeof item.parentId === "string" ? item.parentId : null, description: typeof item.description === "string" ? item.description : "", color: /^#[\da-f]{6}$/i.test(item.color) ? item.color : "#ef1f2d", projectIds: ids(item.projectIds), taskIds: ids(item.taskIds) }];
    });
    const byId = new Map(items.map(item => [item.id, item]));
    for (const item of items) {
        const path = new Set([item.id]);
        let parent = item.parentId;
        while (parent) {
            if (!byId.has(parent) || path.has(parent)) { item.parentId = null; break; }
            path.add(parent); parent = byId.get(parent).parentId;
        }
    }
    const names = new Set();
    for (const item of items) {
        const base = item.name; let n = 2;
        while (names.has(JSON.stringify([item.parentId, item.name.toLowerCase()]))) item.name = `${base} (${n++})`;
        names.add(JSON.stringify([item.parentId, item.name.toLowerCase()]));
    }
    return items;
}

export function readWorkspaces(storage, unitId) {
    const current = storage.getItem(workspaceStorageKey(unitId));
    if (current !== null) return cleanWorkspaces(JSON.parse(current));
    const legacy = storage.getItem(`bold_workspaces:v1:${unitId || "demo"}`);
    if (legacy === null) return [];
    const items = cleanWorkspaces(JSON.parse(legacy));
    storage.setItem(workspaceStorageKey(unitId), JSON.stringify(items));
    return items;
}

export function saveWorkspaces(storage, unitId, items) {
    const clean = cleanWorkspaces(items);
    storage.setItem(workspaceStorageKey(unitId), JSON.stringify(clean));
    return clean;
}

export function folderBranch(items, id) {
    const found = new Set([id]);
    for (let previous = 0; previous !== found.size;) {
        previous = found.size;
        for (const item of items) if (found.has(item.parentId)) found.add(item.id);
    }
    return items.filter(item => found.has(item.id));
}

export function folderPath(items, id) {
    const path = [], seen = new Set();
    let item = items.find(folder => folder.id === id);
    while (item && !seen.has(item.id)) { path.unshift(item); seen.add(item.id); item = items.find(folder => folder.id === item.parentId); }
    return path;
}

export function folderSummary(items, id, projects, tasks) {
    const branch = folderBranch(items, id);
    const projectIds = [...new Set(branch.flatMap(item => item.projectIds))];
    const rows = [...new Map(tasksInWorkspace({ projectIds, taskIds: branch.flatMap(item => item.taskIds) }, tasks).map(task => [task.id, task])).values()];
    const done = rows.filter(task => task.completed).length;
    return { folders: branch.length - 1, projects: projects.filter(project => projectIds.includes(String(project.id))).length, tasks: rows.length, done, progress: rows.length ? Math.round(done / rows.length * 100) : 0 };
}

export function transferFolderItems(items, sourceId, targetId, selection, action) {
    if (action !== "remove" && !items.some(item => item.id === targetId)) throw new Error("Selecciona una carpeta destino.");
    if (action === "move" && sourceId === targetId) throw new Error("Elige otra carpeta.");
    const source = items.find(item => item.id === sourceId);
    if (action !== "add" && (!source || selection.some(entry => !source[entry.field]?.includes(entry.id)))) throw new Error("Agrega las tareas heredadas a otra carpeta o mueve su proyecto completo.");
    return items.map(item => {
        let next = item;
        for (const entry of selection) {
            if (!["projectIds", "taskIds"].includes(entry.field)) throw new Error("Selección inválida.");
            if (item.id === sourceId && action !== "add") next = { ...next, [entry.field]: next[entry.field].filter(id => id !== entry.id) };
            if (item.id === targetId && action !== "remove") next = { ...next, [entry.field]: [...new Set([...next[entry.field], entry.id])] };
        }
        return next;
    });
}

export function tasksInWorkspace(workspace, tasks) {
    if (!workspace) return tasks;
    const projectIds = new Set(workspace.projectIds.map(String));
    const taskIds = new Set(workspace.taskIds.map(String));
    return tasks.filter(task => taskIds.has(String(task.id)) || projectIds.has(String(task.project_id)) || task.taskProjects?.some(link => projectIds.has(String(link.projectId))));
}

export function toggleWorkspaceItem(workspaces, workspaceId, field, itemId) {
    return workspaces.map(workspace => {
        if (workspace.id !== workspaceId) return workspace;
        const ids = workspace[field] || [];
        return { ...workspace, [field]: ids.includes(itemId) ? ids.filter(id => id !== itemId) : [...ids, itemId] };
    });
}
