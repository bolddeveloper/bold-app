import { http } from "../core/http_client.js";
import { confirmGoogleConnection, clearGoogleCache } from "../core/google_cache.js";
const root = "/api/v2/workspace/";
const file = id => `${root}files/${encodeURIComponent(id)}/`;
export const workspaceApi = {
    publishedView: id => http.request(`${file(id)}published-view/`),
    savePublishedView: (id, url) => http.request(`${file(id)}published-view/`, {method: "PUT", body: {url}}),
    removePublishedView: id => http.request(`${file(id)}published-view/`, {method: "DELETE"}),
    connection: options => http.request(`${root}connection/`, options).then(confirmGoogleConnection),
    disconnect: async () => {await http.request(`${root}connection/`, { method: "DELETE" }); clearGoogleCache(); globalThis.dispatchEvent?.(new Event("bold:google-connection-changed"));},
    start: (service = "all") => http.request(`${root}oauth/start/`, { method: "POST", body: {service} }),
    files: (params, options) => http.request(`${root}files/?${new URLSearchParams(Object.entries(params).filter(([, value]) => value))}`, options),
    drives: (page = "") => http.request(`${root}drives/?${new URLSearchParams({page})}`),
    about: () => http.request(`${root}about/`),
    metadata: id => http.request(file(id)),
    openOffice: id => http.request(`${file(id)}open-office/`, {method: "POST", body: {}}),
    editor: (id, range = "") => http.request(`${file(id)}editor/?${new URLSearchParams(range ? {range} : {})}`),
    edit: (id, body) => http.request(`${file(id)}editor/`, {method: "POST", body}),
    move: (id, parent) => http.request(`${file(id)}move/`, {method: "POST", body: {parent}}),
    preview: (id, options) => http.request(`${file(id)}preview/`, {responseType: "blob", ...options}),
    create: body => http.request(`${root}files/`, { method: "POST", body }),
    update: (id, body) => http.request(file(id), { method: "PATCH", body }),
    copy: id => http.request(`${file(id)}copy/`, { method: "POST", body: {} }),
    upload: (body, options) => http.request(`${root}upload/`, { method: "POST", body, ...options }),
    permissions: (id, page = "") => http.request(`${file(id)}permissions/?${new URLSearchParams({page})}`),
    share: (id, body) => http.request(`${file(id)}permissions/`, { method: "POST", body }),
    permission: (id, permission, body) => http.request(`${file(id)}permissions/${encodeURIComponent(permission)}/`, {method: body ? "PATCH" : "DELETE", ...(body ? {body} : {})}),
    download: (id, format, editorExport = false) => http.request(`${file(id)}download/?${new URLSearchParams({export_format: format || "pdf", ...(editorExport ? {editor_export: "true"} : {})})}`, { responseType: "blob" }),
};
