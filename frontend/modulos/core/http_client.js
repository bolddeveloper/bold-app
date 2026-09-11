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

export function createHttpClient({ baseUrl = api_base_url, fetchImpl = (...args) => fetch(...args), onUnauthorized = () => {} } = {}) {
    let token = null, assignmentId = null, email = null;
    let controller = new AbortController();
    function cancelRequests() { controller.abort(); controller = new AbortController(); }
    async function request(path, { method = "GET", body, anonymous = false, signal = controller.signal, ...options } = {}) {
        signal = AbortSignal.any([controller.signal, signal]);
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
    async function list(resource, params = {}, options = {}) {
        const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
        let path = `/api/v2/${resource}/?${query}`;
        const rows = [], seen = new Set(), signal = AbortSignal.any([controller.signal, options.signal || controller.signal]);
        while (path) {
            if (seen.has(path)) throw new Error("Paginación circular del servidor.");
            seen.add(path);
            const page = await request(path, { signal });
            rows.push(...(Array.isArray(page) ? page : page?.results || []));
            path = Array.isArray(page) ? null : page?.next;
        }
        return rows;
    }
    const create = (resource, body, options = {}) => request(`/api/v2/${resource}/`, { ...options, method: "POST", body });
    const update = (resource, id, body, options = {}) => request(`/api/v2/${resource}/${id}/`, { ...options, method: "PATCH", body });
    const remove = (resource, id, options = {}) => request(`/api/v2/${resource}/${id}/`, { ...options, method: "DELETE" });
    return {
        request, list, create, update, remove, cancelRequests,
        setToken(value, accountEmail = null) { cancelRequests(); token = value; email = accountEmail; assignmentId = null; },
        setAssignment(value) { cancelRequests(); assignmentId = value; },
        getSession: () => ({ token, assignmentId, email }),
    };
}

export const http = createHttpClient({ onUnauthorized: () => globalThis.dispatchEvent?.(new Event("bold:unauthorized")) });
