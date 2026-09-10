import { http } from "../core/http_client.js";
export function createTasksApi(client = http) {
    let controller = new AbortController();
    const request = (path, options = {}) => client.request(path, { ...options, signal: controller.signal });
    const list = (resource, params) => client.list(resource, params, { signal: controller.signal });
    const create = (resource, body) => client.create(resource, body, { signal: controller.signal });
    const update = (resource, id, body) => client.update(resource, id, body, { signal: controller.signal });
    const remove = (resource, id) => client.remove(resource, id, { signal: controller.signal });
    return { request, list, create, update, remove,
        cancelRequests() { controller.abort(); controller = new AbortController(); },
        listProjects: params => list("projects", params),
        listSections: project => list("sections", { project }),
        listStatuses: unit => list("task-statuses", { unit }),
        listTasks: params => list("tasks", params),
        createTask: body => create("tasks", body),
        updateTask: (id, body) => update("tasks", id, body),
        moveTask: (id, body) => request(`/api/v2/tasks/${id}/move/`, { method: "POST", body }),
        deleteTask: id => remove("tasks", id),
        listTaskProjectLinks: project => list("task-projects", { project }),
        updateTaskProjectLink: (id, body) => update("task-projects", id, body),
        listComments: () => list("comments"),
        createComment: (task, body) => create("comments", { task, body }),
        markNotificationRead: id => request(`/api/v2/notifications/${id}/mark-read/`, { method: "POST" })
    };
}
export const api = createTasksApi();
