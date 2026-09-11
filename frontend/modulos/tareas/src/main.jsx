import { StrictMode as strict_mode, createElement as create_element } from "react";
import { createRoot as create_root } from "react-dom/client";
import task_app from "./app.jsx";
import { register_service_worker } from "./service_worker.js";
import "./styles.css";
import "../../core/shared/responsive.css";
import "../../core/app_shell.css";
import "./tasks_mobile.css";
import "./tasks_tablet.css";


// Mounts the React application into the document root.
const root_element = document.getElementById("root");


// Starts the Bold tasks PWA when the document root is available.
if (root_element) {
    create_root(root_element).render(
        create_element(
            strict_mode,
            null,
            create_element(task_app)
        )
    );
}


// Registers the service worker after the interface has started.
register_service_worker();
