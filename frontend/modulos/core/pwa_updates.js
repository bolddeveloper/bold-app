// Bounded checks; never discard a user's work by automatically reloading.
export function watch_pwa_updates(registration, {container = navigator.serviceWorker,
    page = document, host = window, online = () => navigator.onLine !== false,
    now = Date.now, notify, reload = () => host.location.reload()} = {}) {
    let lastCheck = -Infinity, checking = false, reloading = false, reloaded = false,disposed=false;
    let activationTimer=null,reloadTimer=null,reloadRequest=null;
    const delay=(callback,ms)=>(host.setTimeout || globalThis.setTimeout).call(host,callback,ms);
    const cancelTimer=timer=>{if(timer!==null)(host.clearTimeout || globalThis.clearTimeout).call(host,timer);};
    const clearTimers=()=>{cancelTimer(activationTimer);cancelTimer(reloadTimer);activationTimer=null;reloadTimer=null;};
    let controlled = Boolean(container.controller);
    const workers = new Set();
    const reset=reason=>{
        if(disposed || !reloading)return;
        clearTimers();reloading=false;reloaded=false;
        const request=reloadRequest;reloadRequest=null;request?.onRetry?.(reason);
    };
    const finish = () => {
        if(disposed || reloaded || !reloading)return;
        cancelTimer(activationTimer);activationTimer=null;reloaded=true;
        // A browser exit guard can cancel navigation after location.reload().
        // Reset only the controls if this document remains; NEVER auto-reload.
        reloadTimer=delay(()=>reset('reload_not_completed'),2000);
        try{reload();}catch{reset('reload_not_completed');}
    };
    const offer = () => !disposed && notify((request={}) => {
        if (disposed || reloading) return false;
        reloading = true;
        reloadRequest=request;
        if (registration.waiting){
            activationTimer=delay(()=>reset('activation_timeout'),15000);
            try{registration.waiting.postMessage({type: "BOLD_SKIP_WAITING"});}catch{reset('activation_timeout');}
        }
        else finish();
        return true;
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
        if (disposed || checking || page.visibilityState === "hidden" || !online() || now() - lastCheck < 10 * 60 * 1000) return;
        checking = true; lastCheck = now();
        try {await registration.update(); if(!disposed)installed();} catch { /* Retry later; offline isn't fatal. */ }
        finally {checking = false;}
    };
    const pageHidden=()=>clearTimers();
    const restored=event=>{if(event.persisted)reset('reload_not_completed');};
    registration.addEventListener("updatefound", observe);
    container.addEventListener("controllerchange", controllerChanged);
    page.addEventListener("visibilitychange", check);
    host.addEventListener("online", check);
    host.addEventListener("focus", check);
    host.addEventListener('pagehide',pageHidden);
    host.addEventListener('pageshow',restored);
    const timer = host.setInterval(check, 30 * 60 * 1000);
    observe(); installed(); check();
    return () => {
        disposed=true;clearTimers();reloadRequest=null;
        host.clearInterval(timer);
        registration.removeEventListener("updatefound", observe);
        container.removeEventListener("controllerchange", controllerChanged);
        page.removeEventListener("visibilitychange", check);
        host.removeEventListener("online", check);
        host.removeEventListener("focus", check);
        host.removeEventListener('pagehide',pageHidden);
        host.removeEventListener('pageshow',restored);
        workers.forEach(worker => worker.removeEventListener("statechange", installed));
    };
}
