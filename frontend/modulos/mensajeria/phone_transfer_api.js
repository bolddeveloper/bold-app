import {http} from "../core/http_client.js";

export const phoneRoot = "/api/v2/messaging/phone-transfers/";
export function phoneLink(identity, token, origin = globalThis.location.origin) {
    return `${origin}/#phone-transfer=${identity}.${token}`;
}
export function readPhoneLink(hash) {
    const match = /^#phone-transfer=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(hash || "");
    return match ? {id: match[1], token: match[2]} : null;
}
export function takePhoneEntry(location = globalThis.location, history = globalThis.history) {
    if (!location?.hash.startsWith("#phone-transfer")) return null;
    const entry = {link: readPhoneLink(location.hash)};
    history.replaceState(null, "", location.pathname + location.search + "#phone-transfer");
    return entry;
}
export function watchPhoneEntry(notify, target = globalThis.window, read = takePhoneEntry) {
    const changed = () => notify(read());
    target.addEventListener("hashchange", changed);
    return () => target.removeEventListener("hashchange", changed);
}
export function phoneSecret() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
}
export const phoneApi = {
    create: (target, options) => http.request(phoneRoot, {...options, method: "POST", body: target}),
    status: (id, options) => http.request(`${phoneRoot}${id}/`, options),
    approve: (id, code, options) => http.request(`${phoneRoot}${id}/approve/`, {...options, method: "POST", body: {pairing_code: code}}),
    seal: (id, options) => http.request(`${phoneRoot}${id}/seal/`, {...options, method: "POST", body: {}}),
    cancel: id => http.request(`${phoneRoot}${id}/`, {method: "DELETE", timeoutMs: 10000}),
    image: (id, image, options) => http.request(`${phoneRoot}${id}/images/${image}/`, {...options, responseType: "blob"}),
};
export async function phoneRequest(id, token, action, {file, clientId, deviceToken, signal} = {}) {
    const body = file ? new FormData() : deviceToken ? JSON.stringify({device_token: deviceToken}) : undefined;
    if (file) {body.set("file", file, file.name); body.set("client_id", clientId);}
    const response = await fetch(`${phoneRoot}${id}/${action}/`, {method: body ? "POST" : "GET", credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
        headers: {Authorization: `Bearer ${token}`, ...(deviceToken ? {"Content-Type": "application/json"} : {})}, body});
    const data = await response.json().catch(() => null);
    if (!response.ok) {const error = Error(data?.detail || (Array.isArray(data) ? data.join(" ") : "No se pudo completar la transferencia. Inténtalo de nuevo.")); error.status = response.status; throw error;}
    return data;
}
