import { CoreProvider, useCore } from "./core_provider.jsx";
import { ShellProvider } from "./app_shell.jsx";
import TasksModule from "../tareas/src/task_app.jsx";
import AdministrationModule from "../administrativo/admin_module.jsx";
import PermissionsModule from "../permisos/permissions_module.jsx";
import CalendarModule from "../calendario/calendar_module.jsx";
import ProfileModule from "../perfil/profile_module.jsx";
import WorkspaceModule from "../docs/workspace_module.jsx?docs-uploads";
import SuggestionsModule from "../sugerencias/suggestions_module.jsx";
import { team_members } from "../tareas/src/data/task_data.js";
import { isControlPlaneContext } from "./core_models.js";
import ModuleNotice from "./shared/module_notice.jsx";

const baseNavigation = [
    { id: "home", label: "Inicio", icon: "home", default: true, group: "work" },
    { id: "tasks", label: "Tareas", icon: "check", brand: true, group: "work" },
    { id: "inbox", label: "Bandeja de entrada", icon: "inbox", group: "work" },
    { id: "calendar", label: "Calendario", icon: "calendar", group: "work" },
    { id: "docs", label: "Docs", icon: "docs", group: "work" },
    { id: "drive", label: "Drive", icon: "drive", group: "work" },
    { id: "suggestions", label: "Sugerencias", icon: "suggestions", group: "work" },
    { id: "reports", label: "Informes", icon: "reports", group: "management" },
];

const mockIdentity = { directory: team_members, assignments: team_members, activeAssignment: team_members[0] };

function ApplicationWorkspace() {
    const core = useCore();
    const isDirection = isControlPlaneContext(core.activeUnit, core.activeAssignment);
    const navigation = [
        {id: "profile", label: "Perfil", icon: "profile", group: "account"},
        ...baseNavigation,
        ...(isDirection ? [{ id: "permissions", label: "Permisos", icon: "permissions", group: "management" }] : []),
        ...(isDirection && core.account?.is_superuser ? [{ id: "administration", label: "Administración", icon: "administration", group: "management" }] : []),
    ];
    const externalModules = {
        profile: <ProfileModule/>,
        calendar: <ModuleNotice key="calendar" name="Calendario"><CalendarModule /></ModuleNotice>,
        docs: <ModuleNotice key="docs" name="Docs"><WorkspaceModule mode="docs" /></ModuleNotice>,
        drive: <ModuleNotice key="drive" name="Drive"><WorkspaceModule mode="drive" /></ModuleNotice>,
        suggestions: <SuggestionsModule />,
        ...(isDirection ? {
        permissions: <PermissionsModule />,
        ...(core.account?.is_superuser ? { administration: <AdministrationModule /> } : {}),
        } : {}),
    };
    return <ShellProvider key={core.activeAssignment?.id || "demo"} contextId={core.activeAssignment?.id || "demo"} navigation={navigation}>
        <TasksModule externalModules={externalModules} />
    </ShellProvider>;
}

export default function App() {
    return <CoreProvider loginTitle="Bold" mockIdentity={mockIdentity}><ApplicationWorkspace /></CoreProvider>;
}
