import { CoreProvider, useCore } from "./core_provider.jsx";
import { ShellProvider } from "./app_shell.jsx";
import TasksModule from "../tareas/src/task_app.jsx";
import AdministrationModule from "../administrativo/admin_module.jsx";
import { team_members } from "../tareas/src/data/task_data.js";

const baseNavigation = [
    { id: "home", label: "Inicio", icon: "home" },
    { id: "tasks", label: "Tareas", icon: "check", default: true, brand: true },
    { id: "inbox", label: "Bandeja de entrada", icon: "inbox" },
    { id: "reports", label: "Informes", icon: "reports" },
];

const mockIdentity = { directory: team_members, assignments: team_members, activeAssignment: team_members[0] };

function ApplicationWorkspace() {
    const core = useCore();
    const navigation = core.account?.is_superuser
        ? [...baseNavigation, { id: "administration", label: "Administración", icon: "administration" }]
        : baseNavigation;
    return <ShellProvider navigation={navigation}>
        <TasksModule externalModules={{ administration: <AdministrationModule /> }} />
    </ShellProvider>;
}

export default function App() {
    return <CoreProvider loginTitle="Bold" mockIdentity={mockIdentity}><ApplicationWorkspace /></CoreProvider>;
}
