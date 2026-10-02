export function dateFromISO(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
export function toISODate(year, month, day) {
    if (!day) return null;
    const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return dateFromISO(value) ? value : null;
}
export function validateProjectDraft(name, startDate, endDate) {
    if (!name.trim()) return "El nombre del proyecto es obligatorio.";
    if (name.trim().length > 180) return "El nombre del proyecto no puede superar 180 caracteres.";
    if ((startDate && !dateFromISO(startDate)) || (endDate && !dateFromISO(endDate))) return "Ingresa fechas válidas.";
    if (startDate && endDate && startDate > endDate) return "La fecha final no puede ser anterior a la fecha inicial.";
    return "";
}
export function uniqueProjectName(name, existingNames) {
    let candidate = name.trim();
    const names = new Set(existingNames);
    for (let suffix = 2; names.has(candidate); suffix += 1) {
        const marker = ` (${suffix})`;
        candidate = `${name.trim().slice(0, 180 - marker.length)}${marker}`;
    }
    return candidate;
}
export function recentProjectIds(historyIds, projectIds, openedId = null, limit = 4) {
    const available = new Set(projectIds);
    return [...new Set([openedId, ...historyIds, ...projectIds].filter(id => id && available.has(id)))].slice(0, limit);
}
export function isActiveProject(project) {
    const status = String(project?.status || "").trim().toLocaleLowerCase("es");
    return !project?.is_archived && !["inactive", "inactivo", "archived", "archivado"].includes(status);
}
export function groupProjectsByUnit(projects, units) {
    const unitNames = new Map(units.map(unit => [String(unit.id), unit.name]));
    const groups = new Map();
    for (const project of projects) {
        const unitId = String(project.unitId || project.unit || "");
        const group = groups.get(unitId) || {
            id: unitId || "unassigned",
            name: unitNames.get(unitId) || "Sin departamento",
            projects: [],
        };
        group.projects.push(project);
        groups.set(unitId, group);
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
}
export function membersForUnit(members, unitId) {
    return (members || []).filter(member => String(member.unitId) === String(unitId));
}
export const isMyTask = (task, assignmentId) => assignmentId != null && (
    String(task.assignee_id) === String(assignmentId)
    || String(task.created_by_assignment) === String(assignmentId)
    || task.collaborator_ids?.some(id => String(id) === String(assignmentId))
);
export function previewTaskDraft(draft, original, statuses) {
    const status = statuses.find(item => item.label === draft.status && (!item.unitId || item.unitId === draft.unitId));
    const due = dateFromISO(draft.due_date);
    const links = (original?.taskProjects || []).map(item => ({ ...item }));
    if (draft.project_id) {
        const link = links.find(item => item.projectId === draft.project_id);
        if (link) link.sectionId = draft.section === "unsectioned" ? null : draft.section;
        else links.push({ id: `pending:${draft.id}`, taskId: draft.id, projectId: draft.project_id,
            sectionId: draft.section === "unsectioned" ? null : draft.section, position: String(draft.position || "1000") });
    }
    return {
        ...original, ...draft,
        id: original?.id || draft.id,
        unitId: draft.unitId || original?.unitId,
        statusId: status?.id || original?.statusId,
        statusCategory: status?.category || original?.statusCategory,
        completed: status ? Boolean(status.isFinal) : Boolean(draft.completed),
        due_day: due?.getDate() || null,
        due_label: due?.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) || "",
        parentTaskId: draft.parent_task ?? draft.parentTaskId ?? original?.parentTaskId ?? null,
        taskProjects: links,
        comments: original?.comments || [],
        subtasks: (draft.subtasks || original?.subtasks || []).map(item => ({ ...item, parentTaskId: original?.id || draft.id })),
        collaborator_ids: draft.collaborator_ids || original?.collaborator_ids || [],
        attachments: draft.attachments || original?.attachments || [],
    };
}
function removeTaskFromTree(tasks, id) {
    return tasks.filter(task => String(task.id) !== String(id)).map(task => task.subtasks?.length
        ? { ...task, subtasks: removeTaskFromTree(task.subtasks, id) } : task);
}
function replaceTaskInTree(tasks, id, replacement) {
    return tasks.map(task => String(task.id) === String(id) ? replacement : task.subtasks?.length
        ? { ...task, subtasks: replaceTaskInTree(task.subtasks, id, replacement) } : task);
}
function addChildToTree(tasks, parentId, child) {
    return tasks.map(task => String(task.id) === String(parentId)
        ? { ...task, subtasks: [...(task.subtasks || []).filter(item => String(item.id) !== String(child.id)), child] }
        : task.subtasks?.length ? { ...task, subtasks: addChildToTree(task.subtasks, parentId, child) } : task);
}
export function applyPendingTaskChanges(tasks, mutations) {
    let visible = tasks;
    for (const mutation of mutations.values()) {
        if (mutation.kind === "delete") {
            visible = removeTaskFromTree(visible, mutation.id);
        } else if (mutation.kind === "create") {
            if (mutation.serverId) visible = removeTaskFromTree(visible, mutation.serverId);
            if (!visible.some(task => String(task.id) === String(mutation.id))) visible = [...visible, mutation.task];
            if (mutation.task.parentTaskId) visible = addChildToTree(visible, mutation.task.parentTaskId, mutation.task);
        } else if (mutation.kind === "update") {
            visible = replaceTaskInTree(visible, mutation.id, mutation.task);
        }
    }
    return visible;
}
export function settleCommittedTaskChanges(mutations, { reconciled, startedRevision, currentRevision }) {
    if (!reconciled || startedRevision !== currentRevision) return;
    for (const [key, mutation] of mutations) if (mutation.committed) mutations.delete(key);
}
export function rollbackPendingTaskChange(tasks, mutation, { flat = false } = {}) {
    const withoutPreview = removeTaskFromTree(tasks, mutation.id);
    if (mutation.kind === "create" || !mutation.original) return withoutPreview;
    const restored = mutation.original.parentTaskId
        ? addChildToTree(withoutPreview, mutation.original.parentTaskId, mutation.original) : withoutPreview;
    if (mutation.original.parentTaskId && !flat) return restored;
    const position = Math.min(mutation.originalIndex ?? restored.length, restored.length);
    return [...restored.slice(0, position), mutation.original, ...restored.slice(position)];
}
export function replaceTemporaryTaskIds(tasks, idMap) {
    return tasks.map(task => ({ ...task,
        id: idMap.get(String(task.id)) || task.id,
        parentTaskId: idMap.get(String(task.parentTaskId)) || task.parentTaskId,
        taskProjects: task.taskProjects?.map(link => ({ ...link, taskId: idMap.get(String(link.taskId)) || link.taskId })) || [],
        subtasks: task.subtasks?.length ? replaceTemporaryTaskIds(task.subtasks, idMap) : task.subtasks || [],
    }));
}
export function applyOptimisticTaskStatus(tasks, taskId, status) {
    const patch = task => String(task.id) === String(taskId) ? {
        ...task,
        statusId: status.id,
        status: status.label,
        statusCategory: status.category,
        completed: Boolean(status.isFinal),
    } : { ...task, subtasks: (task.subtasks || []).map(patch) };
    return tasks.map(patch);
}
export const normalizeProject = dto => ({ ...dto, label: dto.name, color: dto.color_hex || "#ef1f2d", unitId: dto.unit });

export const normalizeStatus = dto => ({ ...dto, label: dto.name, isFinal: dto.is_final, unitId: dto.unit });
export const normalizeSection = dto => ({ ...dto, label: ({ todo: "Por hacer", in_progress: "En curso", completed: "Completadas" })[dto.name] || dto.name, projectId: dto.project });
export const normalizeTaskProject = dto => ({ ...dto, taskId: dto.task, projectId: dto.project, sectionId: dto.section, position: String(dto.position) });
export function normalizeTask(dto, statuses = []) {
    const status = statuses.find(item => item.id === dto.status);
    const due = dateFromISO(dto.due_date);
    return { ...dto, unitId: dto.unit, assigneeId: dto.assignee_assignment, assignee_id: dto.assignee_assignment || "", parentTaskId: dto.parent_task,
        statusId: dto.status, status: status?.label || "", statusCategory: status?.category, completed: !!status?.isFinal,
        priority: ({ high: "Alta", medium: "Media", low: "Baja" })[dto.priority] || dto.priority,
        description: dto.description || "", due_day: due?.getDate() || null,
        due_label: due?.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) || "",
        tags: [], subtasks: [], comments: [], collaborator_ids: [], attachments: [], taskProjects: [] };
}
// project_id/section are a projection for the currently displayed board only.
export function projectTask(task, projectId) {
    const link = task.taskProjects.find(item => item.projectId === projectId) || (!projectId ? task.taskProjects[0] : null);
    return { ...task, project_id: link?.projectId || null, section: link?.sectionId || "unsectioned", position: link?.position || "0" };
}
export function taskPayload(task, statuses, { create = false, unitId } = {}) {
    const unit = task.unitId || unitId;
    const payload = {};
    for (const field of ["title", "description", "start_date", "due_date", "parent_task"]) {
        if (task[field] !== undefined) payload[field] = task[field] || (field.endsWith("date") ? null : task[field]);
    }
    if (task.priority !== undefined) payload.priority = ({ Alta: "high", Media: "medium", Baja: "low" })[task.priority] || task.priority;
    if (task.assignee_id !== undefined) payload.assignee_assignment = task.assignee_id || null;
    if (task.status !== undefined || task.statusId !== undefined || create) {
        const compatible = statuses.filter(item => !item.unitId || item.unitId === unit);
        const status = compatible.find(item => item.id === task.statusId && (task.status === undefined || item.label === task.status)) || compatible.find(item => item.label === task.status) || (create ? compatible.find(item => !item.isFinal) : null);
        if (!status) throw new Error("Selecciona un estado compatible con el equipo responsable.");
        payload.status = status.id;
    }
    if (create) {
        payload.unit = unit;
        if (task.follow_creator !== undefined) payload.follow_creator = Boolean(task.follow_creator);
        if (task.project_id) Object.assign(payload, { project: task.project_id, section: task.section === "unsectioned" ? null : task.section || null, project_position: task.position || "1000" });
    }
    return payload;
}
