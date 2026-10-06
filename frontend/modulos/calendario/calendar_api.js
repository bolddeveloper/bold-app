import { http } from "../core/http_client.js";
import { confirmGoogleConnection } from "../core/google_cache.js";

const root = "/api/v2/calendar/";
const eventUrl = id => `${root}events/${encodeURIComponent(id)}/`;
export const calendarApi = {
    connection: options => http.request(`${root}connection/`, options).then(confirmGoogleConnection),
    events: (start, end, options) => http.request(`${root}events/?${new URLSearchParams({ start, end })}`, options),
    get: id => http.request(eventUrl(id)),
    create: body => http.request(`${root}events/`, { method: "POST", body }),
    update: (id, scope, body) => http.request(`${eventUrl(id)}?scope=${scope}`, { method: "PATCH", body }),
    remove: (id, scope) => http.request(`${eventUrl(id)}?scope=${scope}`, { method: "DELETE" }),
    draft: body => http.request(`${root}drafts/`, { method: "POST", body }),
    draftGet: (id, options = {}) => http.request(`${root}drafts/${id}/`, options),
    draftAction: (id, body, options = {}) => http.request(`${root}drafts/${id}/`, { ...options, method: "PATCH", body }),
    draftCancel: (id, options = {}) => http.request(`${root}drafts/${id}/`, { method: "DELETE", ...options }),
    tasks: (start, end, options) => http.request(`${root}tasks/?${new URLSearchParams({ start, end })}`, options),
    taskLists: () => http.request(`${root}task-lists/`),
    mailContacts: (query, options) => http.request(`${root}mail-contacts/?${new URLSearchParams({q:query})}`, options),
    contacts: (query, options) => http.request(`${root}contacts/?${new URLSearchParams({ q: query })}`, options),
    createTask: body => http.request(`${root}tasks/`, { method: "POST", body }),
    updateTask: (listId, id, body) => http.request(`${root}tasks/${encodeURIComponent(listId)}/${encodeURIComponent(id)}/`, { method: "PATCH", body }),
    removeTask: (listId, id) => http.request(`${root}tasks/${encodeURIComponent(listId)}/${encodeURIComponent(id)}/`, { method: "DELETE" }),
};
