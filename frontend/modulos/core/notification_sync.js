import {contentCanRefresh} from "./refresh_coordinator.js";

// Push is primary. These bounded reads recover missed events and socket outages.
export const NOTIFICATION_HEALTHY_MS = 5 * 60_000;
export const NOTIFICATION_FALLBACK_MS = 60_000;
export const NOTIFICATION_FOCUS_MS = 15_000;

export function createNotificationSync({refresh, onError = () => {}, canRun = contentCanRefresh,
    now = Date.now, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout,
    target = globalThis.window, documentTarget = globalThis.document} = {}) {
    let timer = null, stopped = false, connected = false, lastAttempt = -Infinity, failures = 0;
    let inFlight = null, queuedEvent = false, queuedForce = false, retryAt = 0, missedEvent = false;
    function schedule(retryAfter = 0) {
        clearTimer(timer);
        if (stopped) return;
        const base = connected ? NOTIFICATION_HEALTHY_MS : NOTIFICATION_FALLBACK_MS;
        const delay = Math.max(retryAfter, retryAt - now(), Math.min(15 * 60_000, base * 2 ** Math.min(failures, 4)));
        timer = setTimer(() => {timer = null; request("notification-reconcile");}, delay * (1 + random() * .2));
    }
    function request(reason, {force = false, event = false} = {}) {
        if (stopped) return Promise.resolve();
        if (now() < retryAt) {missedEvent ||= event; schedule(); return Promise.resolve();}
        if (!force && !canRun()) {missedEvent ||= event || reason !== "notification-reconcile"; schedule(); return Promise.resolve();}
        if (inFlight) {queuedEvent ||= event; queuedForce ||= force; return inFlight;}
        missedEvent = false;
        lastAttempt = now();
        inFlight = Promise.resolve().then(() => refresh(reason, force)).then(() => {
            failures = 0; retryAt = 0;
        }).catch(error => {
            if (error?.name !== "AbortError" && !stopped) {
                failures++;
                retryAt = now() + Math.max(error?.retryAfterMs || 0, Math.min(15 * 60_000, NOTIFICATION_FALLBACK_MS * 2 ** Math.min(failures, 4)));
                onError(error);
            }
        }).finally(() => {
            inFlight = null;
            if (stopped) return;
            if (queuedEvent) {const force = queuedForce; queuedEvent = false; queuedForce = false; request("notification-event", {event: true, force});}
            else schedule();
        });
        return inFlight;
    }
    const recover = () => {
        if (canRun() && (missedEvent || now() - lastAttempt >= NOTIFICATION_FOCUS_MS)) request("notification-focus");
    };
    target?.addEventListener("focus", recover);
    target?.addEventListener("online", recover);
    documentTarget?.addEventListener("visibilitychange", recover);
    return {
        request,
        connection(status) {connected = status === "open"; schedule();},
        dispose() {
            stopped = true; queuedEvent = false; clearTimer(timer);
            target?.removeEventListener("focus", recover);
            target?.removeEventListener("online", recover);
            documentTarget?.removeEventListener("visibilitychange", recover);
        },
    };
}
