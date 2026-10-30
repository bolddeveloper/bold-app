import {http} from "./http_client.js";

const prefix = "bold-background-push:";
const identity = scope => scope?.accountId && scope?.assignmentId ? `${scope.accountId}:${scope.assignmentId}` : "";
const eventName = "bold:background-push-changed";

export function createBackgroundPush({client = http, serviceWorker = globalThis.navigator?.serviceWorker,
    notifications = globalThis.Notification, supported = () => !!globalThis.PushManager,
    storage, host = globalThis.window} = {}) {
    if (storage === undefined) {try {storage = globalThis.localStorage;} catch {storage = null;}}
    let current = "", generation = 0, binding = null;
    const notify = () => host?.dispatchEvent(new Event(eventName));
    const optedIn = scope => {try {return storage?.getItem(prefix + identity(scope)) === "yes";} catch {return false;}};
    const remember = (scope, value) => {try {if (value) storage?.setItem(prefix + identity(scope), "yes"); else storage?.removeItem(prefix + identity(scope));} catch { /* Consent is usable for this session even if storage is unavailable. */ }};
    async function register(scope, explicit) {
        const key = identity(scope);
        if (!key || notifications?.permission !== "granted" || !serviceWorker || !supported()) return false;
        if (!explicit && !optedIn(scope)) return false;
        const ticket = ++generation; current = key; binding = null; notify();
        const valid = () => generation === ticket && current === key;
        const config = await client.request("/api/v2/notifications/push/config/", {timeoutMs: 10000});
        if (!valid()) return false;
        if (!config.enabled || !config.public_key) {
            if (explicit) throw new Error("El servidor todavía no tiene activadas las notificaciones con la aplicación cerrada.");
            return false;
        }
        const registration = await serviceWorker.getRegistration("/");
        if (!valid()) return false;
        if (!registration?.active || !registration.pushManager) throw new Error("Recarga BOLD para activar su servicio de notificaciones e inténtalo de nuevo.");
        let subscription = await registration.pushManager.getSubscription();
        if (!valid()) return false;
        if (!subscription) {
            const raw = atob(config.public_key.replaceAll("-", "+").replaceAll("_", "/"));
            subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, char => char.charCodeAt(0))});
        }
        if (!valid()) return false;
        const result = await client.request("/api/v2/notifications/push/devices/", {method: "POST", body: subscription.toJSON(), timeoutMs: 10000});
        if (!valid() || result.assignment_id !== scope.assignmentId) return false;
        binding = result; remember(scope, true); notify(); return true;
    }
    return {
        enable: scope => register(scope, true),
        sync: scope => register(scope, false).catch(() => false),
        active: scope => current === identity(scope) && !!binding,
        async disable(scope) {
            const saved = current === identity(scope) ? binding : null;
            const ticket = ++generation; binding = null; remember(scope, false); notify();
            let failure;
            try {if (saved) await client.request(`/api/v2/notifications/push/devices/${saved.device_id}/`, {method: "DELETE", timeoutMs: 10000});}
            catch (error) {failure = error;}
            if (generation !== ticket) return false;
            const registration = await serviceWorker?.getRegistration("/");
            const subscription = await registration?.pushManager?.getSubscription();
            if (generation !== ticket) return false;
            const removed = await subscription?.unsubscribe();
            if (failure && subscription && !removed) throw failure;
            return true;
        },
        suspend() {generation++; current = ""; binding = null; notify();},
    };
}

export const backgroundPush = createBackgroundPush();
export const backgroundPushScope = state => ({accountId: state.account?.id, assignmentId: state.activeAssignment?.id});
globalThis.addEventListener?.("bold:private-cache-suspend", () => backgroundPush.suspend());
globalThis.addEventListener?.("bold:private-cache-clear", () => backgroundPush.suspend());
