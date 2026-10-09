// Bounded checks; never discard a user's work by automatically reloading.
export function watch_pwa_updates(registration, {container = navigator.serviceWorker,
    page = document, host = window, online = () => navigator.onLine !== false,
    now = Date.now, notify, reload = () => host.location.reload()} = {}) {
    let lastCheck = -Infinity, checking = false, reloading = false, reloaded = false;
    let controlled = Boolean(container.controller);
    const workers = new Set();
    const finish = () => {if (!reloaded) {reloaded = true; reload();}};
    const offer = () => notify(() => {
        if (reloading) return;
        reloading = true;
        if (registration.waiting) registration.waiting.postMessage({type: "BOLD_SKIP_WAITING"});
        else finish();
    });
    const installed = () => {if (registration.waiting && container.controller) offer();};
    const observe = () => {
        const worker = registration.installing;
        if (worker && !workers.has(worker)) {workers.add(worker); worker.addEventListener("statechange", installed);}
    };
    const controllerChanged = () => {
        if (reloading) finish();
        else if (controlled) offer();
        controlled = true;
    };
    const check = async () => {
        if (checking || page.visibilityState === "hidden" || !online() || now() - lastCheck < 10 * 60 * 1000) return;
        checking = true; lastCheck = now();
        try {await registration.update(); installed();} catch { /* Retry later; offline isn't fatal. */ }
        finally {checking = false;}
    };
    registration.addEventListener("updatefound", observe);
    container.addEventListener("controllerchange", controllerChanged);
    page.addEventListener("visibilitychange", check);
    host.addEventListener("online", check);
    host.addEventListener("focus", check);
    const timer = host.setInterval(check, 30 * 60 * 1000);
    observe(); installed(); check();
    return () => {
        host.clearInterval(timer);
        registration.removeEventListener("updatefound", observe);
        container.removeEventListener("controllerchange", controllerChanged);
        page.removeEventListener("visibilitychange", check);
        host.removeEventListener("online", check);
        host.removeEventListener("focus", check);
        workers.forEach(worker => worker.removeEventListener("statechange", installed));
    };
}
