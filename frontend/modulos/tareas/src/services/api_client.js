export const is_using_real_backend = () => import.meta.env?.VITE_USE_REAL_BACKEND === "true";
export const api_base_url = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export class ApiError extends Error {
    constructor(status, details) {
        const fields = typeof details === "object" && details ? details : { detail: details };
        super(Object.entries(fields).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" ") : typeof value === "object" ? JSON.stringify(value) : value}`).join("\n") || `Error HTTP ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.fields = fields;
    }
}

export function createApiClient({ baseUrl = api_base_url, fetchImpl = (...args) => fetch(...args), onUnauthorized = () => {} } = {}) {
    let token = null, assignmentId = null, email = null;
    let controller = new AbortController();
    function cancelRequests() { controller.abort(); controller = new AbortController(); }
    async function request(path, { method = "GET", body, anonymous = false, signal = controller.signal, ...options } = {}) {
        const url = new URL(path, baseUrl);
        if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/v2/")) throw new Error("Ruta de API no permitida.");
        let response;
        try {
            response = await fetchImpl(url.href, {
                ...options, method, signal,
                headers: { "Content-Type": "application/json", ...(!anonymous && token ? { Authorization: `Token ${token}` } : {}), ...(!anonymous && assignmentId ? { "X-Assignment-ID": assignmentId } : {}), ...options.headers },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {})
            });
        } catch (error) {
            if (signal.aborted || error.name === "AbortError") throw error;
            throw new ApiError(0, { detail: "No se pudo conectar con el servidor. Comprueba que el backend esté activo y que permita el origen de esta página (CORS)." });
        }
        if (signal.aborted) throw new DOMException("Contexto cancelado", "AbortError");
        if (response.status === 204) return null;
        const raw = await response.text();
        if (signal.aborted) throw new DOMException("Contexto cancelado", "AbortError");
        let data;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = { detail: raw }; }
        if (!response.ok) {
            if (response.status === 401 && !anonymous) onUnauthorized();
            throw new ApiError(response.status, data);
        }
        return data;
    }
    async function list(resource, params = {}) {
        const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
        let path = `/api/v2/${resource}/?${query}`;
        const rows = [], seen = new Set(), signal = controller.signal;
        while (path) {
            if (seen.has(path)) throw new Error("Paginación circular del servidor.");
            seen.add(path);
            const page = await request(path, { signal });
            rows.push(...(Array.isArray(page) ? page : page?.results || []));
            path = Array.isArray(page) ? null : page?.next;
        }
        return rows;
    }
    const create = (resource, body) => request(`/api/v2/${resource}/`, { method: "POST", body });
    const update = (resource, id, body) => request(`/api/v2/${resource}/${id}/`, { method: "PATCH", body });
    const remove = (resource, id) => request(`/api/v2/${resource}/${id}/`, { method: "DELETE" });
    return {
        request, list, create, update, remove, cancelRequests,
        setToken(value, accountEmail = null) { cancelRequests(); token = value; email = accountEmail; assignmentId = null; },
        setAssignment(value) { cancelRequests(); assignmentId = value; },
        getSession: () => ({ token, assignmentId, email }),
        async login(username, password) {
            const result = await request("/api/v2/core/auth/token/", { method: "POST", body: { username, password }, anonymous: true });
            this.setToken(result.token, username.trim().toLowerCase());
            return result;
        },
        async getCurrentAccount() {
            const accounts = await list("core/user-accounts");
            const account = accounts.find(item => item.email.toLowerCase() === email);
            if (!account) throw new Error("No se pudo identificar la cuenta autenticada.");
            return account;
        },
        async listOwnAssignments(account) {
            const own = account || await this.getCurrentAccount();
            return (await list("core/position-assignments", { employee: own.employee })).filter(item => item.employee === own.employee && item.is_active && !item.released_at);
        },
        listAssignmentDirectory: () => list("core/position-assignments/directory"),
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

export const api = createApiClient({ onUnauthorized: () => globalThis.dispatchEvent?.(new Event("bold:unauthorized")) });
