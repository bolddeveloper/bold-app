import { CoreProvider, useCore } from "./core_provider.jsx";
import { ShellProvider } from "./app_shell.jsx";
import TasksModule from "../tareas/src/task_app.jsx";
import AdministrationModule from "../administrativo/admin_module.jsx";
import PermissionsModule from "../permisos/permissions_module.jsx";
import CalendarModule from "../calendario/calendar_module.jsx";
import ProfileModule from "../perfil/profile_module.jsx";
import {NoteViewer} from "../perfil/news_preferences.jsx";
import {getReleaseNotes} from "../perfil/release_notes.js";
import {channelLinkTarget} from "../mensajeria/channel_links.js";
import GoogleConnection from "../docs/google_connection.jsx";
import WorkspaceModule from "../docs/workspace_module.jsx?docs-uploads";
import SuggestionsModule from "../sugerencias/suggestions_module.jsx";
import { team_members } from "../tareas/src/data/task_data.js";
import { canUseManagementModule } from "./core_models.js";
import {hasChatAttention,hasSlackAttention} from './reading_attention.js';

import {Component, lazy, Suspense, useEffect, useState} from "react";
import {takePhoneEntry, watchPhoneEntry} from "../mensajeria/phone_transfer_api.js";
const initialPhoneEntry = takePhoneEntry();
const PhoneUploadPage = lazy(() => import("../mensajeria/phone_upload_page.jsx"));
import {sheetsCache} from "../hojas/sheets_cache.js";
const MessagingModule = lazy(() => import("../mensajeria/messaging_module.jsx"));
const ChannelModule = lazy(() => import("../mensajeria/channel_module.jsx"));
const SheetsModule = lazy(() => import("../hojas/sheets_module.jsx"));

class SlackErrorBoundary extends Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        console.error("Error al abrir Slack.", error);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return <div className="app_error_fallback">
            <strong role="alert">No se pudo abrir Slack.</strong>
            <button type="button" onClick={() => window.location.reload()}>Recargar BOLD</button>
        </div>;
    }
}

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
        ...baseNavigation.filter(item=>item.id!=='reports'||core.activeAssignment?.reports_enabled===true),
        ...(canChat ? [{id: "messaging", label: "Chat", icon: "messaging", group: "work", unread: hasChatAttention(core.messaging?.unread)}] : []),
        ...(canChat ? [{id: "slack", label: "Slack", icon: "slack", group: "work", unread:hasSlackAttention(core.slack?.unread,core.messaging?.unread)}] : []),
        ...(canSheets ? [{id: "sheets", label: "Sheets", icon: "sheets", group: "work"}] : []),
        ...(canManagePermissions ? [{ id: "permissions", label: "Permisos", icon: "permissions", group: "management" }] : []),
        ...(canAdminister ? [{ id: "administration", label: "Administración", icon: "administration", group: "management" }] : []),
    ];
    const externalModules = {
        welcomeConnection: <GoogleConnection/>,
        profile: <ProfileModule/>,
        ...(canChat ? {messaging: <Suspense fallback={<p role="status">Cargando chat…</p>}><MessagingModule key={permissionContext}/></Suspense>} : {}),
        ...(canChat ? {slack: <SlackErrorBoundary key={permissionContext}><Suspense fallback={<p role="status">Cargando canales…</p>}><ChannelModule/></Suspense></SlackErrorBoundary>} : {}),
        calendar: <CalendarModule key="calendar" />,
        docs: <WorkspaceModule key="docs" mode="docs" />,
        drive: <WorkspaceModule key="drive" mode="drive" />,
        suggestions: <SuggestionsModule />,
        ...(canSheets ? {sheets: <Suspense fallback={<p>Abriendo editor de Sheets…</p>}><SheetsModule/></Suspense>} : {}),
        ...(canManagePermissions ? { permissions: <PermissionsModule /> } : {}),
        ...(canAdminister ? { administration: <AdministrationModule /> } : {}),
    };
    if (sheetsPermission?.context !== permissionContext) return <p role="status">Restaurando vista...</p>;
    return <ShellProvider key={core.activeAssignment?.id || "demo"} contextId={core.activeAssignment?.id || "demo"} navigation={navigation}
        initialSlackTarget={channelLinkTarget(window.location.search)} news={{notes: getReleaseNotes(core.activeAssignment), Viewer: NoteViewer}}>
        <TasksModule externalModules={externalModules} />
    </ShellProvider>;
}

export default function App() {
    const [phoneEntry, setPhoneEntry] = useState(initialPhoneEntry);
    useEffect(() => watchPhoneEntry(setPhoneEntry), []);
    if (phoneEntry) return phoneEntry.link
        ? <Suspense fallback={<p role="status">Abriendo transferencia…</p>}><PhoneUploadPage key={phoneEntry.link.id} link={phoneEntry.link}/></Suspense>
        : <main><h1>Vínculo de transferencia no válido</h1><p>Genera un nuevo QR desde Chat o Slack en el ordenador.</p></main>;
    return <CoreProvider loginTitle="Bold" mockIdentity={mockIdentity}><ApplicationWorkspace /></CoreProvider>;
}
