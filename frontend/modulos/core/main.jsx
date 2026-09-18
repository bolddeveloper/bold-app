import { StrictMode as strict_mode, createElement as create_element } from "react";
import { createRoot as create_root } from "react-dom/client";
import app from "./app.jsx";
import { register_service_worker } from "./service_worker.js";
import "../tareas/src/styles.css";
import "./shared/responsive.css";
import "./app_shell.css";
import "./login_screen.css";
import "../tareas/src/tasks_mobile.css";
import "../tareas/src/tasks_tablet.css";
import "../tareas/src/theme_rework.css";
import "../administrativo/admin.css";
import "./shared/universal_responsive.css";


// Mounts the React application into the document root.
const root_element = document.getElementById("root");


// Starts the Bold tasks PWA when the document root is available.
if (root_element) {
    create_root(root_element).render(
        create_element(
            strict_mode,
            null,
            create_element(app)
        )
    );
}


// Registers the service worker after the interface has started.
register_service_worker();
