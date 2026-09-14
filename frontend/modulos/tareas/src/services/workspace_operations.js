export const emptyWorkspaceFilters = () => ({ projects: [], sections: [], assignees: [], statuses: [], priorities: [], creators: [], units: [], due: "", dueFrom: "", dueTo: "", createdFrom: "", createdTo: "", completed: "", subtasks: "", attachments: "" });

export function workspaceProjectIds(task) {
    return [...new Set([task.project_id, ...(task.taskProjects || []).map(link => link.projectId)].filter(Boolean).map(String))];
}

export function workspaceSectionIds(task) {
    return [...new Set([task.section, ...(task.taskProjects || []).map(link => link.sectionId)].filter(Boolean).map(String))];
}

export function dueMatches(value, preset, today = new Date()) {
    if (!preset) return true;
    if (preset === "none") return !value;
    if (!value) return false;
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const date = new Date(`${value}T12:00:00`);
    const days = Math.floor((date - base) / 86400000);
    if (preset === "overdue") return days < 0;
    if (preset === "today") return days === 0;
    if (preset === "tomorrow") return days === 1;
    if (preset === "week") return days >= 0 && days < 7 - ((base.getDay() + 6) % 7);
    if (preset === "next7") return days >= 0 && days < 7;
    if (preset === "next30") return days >= 0 && days < 30;
    return true;
}

export function filterWorkspaceTasks(tasks, filters, search = "", today = new Date()) {
    const query = search.trim().toLocaleLowerCase();
    return tasks.filter(task => {
        const matches = (values, candidates) => !values?.length || candidates.some(value => values.map(String).includes(String(value)));
        const due = task.due_date || "";
        const created = (task.created_at || "").slice(0, 10);
        const children = task.subtasks || [];
        const searchable = [task.title, task.description, task.status, task.priority, task.assignee_name, task.workspace_search, ...(task.tags || []).map(tag => tag.name || tag.label || tag)].join(" ").toLocaleLowerCase();
        return (!query || searchable.includes(query))
            && matches(filters.projects, workspaceProjectIds(task))
            && matches(filters.sections, workspaceSectionIds(task))
            && matches(filters.assignees, [task.assignee_id || task.assigneeId])
            && matches(filters.statuses, [task.statusId || task.status])
            && matches(filters.priorities, [task.priority])
            && matches(filters.creators, [task.created_by_assignment])
            && matches(filters.units, [task.unitId || task.unit])
            && dueMatches(due, filters.due, today)
            && (!filters.dueFrom || due >= filters.dueFrom)
            && (!filters.dueTo || (due && due <= filters.dueTo))
            && (!filters.createdFrom || created >= filters.createdFrom)
            && (!filters.createdTo || (created && created <= filters.createdTo))
            && (!filters.completed || String(!!task.completed) === filters.completed)
            && (!filters.subtasks || String(children.length > 0) === filters.subtasks)
            && (!filters.attachments || String((task.attachments || []).length > 0) === filters.attachments);
    });
}

export function sortWorkspaceTasks(tasks, field, direction = "asc") {
    const value = task => ({
        title: task.title || "", due: task.due_date || "9999-12-31", created: task.created_at || "", priority: ({ Alta: 3, high: 3, Media: 2, medium: 2, Baja: 1, low: 1 })[task.priority] || 0,
        status: task.status || "", assignee: task.assignee_name || task.assignee_id || "", project: workspaceProjectIds(task)[0] || "",
        completed: Number(!task.completed), incomplete: Number(!!task.completed),
    })[field] ?? "";
    return [...tasks].sort((a, b) => direction === "desc" ? String(value(b)).localeCompare(String(value(a)), "es", { numeric: true }) : String(value(a)).localeCompare(String(value(b)), "es", { numeric: true }));
}

export function groupWorkspaceTasks(tasks, field, labels = {}) {
    if (!field) return [["Todas las tareas", tasks]];
    const groupKey = task => ({
        status: task.status || "Sin estado", priority: task.priority || "Sin prioridad", assignee: String(task.assignee_id || ""),
        project: workspaceProjectIds(task)[0] || "", section: workspaceSectionIds(task)[0] || "", due: task.due_date?.slice(0, 7) || "",
    })[field] || "Sin asignar";
    const groups = new Map();
    for (const task of tasks) {
        const key = groupKey(task);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
    }
    return [...groups].map(([key, rows]) => [labels[key] || key, rows]);
}
