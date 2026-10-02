import { api } from "./tasks_api.js";
import { notificationsApi } from "../../../notificaciones/notifications_api.js";
import { assembleTaskData } from "./task_service.js";
import { normalizeProject, normalizeStatus, normalizeSection, normalizeTask, normalizeTaskProject } from "./task_models.js";

export const TASK_RESOURCES = ["tasks", "links", "comments", "followers", "attachments", "taskTags"];
export const PROJECT_RESOURCES = ["projects", "sections", "members", "links"];
const RESOURCES = [...TASK_RESOURCES, "projects", "sections", "members", "statuses", "tags", "notifications"];
const RELATIONS = { links: "task-projects", comments: "comments", followers: "task-followers", attachments: "attachments", taskTags: "task-tags" };
const ENDPOINTS = { ...RELATIONS, members: "project-members" };
const CHUNK_SIZE = 50;
const chunks = rows => Array.from({ length: Math.ceil(rows.length / CHUNK_SIZE) }, (_, index) => rows.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));

// A signal invalidates resources; it never grants access or supplies trusted data.
// The subsequent HTTP read uses the current session/assignment authorization.
export function resourcesForTaskEvent(event) {
    if (event?.event_type === "project.changed") return PROJECT_RESOURCES;
    if (event?.event_type === "catalog.changed") {
        const units = (event.payload?.units || []).filter(id => /^[\w-]+$/.test(String(id))).slice(0, 50);
        return units.length ? [...new Set(units)].flatMap(id => [`statuses#${id}`, `tags#${id}`]) : ["statuses", "tags"];
    }
    const relation = { "comment.changed": "comments", "attachment.changed": "attachments", "follower.changed": "followers", "task_tag.changed": "taskTags", "task_link.changed": "links" }[event?.event_type];
    if (relation) {
        const ids = (event.payload?.tasks || []).filter(id => /^[\w-]+$/.test(String(id))).slice(0, 50);
        return ids.length ? [...new Set(ids)].map(id => `${relation}@${id}`) : [relation];
    }
    const id = event?.entity_type === "comment" ? event.payload?.task : event?.entity_id;
    if (!id || !/^[\w-]+$/.test(String(id))) return TASK_RESOURCES;
    if (event.event_type === "comment.created") return [`comments@${id}`];
    if (event.event_type === "task.created") return TASK_RESOURCES.map(resource => `${resource}@${id}`);
    if (["task.updated", "task.status_changed", "task.deleted"].includes(event.event_type)) return [`tasks@${id}`, `links@${id}`];
    return TASK_RESOURCES;
}

export function createTaskDataLoader(context, { catalogCache, client = api, notificationClient = notificationsApi, deferComments = false } = {}) {
    let snapshot = null, generation = 0, presentation = null;
    const catalog = (key, load) => catalogCache ? catalogCache.get(key, load) : load();
    const allCatalogs = (resource, units) => Promise.all(chunks(units.map(unit => String(unit.id))).map(ids =>
        catalog(`${resource}:${ids.join(",")}`, () => client.list(resource, { units: ids.join(",") })))).then(rows => rows.flat());
    function clear() { generation++; snapshot = null; presentation = null; }
    async function load(resources = ["all"]) {
        const version = generation;
        const full = !snapshot || resources.includes("all");
        const requested = new Map();
        for (const token of full ? RESOURCES : resources) {
            const [resource, id] = token.split(/[@#]/);
            const unitScope = token.includes("#");
            if (!RESOURCES.includes(resource)) throw new Error(`Recurso de sincronización desconocido: ${resource}`);
            if (id && !(unitScope ? ["statuses", "tags"] : TASK_RESOURCES).includes(resource)) throw new Error("Este recurso no admite ese filtro.");
            if (!id) requested.set(resource, null);
            else if (!requested.has(resource)) requested.set(resource, new Set([id]));
            else requested.get(resource)?.add(id);
        }
        const next = { ...snapshot };
        await Promise.all([...requested].map(async ([resource, ids]) => {
            const params = ids ? { [resource === "tasks" ? "ids" : "tasks"]: [...ids].join(",") } : undefined;
            let rows;
            if (resource === "comments" && deferComments) rows = [];
            else if (resource === "statuses" || resource === "tags") rows = await allCatalogs(resource === "statuses" ? "task-statuses" : "tags", ids ? context.units.filter(unit => ids.has(String(unit.id))) : context.units);
            else if (resource === "notifications") rows = await notificationClient.list();
            else if (ids) rows = (await Promise.all(chunks([...ids]).map(batch => client.list(resource === "tasks" ? "tasks" : RELATIONS[resource], { ...params, [resource === "tasks" ? "ids" : "tasks"]: batch.join(",") })))).flat();
            else rows = await client.list(ENDPOINTS[resource] || resource);
            const previous = snapshot?.[resource] || new Map();
            const map = ids ? new Map(previous) : new Map();
            const received = new Set(rows.map(row => String(row.id)));
            if (ids) for (const [key, row] of map)
                if (ids.has(String(["statuses", "tags"].includes(resource) ? row.unit : resource === "tasks" ? row.id : row.task)) && !received.has(key)) map.delete(key);
            for (const row of rows) {
                const old = previous.get(String(row.id));
                map.set(String(row.id), old && JSON.stringify(old) === JSON.stringify(row) ? old : row);
            }
            next[resource] = map;
        }));
        if (version !== generation) throw new DOMException("Contexto de tareas invalidado", "AbortError");
        // A moved/deleted task must not leave relations from its previous scope.
        const taskIds = new Set(next.tasks.keys());
        const projectIds = new Set(next.projects.keys());
        for (const resource of Object.keys(RELATIONS)) {
            next[resource] = new Map([...next[resource]].filter(([, row]) => taskIds.has(String(row.task)) && (resource !== "links" || projectIds.has(String(row.project)))));
        }
        for (const resource of ["members", "sections"])
            next[resource] = new Map([...next[resource]].filter(([, row]) => projectIds.has(String(row.project))));
        const rows = resource => [...next[resource].values()];
        const statuses = rows("statuses").map(normalizeStatus);
        const data = assembleTaskData({ ...context,
            projects: rows("projects").map(normalizeProject), sections: rows("sections").map(normalizeSection),
            statuses, tasks: rows("tasks").map(dto => normalizeTask(dto, statuses)), links: rows("links").map(normalizeTaskProject),
            comments: rows("comments"), followers: rows("followers"), members: rows("members"),
            attachments: rows("attachments"), notifications: rows("notifications"), taskTags: rows("taskTags"), tags: rows("tags"),
        });
        // Publish only a completely successful round. Failed partial reads cannot
        // silently corrupt the next round or discard an optimistic draft.
        const previousTasks = new Map((presentation?.tasks || []).map(task => [String(task.id), task]));
        const stable = new Map(), visiting = new Set();
        const reuseTask = task => {
            const id = String(task.id);
            if (stable.has(id)) return stable.get(id);
            // Defensive against malformed cyclic parent graphs; do not hang the UI.
            if (visiting.has(id)) return { ...task, subtasks: [] };
            visiting.add(id);
            task.subtasks = task.subtasks.map(reuseTask);
            visiting.delete(id);
            const old = previousTasks.get(id);
            const result = old && JSON.stringify(old) === JSON.stringify(task) ? old : task;
            stable.set(id, result);
            return result;
        };
        data.tasks = data.tasks.map(reuseTask);
        for (const resource of ["projects", "sections", "statuses", "links", "members", "followers", "notifications"])
            if (presentation && JSON.stringify(presentation[resource]) === JSON.stringify(data[resource])) data[resource] = presentation[resource];
        snapshot = next;
        presentation = data;
        return data;
    }
    return { load, clear };
}
