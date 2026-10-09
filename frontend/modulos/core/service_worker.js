import {watch_pwa_updates} from "./pwa_updates.js";
import {confirmBold} from "./shared/bold_dialog.js";

function show_update(apply) {
    if (document.getElementById("bold-pwa-update")) return;
    const banner = document.createElement("aside");
    banner.id = "bold-pwa-update";
    banner.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = "Hay una nueva versión de BOLD. No necesitas reinstalar la aplicación.";
    const button = document.createElement("button");
    button.textContent = "Actualizar";
    button.addEventListener("click", async () => {
        button.disabled = true;
        if (await confirmBold("Guarda los cambios pendientes antes de continuar. ¿Recargar BOLD para aplicar la actualización?")) apply();
        else button.disabled = false;
    });
    banner.append(text, button);
    document.body.append(banner);
}

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
            watch_pwa_updates(registration, {notify: show_update});
        }).catch(() => {
            return null;
        });
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, {once: true});
}
