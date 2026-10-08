import { http } from "../../../core/http_client.js";
export function createTasksApi(client = http) {
    let controller = new AbortController();
    const scoped = (options = {}) => ({ ...options, signal: AbortSignal.any([controller.signal, options.signal || controller.signal]) });
    const request = (path, options = {}) => client.request(path, scoped(options));
    const list = (resource, params, options) => client.list(resource, params, scoped(options));
    const create = (resource, body) => client.create(resource, body, { signal: controller.signal, timeoutMs: 120000 });
    const update = (resource, id, body) => client.update(resource, id, body, { signal: controller.signal, timeoutMs: 120000 });
    const remove = (resource, id) => client.remove(resource, id, { signal: controller.signal, timeoutMs: 120000 });
    return { request, list, listPage: (resource, params, options) => client.listPage(resource, params, scoped(options)), create, update, remove,
        cancelRequests() { controller.abort(); controller = new AbortController(); },
        listProjects: params => list("projects", params),
        listSections: project => list("sections", { project }),
        materializeUnsectioned: body => request("/api/v2/sections/materialize-unsectioned/", { method: "POST", body }),
        reorderSections: body => request("/api/v2/sections/reorder/", { method: "POST", body }),
        listStatuses: unit => list("task-statuses", { unit }),
        listTasks: params => list("tasks", params),
        createTask: body => create("tasks", body),
        bulkTasks: body => request("/api/v2/tasks/bulk/", { method: "POST", body }),
        updateTask: (id, body) => update("tasks", id, body),
        moveTask: (id, body) => request(`/api/v2/tasks/${id}/move/`, { method: "POST", body }),
        deleteTask: id => remove("tasks", id),
        listTaskProjectLinks: project => list("task-projects", { project }),
        updateTaskProjectLink: (id, body) => update("task-projects", id, body),
        listComments: () => list("comments"),
        createComment: (task, body, voice_notes = [], imageContext = {}) => create("comments", { task, body, voice_notes, ...imageContext })
    };
}
export const api = createTasksApi();
