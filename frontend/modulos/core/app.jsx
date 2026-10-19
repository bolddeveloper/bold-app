import { CoreProvider, useCore } from "./core_provider.jsx";
import { ShellProvider } from "./app_shell.jsx";
import TasksModule from "../tareas/src/task_app.jsx";
import AdministrationModule from "../administrativo/admin_module.jsx";
import PermissionsModule from "../permisos/permissions_module.jsx";
import CalendarModule from "../calendario/calendar_module.jsx";
import ProfileModule from "../perfil/profile_module.jsx";
import WorkspaceModule from "../docs/workspace_module.jsx?docs-uploads";
import SuggestionsModule from "../sugerencias/suggestions_module.jsx";
import BrandsModule from "../marcas/brands_module.jsx";
import { team_members } from "../tareas/src/data/task_data.js";
import { canUseManagementModule } from "./core_models.js";

import {lazy, Suspense, useEffect, useState} from "react";
import {sheetsCache} from "../hojas/sheets_cache.js";
const MessagingModule = lazy(() => import("../mensajeria/messaging_module.jsx"));
const SheetsModule = lazy(() => import("../hojas/sheets_module.jsx"));

const baseNavigation = [
    { id: "home", label: "Inicio", icon: "home", default: true, group: "work" },
    { id: "tasks", label: "Tareas", icon: "check", brand: true, group: "work" },
    { id: "inbox", label: "Bandeja de entrada", icon: "inbox", group: "work" },
    { id: "calendar", label: "Calendario", icon: "calendar", group: "work" },
    { id: "docs", label: "Docs", icon: "docs", group: "work" },
    { id: "drive", label: "Drive", icon: "drive", group: "work" },
    { id: "suggestions", label: "Sugerencias", icon: "suggestions", group: "work" },
    { id: "brands", label: "Marcas", icon: "brands", group: "work" },
    { id: "reports", label: "Informes", icon: "reports", group: "management" },
];

const mockIdentity = { directory: team_members, assignments: team_members, activeAssignment: team_members[0] };

function ApplicationWorkspace() {
    const core = useCore();
    const canChat = core.activeAssignment?.chat_enabled === true;
    const permissionContext = `${core.account?.id || "demo"}:${core.activeAssignment?.id || "demo"}`;
    const [sheetsPermission, setSheetsPermission] = useState(null);
    const canSheets = sheetsPermission?.context === permissionContext && sheetsPermission.allowed;
    useEffect(() => {
        let alive = true;
        const update = async () => {try {const allowed = await core.permissions.can("sheets.file.read"); if (alive) {setSheetsPermission({context: permissionContext, allowed}); if (!allowed && core.account?.id) {window.dispatchEvent(new CustomEvent("bold:sheets:revoked"));sheetsCache.clear(core.account.id).catch(() => {});}}} catch {if (alive) setSheetsPermission({context: permissionContext, allowed: false});}};
        update();
        window.addEventListener("bold:permissions-revision", update);
        return () => {alive = false; window.removeEventListener("bold:permissions-revision", update);};
    }, [permissionContext, core.permissions.can]);
    const canAdminister = canUseManagementModule("administration", core.account, core.activeUnit, core.activeAssignment);
    const canManagePermissions = canUseManagementModule("permissions", core.account, core.activeUnit, core.activeAssignment);
    const navigation = [
        {id: "profile", label: "Perfil", icon: "profile", group: "account"},
        ...baseNavigation,
        ...(canChat ? [{id: "messaging", label: "Chat", icon: "messaging", group: "work", unread: core.messaging?.unread?.total > 0}] : []),
        ...(canSheets ? [{id: "sheets", label: "Sheets", icon: "reports", group: "work"}] : []),
        ...(canManagePermissions ? [{ id: "permissions", label: "Permisos", icon: "permissions", group: "management" }] : []),
        ...(canAdminister ? [{ id: "administration", label: "Administración", icon: "administration", group: "management" }] : []),
    ];
    const externalModules = {
        profile: <ProfileModule/>,
        ...(canChat ? {messaging: <Suspense fallback={<p role="status">Cargando chat…</p>}><MessagingModule key={permissionContext}/></Suspense>} : {}),
        calendar: <CalendarModule key="calendar" />,
        docs: <WorkspaceModule key="docs" mode="docs" />,
        drive: <WorkspaceModule key="drive" mode="drive" />,
        suggestions: <SuggestionsModule />,
        ...(canSheets ? {sheets: <Suspense fallback={<p>Abriendo editor de Sheets…</p>}><SheetsModule/></Suspense>} : {}),
        brands: <BrandsModule key={core.activeAssignment?.id || "brands"} />,
        ...(canManagePermissions ? { permissions: <PermissionsModule /> } : {}),
        ...(canAdminister ? { administration: <AdministrationModule /> } : {}),
    };
    if (sheetsPermission?.context !== permissionContext) return <p role="status">Restaurando vista...</p>;
    return <ShellProvider key={core.activeAssignment?.id || "demo"} contextId={core.activeAssignment?.id || "demo"} navigation={navigation}>
        <TasksModule externalModules={externalModules} />
    </ShellProvider>;
}

export default function App() {
    return <CoreProvider loginTitle="Bold" mockIdentity={mockIdentity}><ApplicationWorkspace /></CoreProvider>;
}
