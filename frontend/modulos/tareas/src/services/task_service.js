import { api, is_using_real_backend } from "./api_client.js";
import { normalizeProject, normalizeAssignment, normalizeStatus, normalizeSection, normalizeTask, normalizeTaskProject, taskPayload } from "./task_models.js";

export async function loadTaskData() {
    const directory = (await api.listAssignmentDirectory()).map(normalizeAssignment);
    const projects = (await api.listProjects()).map(normalizeProject);
    const units = await api.list("core/organizational-units");
    const sections = (await api.listSections()).map(normalizeSection);
    const statuses = [...new Map((await Promise.all(units.map(unit => api.listStatuses(unit.id)))).flat().map(dto => [dto.id, normalizeStatus(dto)])).values()];
    const tasks = (await api.listTasks()).map(dto => normalizeTask(dto, statuses));
    const links = (await api.listTaskProjectLinks()).map(normalizeTaskProject);
    const [comments, followers, members, attachments, notifications, taskTags, tags] = await Promise.all([
        api.listComments(), api.list("task-followers"), api.list("project-members"), api.list("attachments"), api.list("notifications"), api.list("task-tags"),
        Promise.all(units.map(unit => api.list("tags", { unit: unit.id }))).then(rows => rows.flat())
    ]);
    for (const project of projects) project.member_ids = members.filter(item => item.project === project.id && item.status === "active" && !item.removed_at).map(item => item.assignment);
    for (const task of tasks) {
        task.status_options = statuses.filter(item => !item.unitId || item.unitId === task.unitId).map(item => item.label);
        task.taskProjects = links.filter(link => link.taskId === task.id);
        task.comments = comments.filter(item => item.task === task.id).map(item => ({ ...item, task_id: item.task, author_name: directory.find(person => person.id === item.author_assignment)?.name || "Asignación anterior", images: [] }));
        task.subtasks = tasks.filter(item => item.parentTaskId === task.id);
        task.collaborator_ids = followers.filter(item => item.task === task.id).map(item => item.assignment);
        task.attachments = attachments.filter(item => item.task === task.id && !item.deleted_at).map(item => ({ ...item, name: item.file_name, url: item.file_url }));
        task.attachment_name = task.attachments[0]?.name || null;
        task.tags = taskTags.filter(item => item.task === task.id).map(item => tags.find(tag => tag.id === item.tag)?.name).filter(Boolean);
    }
    return { directory, projects, units, sections, statuses, tasks, links, members, followers,
        notifications: notifications.map(item => ({ ...item, task_id: item.task, time_label: new Date(item.created_at).toLocaleString("es"), message: item.body || item.title })) };
}

// Legacy function names serve only the template branch of the existing UI.
const template = () => { if (is_using_real_backend()) throw new Error("La plantilla no está disponible en modo real."); return import("./template_api.js"); };
export const list_tasks = async () => (await template()).list_tasks();
export const create_task = async payload => (await template()).create_task(payload);
export const update_task = async (id, payload) => (await template()).update_task(id, payload);
export const move_task = async (id, section) => (await template()).move_task(id, section);
export const delete_task = async id => is_using_real_backend() ? api.deleteTask(id) : (await template()).delete_task(id);
export const add_comment = async (...args) => (await template()).add_comment(...args);
export const toggle_subtask = async (...args) => (await template()).toggle_subtask(...args);

export async function saveFollowers(taskId, ids, data) {
    const existing = data.followers.filter(item => item.task === taskId);
    for (const row of existing) if (!ids.includes(row.assignment)) await api.remove("task-followers", row.id);
    for (const id of ids) if (!existing.some(row => row.assignment === id)) await api.create("task-followers", { task: taskId, assignment: id, notification_level: "all" });
}
export async function saveSubtasks(parent, drafts, data) {
    const existing = data.tasks.filter(item => item.parentTaskId === parent.id);
    for (const draft of drafts.filter(item => item.title.trim())) {
        const old = existing.find(item => item.id === draft.id);
        const unit = old?.unitId || parent.unitId;
        const status = data.statuses.find(item => (!item.unitId || item.unitId === unit) && item.isFinal === !!draft.completed);
        if (!status) throw new Error("Falta un estado compatible para la subtarea.");
        if (old) {
            if (old.title !== draft.title || old.completed !== draft.completed) await api.updateTask(old.id, { title: draft.title, status: status.id });
        } else {
            const created = await api.createTask({ title: draft.title, unit, status: status.id, priority: "medium", parent_task: parent.id });
            draft.id = created.id;
        }
    }
    for (const old of existing) if (!drafts.some(item => item.id === old.id)) await api.deleteTask(old.id);
}
export async function saveTaskDraft(draft, data, original = null) {
    draft = { ...draft, subtasks: (draft.subtasks || []).map(item => ({ ...item })), attachments: (draft.attachments || []).map(item => ({ ...item })) };
    const unitId = draft.unitId || original?.unitId;
    const payload = taskPayload(draft, data.statuses, { create: !original, unitId });
    if (original && original.unitId !== unitId) {
        await api.moveTask(original.id, { unit: unitId, status: payload.status, assignee_assignment: payload.assignee_assignment || null });
    }
    const dto = original ? await api.updateTask(original.id, payload) : await api.createTask(payload);
    draft.id = dto.id;
    try {
        // The initial TaskProject is already committed atomically by createTask.
        if (original && draft.project_id) {
            const link = original.taskProjects.find(item => item.projectId === draft.project_id);
            const section = draft.section === "unsectioned" ? null : draft.section || null;
            if (!link) await api.create("task-projects", { task: dto.id, project: draft.project_id, section, position: "1000" });
            else if (link.sectionId !== section) await api.updateTaskProjectLink(link.id, { section, position: draft.position || link.position });
        }
        await saveSubtasks({ id: dto.id, unitId: dto.unit }, draft.subtasks || [], data);
        await saveFollowers(dto.id, draft.collaborator_ids || [], data);
        const existingAttachments = original?.attachments || [];
        for (const item of draft.attachments || []) {
            if (existingAttachments.some(old => old.id === item.id)) continue;
            const url = new URL(item.url);
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("El archivo requiere un enlace HTTP o HTTPS.");
            const saved = await api.create("attachments", { task: dto.id, file_name: item.name, file_url: url.href, mime_type: "application/octet-stream", size_bytes: 0 });
            item.id = saved.id;
        }
        for (const old of existingAttachments) if (!(draft.attachments || []).some(item => item.id === old.id)) await api.remove("attachments", old.id);
        return dto;
    } catch (error) { error.partialDraft = draft; throw error; }
}
