import {watch_pwa_updates} from "./pwa_updates.js";
import {showPwaUpdate} from './pwa_notice.js';

// Registers the Core-owned PWA service worker when the browser supports it.
export function register_service_worker() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    if (!import.meta.env.PROD) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
            registrations.forEach((registration) => {
                registration.unregister();
            });
        });

        return;
    }

    const start = () => {
        navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"}).then(registration => {
            watch_pwa_updates(registration, {notify: showPwaUpdate});
        }).catch(() => {
            return null;
        });
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, {once: true});
}
