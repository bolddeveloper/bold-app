import { syncDiagnostics } from "./sync_diagnostics.js";
import { suspendGoogleCache } from "./google_cache.js";
import { resolveImageUrls } from "./shared/media_urls.js";
export const is_using_real_backend = () => import.meta.env?.VITE_USE_REAL_BACKEND === "true";
export const api_base_url = import.meta.env?.VITE_API_BASE_URL || globalThis.location?.origin || "http://127.0.0.1:8000";

export class ApiError extends Error {
    constructor(status, details) {
        const fields = typeof details === "object" && details ? details : { detail: details };
        super(Object.entries(fields).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" ") : typeof value === "object" ? JSON.stringify(value) : value}`).join("\n") || `Error HTTP ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.fields = fields;
    }
}

export function createHttpClient({ baseUrl = api_base_url, fetchImpl = (...args) => fetch(...args), onUnauthorized = () => {}, now = () => Date.now() } = {}) {
    let authenticated = false, assignmentId = null, email = null, csrfToken = null;
    let controller = new AbortController();
    let quotaPause = null;
    const endpointPauses = new Map();
    function cancelRequests() { controller.abort(); controller = new AbortController(); }
    async function request(path, { method = "GET", body, responseType, anonymous = false, signal = controller.signal, timeoutMs, ...options } = {}) {
        const deadline = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
        const timeoutError = () => new ApiError(408, {detail: "El guardado tardó demasiado. Conservamos el borrador. Comprueba si la tarea aparece antes de reintentar."});
        signal = AbortSignal.any([controller.signal, signal, ...(deadline ? [deadline] : [])]);
        const base = new URL(baseUrl);
        let url = new URL(path, base);
        const loopback = host => ["localhost", "127.0.0.1", "[::1]"].includes(host);
        if (url.origin !== base.origin && loopback(url.hostname) && loopback(base.hostname)) url = new URL(`${url.pathname}${url.search}`, base);
        if (url.origin !== base.origin || !url.pathname.startsWith("/api/v2/")) throw new Error("Ruta de API no permitida.");
        if (deadline?.aborted) throw timeoutError();
        if (signal.aborted) throw new DOMException("Contexto cancelado", "AbortError");
        const pause = quotaPause?.until > now() ? quotaPause : endpointPauses.get(url.pathname);
        if (pause?.until > now()) { pause.error.retryAfterMs = pause.until - now(); throw pause.error; }
        let response;
        const unsafe = !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
        const multipart = typeof FormData !== "undefined" && body instanceof FormData;
        const csrf = csrfToken || globalThis.document?.cookie?.split("; ").find(item => item.startsWith("csrftoken="))?.split("=").slice(1).join("=");
        const finishDiagnostic = syncDiagnostics.beginHttp(url.pathname, method);
        try {
            response = await fetchImpl(url.href, {
                ...options, method, signal, credentials: "include",
                headers: { ...(!multipart ? { "Content-Type": "application/json" } : {}), ...(unsafe && csrf ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}), ...(!anonymous && assignmentId ? { "X-Assignment-ID": assignmentId } : {}), ...options.headers },
                ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {})
            });
        } catch (error) {
            finishDiagnostic(signal.aborted || error.name === "AbortError" ? "cancelled" : "network-error");
            if (deadline?.aborted) throw timeoutError();
            if (signal.aborted || error.name === "AbortError") throw error;
            throw new ApiError(0, { detail: "No se pudo conectar con el servidor. Comprueba que el backend esté activo y que permita el origen de esta página (CORS)." });
        }
        finishDiagnostic(response.status);
        if (deadline?.aborted) throw timeoutError();
        if (signal.aborted) throw new DOMException("Contexto cancelado", "AbortError");
        if (response.status === 204) return null;
        if (response.ok && responseType === "blob") return response.blob();
        let raw;
        try { raw = await response.text(); }
        catch (error) { if (deadline?.aborted) throw timeoutError(); throw error; }
        if (deadline?.aborted) throw timeoutError();
        if (signal.aborted) throw new DOMException("Contexto cancelado", "AbortError");
        let data;
        try { data = raw ? JSON.parse(raw) : null; } catch {
            data = { detail: response.status >= 500
                ? "El servidor tuvo un error interno. Inténtalo de nuevo en unos momentos."
                : "El servidor devolvió una respuesta inesperada." };
        }
        if (data?.csrf_token) csrfToken = data.csrf_token;
        if (!response.ok) {
            if (response.status === 401 && !anonymous) onUnauthorized();
            const quotaExceeded = /cloudflare/i.test(raw) && /\b1027\b/.test(raw);
            const error = new ApiError(response.status, quotaExceeded
                ? { detail: "El servicio alcanzó su límite de peticiones. La sincronización está pausada temporalmente.", code: "service_quota_exceeded" } : data);
            if (response.status === 429 || quotaExceeded) {
                const retry = response.headers?.get?.("Retry-After");
                const retryAfterMs = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 0;
                error.retryAfterMs = Math.max(quotaExceeded ? 300_000 : 30_000, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
                error.quotaExceeded = quotaExceeded;
                const pause = { error, until: now() + error.retryAfterMs };
                if (quotaExceeded) quotaPause = pause;
                else { endpointPauses.set(url.pathname, pause); if (endpointPauses.size > 100) endpointPauses.delete(endpointPauses.keys().next().value); }
            }
            throw error;
        }
        endpointPauses.delete(url.pathname);
        return resolveImageUrls(data, baseUrl, assignmentId);
    }
    async function listPage(resource, params = {}, { next = null, ...options } = {}) {
        if (!/^[a-z][a-z0-9-]*$/.test(resource)) throw new Error("Recurso de API no permitido.");
        const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
        const collection = `/api/v2/${resource}/`;
        let path = `${collection}?${query}`;
        if (next) {
            // Trusted API pagination can contain the private proxy hostname.
            // Never follow it off-origin or into another collection/scope.
            const nextUrl = new URL(next, baseUrl);
            if (nextUrl.pathname !== collection) throw new Error("Ruta de paginación no permitida.");
            for (const [key, value] of query) if (nextUrl.searchParams.get(key) !== value) throw new Error("El alcance de paginación cambió.");
            path = `${collection}${nextUrl.search}`;
        }
        const page = await request(path, options);
        if (Array.isArray(page)) return { results: page, count: page.length, next: null, previous: null };
        if (!Array.isArray(page?.results) || !Number.isSafeInteger(page.count) || page.count < 0) throw new Error("Página del servidor no válida.");
        return { results: page.results, count: page.count, next: page.next || null, previous: page.previous || null };
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
            const next = Array.isArray(page) ? null : page?.next;
            if (next) {
                // Los enlaces de paginación proceden de una respuesta API ya
                // autenticada. Conservamos únicamente ruta y query para que
                // un hostname privado del proxy nunca se convierta en una
                // navegación cross-origin, sin relajar request() para URLs
                // externas aportadas por otros consumidores.
                const nextUrl = new URL(next, baseUrl);
                if (!nextUrl.pathname.startsWith("/api/v2/")) throw new Error("Ruta de paginación no permitida.");
                path = `${nextUrl.pathname}${nextUrl.search}`;
            } else path = null;
        }
        return rows;
    }
    const create = (resource, body, options = {}) => request(`/api/v2/${resource}/`, { ...options, method: "POST", body });
    const update = (resource, id, body, options = {}) => request(`/api/v2/${resource}/${id}/`, { ...options, method: "PATCH", body });
    const remove = (resource, id, options = {}) => request(`/api/v2/${resource}/${id}/`, { ...options, method: "DELETE" });
    return {
        request, list, listPage, create, update, remove, cancelRequests,
        setSession(value, accountEmail = null) { if (!value || email && accountEmail !== email) suspendGoogleCache(); cancelRequests(); authenticated = Boolean(value); email = accountEmail; assignmentId = null; },
        setAssignment(value) { cancelRequests(); assignmentId = value; },
        getSession: () => ({ authenticated, assignmentId, email }),
    };
}

export const http = createHttpClient({ onUnauthorized: () => globalThis.dispatchEvent?.(new Event("bold:unauthorized")) });
