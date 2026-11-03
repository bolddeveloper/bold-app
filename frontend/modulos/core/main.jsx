import { StrictMode as strict_mode, createElement as create_element } from "react";
import { createRoot as create_root } from "react-dom/client";
import app from "./app.jsx";
import { register_service_worker } from "./service_worker.js";
import "../tareas/src/styles.css";
import "./shared/responsive.css";
import "./app_shell.css";
import "./pwa_updates.css";
import "./login_screen.css";
import "../tareas/src/tasks_mobile.css";
import "../tareas/src/tasks_tablet.css";
import "../tareas/src/theme_rework.css";
import "../administrativo/admin.css";
import "./shared/universal_responsive.css";
// Module styles are loaded by the entry point, including during local hot reload.
import "../docs/development_notice.css";
import "../perfil/shortcut_preferences.css";
import "../mensajeria/phone_transfer.css";
import "./design_v3.css";
import "./workspace_v3.css";
import "../tareas/src/task_workspace_v3.css";
import "../tareas/src/task_detail_v3.css";
import "../tareas/src/team_workspace_v3.css";
import "../tareas/src/pipeline_workspace_v3.css";
import "../tareas/src/workspace_organization_v3.css";
import "../tareas/src/project_workspace_v3.css";
import "./motion_v3.css";


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
