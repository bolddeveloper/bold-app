import { http } from "../core/http_client.js";

const root = "/api/v2/calendar/";
const eventUrl = id => `${root}events/${encodeURIComponent(id)}/`;
export const calendarApi = {
    connection: () => http.request(`${root}connection/`),
    events: (start, end) => http.request(`${root}events/?${new URLSearchParams({ start, end })}`),
    get: id => http.request(eventUrl(id)),
    create: body => http.request(`${root}events/`, { method: "POST", body }),
    update: (id, scope, body) => http.request(`${eventUrl(id)}?scope=${scope}`, { method: "PATCH", body }),
    remove: (id, scope) => http.request(`${eventUrl(id)}?scope=${scope}`, { method: "DELETE" }),
    draft: body => http.request(`${root}drafts/`, { method: "POST", body }),
    draftGet: id => http.request(`${root}drafts/${id}/`),
    draftAction: (id, body) => http.request(`${root}drafts/${id}/`, { method: "PATCH", body }),
    draftCancel: (id, options = {}) => http.request(`${root}drafts/${id}/`, { method: "DELETE", ...options }),
    tasks: (start, end) => http.request(`${root}tasks/?${new URLSearchParams({ start, end })}`),
    taskLists: () => http.request(`${root}task-lists/`),
    contacts: query => http.request(`${root}contacts/?${new URLSearchParams({ q: query })}`),
    createTask: body => http.request(`${root}tasks/`, { method: "POST", body }),
    updateTask: (listId, id, body) => http.request(`${root}tasks/${encodeURIComponent(listId)}/${encodeURIComponent(id)}/`, { method: "PATCH", body }),
    removeTask: (listId, id) => http.request(`${root}tasks/${encodeURIComponent(listId)}/${encodeURIComponent(id)}/`, { method: "DELETE" }),
};
