export function isStoredImageUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value, globalThis.location?.origin || "http://localhost");
        const origin = globalThis.location?.origin || "http://localhost";
        const apiOrigin = new URL(import.meta.env?.VITE_API_BASE_URL || origin).origin;
        return /^\/api\/v2\/media\/images\/[0-9a-f-]{36}\/$/.test(url.pathname) && [origin, apiOrigin].includes(url.origin);
    } catch { return false; }
}

// Resolve protected images at the API boundary so avatars and rich text share the selected assignment.
export function resolveImageUrls(value, baseUrl, assignment) {
    if (typeof value === "string") return value.replace(/(?:https?:\/\/[^\s"'<>]+)?\/api\/v2\/media\/images\/[0-9a-f-]{36}\/(?:\?assignment=[0-9a-f-]+)?/g, matched => {
        const path = new URL(matched, baseUrl).pathname;
        const url = new URL(path, baseUrl);
        if (assignment) url.searchParams.set("assignment", assignment);
        return url.href;
    });
    if (Array.isArray(value)) return value.map(item => resolveImageUrls(item, baseUrl, assignment));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveImageUrls(item, baseUrl, assignment)]));
    return value;
}
