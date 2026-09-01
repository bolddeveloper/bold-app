// Registers the PWA service worker when the browser supports it.
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

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
            return null;
        });
    });
}
