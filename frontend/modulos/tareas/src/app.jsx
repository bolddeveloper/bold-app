import { CoreProvider } from "../../core/core_provider.jsx";
import { ShellProvider } from "../../core/app_shell.jsx";
import TasksModule from "./task_app.jsx";
import { team_members } from "./data/task_data.js";
const navigation = [
    { id: "home", label: "Inicio", icon: "home" },
    { id: "tasks", label: "Tareas", icon: "check", default: true, brand: true },
    { id: "inbox", label: "Bandeja de entrada", icon: "inbox" },
    { id: "reports", label: "Informes", icon: "reports" }
];
const mockIdentity = { directory: team_members, assignments: team_members, activeAssignment: team_members[0] };
export default function App() {
    return <CoreProvider loginTitle="Bold · Tareas" mockIdentity={mockIdentity}><ShellProvider navigation={navigation}><TasksModule /></ShellProvider></CoreProvider>;
}
