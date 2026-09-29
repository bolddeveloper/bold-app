import { CoreProvider, useCore } from "./core_provider.jsx";
import { ShellProvider } from "./app_shell.jsx";
import TasksModule from "../tareas/src/task_app.jsx";
import AdministrationModule from "../administrativo/admin_module.jsx";
import PermissionsModule from "../permisos/permissions_module.jsx";
import { team_members } from "../tareas/src/data/task_data.js";
import { isControlPlaneContext } from "./core_models.js";

const baseNavigation = [
    { id: "home", label: "Inicio", icon: "home", default: true, group: "work" },
    { id: "tasks", label: "Tareas", icon: "check", brand: true, group: "work" },
    { id: "inbox", label: "Bandeja de entrada", icon: "inbox", group: "work" },
    { id: "reports", label: "Informes", icon: "reports", group: "management" },
];

const mockIdentity = { directory: team_members, assignments: team_members, activeAssignment: team_members[0] };

function ApplicationWorkspace() {
    const core = useCore();
    const isDirection = isControlPlaneContext(core.activeUnit, core.activeAssignment);
    const navigation = [
        ...baseNavigation,
        ...(isDirection ? [{ id: "permissions", label: "Permisos", icon: "permissions", group: "management" }] : []),
        ...(isDirection && core.account?.is_superuser ? [{ id: "administration", label: "Administración", icon: "administration", group: "management" }] : []),
    ];
    const externalModules = isDirection ? {
        permissions: <PermissionsModule />,
        ...(core.account?.is_superuser ? { administration: <AdministrationModule /> } : {}),
    } : {};
    return <ShellProvider navigation={navigation}>
        <TasksModule externalModules={externalModules} />
    </ShellProvider>;
}

export default function App() {
    return <CoreProvider loginTitle="Bold" mockIdentity={mockIdentity}><ApplicationWorkspace /></CoreProvider>;
}
