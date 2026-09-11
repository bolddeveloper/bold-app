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
export const isMyTask = (task, assignmentId) => task.assignee_id === assignmentId || task.collaborator_ids?.includes(assignmentId);
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
        if (task.project_id) Object.assign(payload, { project: task.project_id, section: task.section === "unsectioned" ? null : task.section || null, project_position: task.position || "1000" });
    }
    return payload;
}
