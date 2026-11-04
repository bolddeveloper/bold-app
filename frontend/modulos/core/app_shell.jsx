import {HeaderNewsPanel} from "./header_news.jsx";
import {NotificationPanel} from "./notification_panel.jsx";
import "./shared/bold_dialog.css";
import {useKeyboardShortcuts} from "./use_keyboard_shortcuts.js";
import {confirmBold} from "./shared/bold_dialog.js";
import { ProfileAvatar, ProfileQuickMenu } from "./shared/profile_menu.jsx";
import { workspaceTabs, emptyWorkspaceTabs } from "./workspace_tabs.js";
import { ResponsiveOverlay } from "./shared/responsive_overlay.jsx";
import { useMediaQuery } from "./shared/use_media_query.js";
import { useDialog } from "./shared/use_dialog.js";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useReducer, createElement } from "react";
import { FileText as docs_icon, FolderOpen as drive_icon, ArrowLeft as arrow_left_icon, BarChart3 as bar_chart_icon, Table2 as sheets_icon, Bell as bell_icon, CalendarDays as calendar_icon, Check as check_icon, ChevronDown as chevron_down_icon, UsersRound as users_icon, CircleHelp as circle_help_icon, Newspaper as newspaper_icon, Home as home_icon, Inbox as inbox_icon, KeyRound as key_round_icon, Menu as menu_icon, MoreHorizontal as more_icon, PanelLeftClose as sidebar_toggle_icon, MessageCircle as chat_icon, Hash as channels_icon, Lightbulb as ideas_icon, Moon as moon_icon, Settings as settings_icon, Search as search_icon, ShieldCheck as shield_check_icon, Sun as sun_icon, X as x_icon } from "lucide-react";
import { useCore } from "./core_provider.jsx";
import { shouldLeaveRestrictedShellModule } from "./core_models.js";
import { searchNavigation } from "./global_search.js";
import { entranceModule, historyModule, isShellModuleAllowed } from "./shell_navigation_state.js";
import { startNotificationBellReminder } from "./notification_bell.js";
import {InterfaceWelcome} from "./interface_welcome.jsx";
const icon_map = { messaging: chat_icon, profile: settings_icon, docs: docs_icon, drive: drive_icon, home: home_icon, check: check_icon, inbox: inbox_icon, calendar: calendar_icon, reports: bar_chart_icon, sheets: sheets_icon, suggestions: ideas_icon, administration: shield_check_icon, permissions: key_round_icon };
icon_map.slack = channels_icon;
const render_icon = (icon, size) => createElement(icon, { size, strokeWidth: 2, "aria-hidden": "true" });
const ShellContext = createContext(null);
export const useShell = () => useContext(ShellContext);
export function ShellProvider({ children, navigation, contextId = "demo", initialSlackTarget = null, news }) {
    const storageKey = `bold_shell_module:${contextId}`;
    const [active_module, set_module] = useState(() => {
        let saved;
        try { saved = sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey); } catch { /* Optional navigation preference. */ }
        if(initialSlackTarget && isShellModuleAllowed("slack",navigation))return "slack";
        return entranceModule(navigation, saved);
    });
    useEffect(() => {
        if (isShellModuleAllowed(active_module, navigation)) {
            try { localStorage.setItem(storageKey, active_module); sessionStorage.setItem(storageKey, active_module); } catch { /* No authorization is stored here. */ }
        }
    }, [active_module, storageKey, navigation]);
    const [is_sidebar_open, set_is_sidebar_open] = useState(false);
    const [profile_editing, set_profile_editing] = useState(false);
    const [profile_tab, set_profile_tab] = useState("account");
    const [chat_target, set_chat_target] = useState(null);
    const [slack_target,set_slack_target]=useState(()=>{
        const target=isShellModuleAllowed("slack",navigation) ? initialSlackTarget : null;
        return target ? {...target,requestId:crypto.randomUUID()}:null;
    });
    const slack_dirty=useRef(false);
    const set_slack_dirty=value=>{slack_dirty.current=value;};
    const profile_dirty = useRef(false);
    const set_profile_dirty = value => {profile_dirty.current = value;};
    const [workspace_file, set_workspace_file] = useState(null);
    const [drive_folder, set_drive_folder] = useState(null);
    const [workspace_tab_state, workspace_dispatch] = useReducer(workspaceTabs, undefined, emptyWorkspaceTabs);
    const open_workspace_tab = file => workspace_dispatch({type: "open", file});
    const close_workspace_tab = id => workspace_dispatch({type: "close", id});
    const select_workspace_tab = id => workspace_dispatch({type: "select", id});
    const [workspace_connection, set_workspace_connection] = useState(null);
    const sync_workspace_account = connection => {
        set_workspace_connection(connection);
        workspace_dispatch({type: "account", key: connection.connection_key || ""});
    };
    const workspace_dirty = useRef(false);
    const workspace_busy = useRef(false);
    const set_workspace_dirty = value => {workspace_dirty.current = value;};
    const set_workspace_busy = value => {workspace_busy.current = value;};
    const set_active_module = async value => {
        if (!isShellModuleAllowed(value, navigation)) return false;
        if(active_module==="slack" && value!=="slack" && slack_dirty.current && !await confirmBold("¿Salir de Slack sin confirmar el guardado de la revisión? Comprueba que el borrador esté protegido antes de continuar. Salir no elimina ni pausa operaciones que el servidor haya recibido."))return false;
        if (active_module === "profile" && value !== "profile" && profile_dirty.current && !await confirmBold("¿Salir del perfil y descartar los cambios sin guardar?")) return false;
        if (active_module === "docs" && value !== "docs" && workspace_busy.current) return;
        if (active_module === "docs" && value !== "docs" && workspace_dirty.current && !await confirmBold("¿Salir de Docs y descartar los cambios sin guardar?")) return;
        workspace_dirty.current = false;
        set_module(value);
        return true;
    };
    // Historial nativo: Atrás/Adelante también funcionan con botones laterales del mouse.
    const historyPosition = useRef(window.history.state?.bold_navigation?.index || 0);
    const applyHistory = useRef(null);
    applyHistory.current = async event => {
        const target = event.state?.bold_navigation;
        const module = historyModule(target, contextId, navigation);
        if (!module) {
            window.history.replaceState({...window.history.state, bold_navigation: {context: contextId, module: active_module, tab: workspace_tab_state.active, index: historyPosition.current}}, "");
            return;
        }
        const changingFile = active_module === "docs" && module === "docs" && target.tab !== workspace_tab_state.active;
        const blockedFile = changingFile && (workspace_busy.current || workspace_dirty.current && !await confirmBold("¿Cambiar documento y descartar los cambios sin guardar?"));
        if (blockedFile || !await set_active_module(module)) {
            window.history.go(historyPosition.current - target.index);
            return;
        }
        historyPosition.current = target.index;
        if (module === "docs") {
            workspace_dirty.current = false;
            select_workspace_tab(workspace_tab_state.tabs.some(file => file.id === target.tab) ? target.tab : null);
        }
        set_is_sidebar_open(false);
    };
    useEffect(() => {
        const pop = event => applyHistory.current(event);
        window.addEventListener("popstate", pop);
        return () => window.removeEventListener("popstate", pop);
    }, []);
    useEffect(() => {
        const previous = window.history.state?.bold_navigation;
        const tab = active_module === "docs" ? workspace_tab_state.active : null;
        if (previous?.context === contextId && previous.module === active_module && previous.tab === tab) return;
        const replacing = !previous || previous.context !== contextId;
        const index = replacing ? historyPosition.current : historyPosition.current + 1;
        const state = {...window.history.state, bold_navigation: {context: contextId, module: active_module, tab, index}};
        window.history[replacing ? "replaceState" : "pushState"](state, "");
        historyPosition.current = index;
    }, [active_module, workspace_tab_state.active, contextId]);
    const [is_dark_mode, set_is_dark_mode] = useState(() => {
        try { const theme = localStorage.getItem("bold_color_theme"); return theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
    });
    useEffect(() => {
        try { localStorage.setItem("bold_color_theme", is_dark_mode ? "dark" : "light"); } catch {}
        document.documentElement.style.colorScheme = is_dark_mode ? "dark" : "light";
        document.documentElement.dataset.boldTheme = is_dark_mode ? "dark" : "light";
        document.documentElement.classList.toggle("theme_dark", is_dark_mode);
    }, [is_dark_mode]);
    useEffect(() => {
        if (shouldLeaveRestrictedShellModule(active_module, navigation)) {
            set_active_module(navigation.find(item => item.default)?.id || navigation[0]?.id);
        }
    }, [active_module, navigation]);
    return <ShellContext.Provider value={{ news, set_slack_dirty, slack_target, open_channel:async target=>{if(await set_active_module("slack")){set_slack_target({...target,requestId:crypto.randomUUID()});set_is_sidebar_open(false);}}, chat_target, open_direct_chat: async person => {if (await set_active_module("messaging")) {set_chat_target({...person}); set_is_sidebar_open(false);}}, profile_tab, set_profile_tab, profile_editing, set_profile_editing, set_profile_dirty, can_change_department: async () => {if (active_module === "docs" && workspace_busy.current) return false; return !(workspace_dirty.current || profile_dirty.current || slack_dirty.current) || await confirmBold("\u00bfCambiar departamento y descartar los cambios sin guardar?");}, open_profile: async (edit = false, tab = "account") => {if (await set_active_module("profile")) {set_profile_tab(tab);if (edit || active_module !== "profile") set_profile_editing(edit); set_is_sidebar_open(false);}}, active_module, set_active_module, workspace_tab_state, workspace_connection, open_workspace_tab, close_workspace_tab, select_workspace_tab, sync_workspace_account, drive_folder, finish_drive_folder: requestId => set_drive_folder(current => current?.requestId === requestId ? null : current), open_drive_folder: async folder => {if (await set_active_module("drive")) set_drive_folder({...folder, requestId: crypto.randomUUID()});}, workspace_file, set_workspace_file, set_workspace_dirty, set_workspace_busy, is_sidebar_open, set_is_sidebar_open, is_dark_mode, set_is_dark_mode, navigation_items: navigation }}>{children}</ShellContext.Provider>;
}
export function AppShell({ sidebarProps, topBarProps, mobileHeaderProps, feedback, overlays, membersContent, latestNewsId, welcomeConnection, children }) {
    const shell = useShell();
    const core = useCore();
    const releaseNotes = shell.news?.notes || [];
    const NoteViewer = shell.news?.Viewer;
    useEffect(() => {
        if (shell.active_module !== "home") return;
        let active = true;
        const announce = ready => window.dispatchEvent(new CustomEvent("bold:home-ready", {detail: {ready, assignmentId: core.activeAssignment?.id}}));
        const animations = document.querySelector(".main_workspace")?.getAnimations() || [];
        Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (active) announce(true); });
        return () => { active = false; announce(false); };
    }, [shell.active_module, core.activeAssignment?.id]);
    const newsKey = `bold_news_read:${core.account?.id || core.activeAssignment?.personId || "demo"}`;
    const [unreadNews, setUnreadNews] = useState(false);
    const [newsAnchor, setNewsAnchor] = useState(null), [newsNote, setNewsNote] = useState(null);
    useEffect(() => {setNewsAnchor(null); setNewsNote(null);}, [core.activeAssignment?.id, shell.active_module]);
    useEffect(() => {
        const reading = Boolean(newsAnchor) || newsNote !== null || shell.active_module === "profile" && shell.profile_tab === "news";
        const update = () => {
            try {
                if (reading && latestNewsId) localStorage.setItem(newsKey, latestNewsId);
                setUnreadNews(Boolean(latestNewsId && !reading && localStorage.getItem(newsKey) !== latestNewsId));
            } catch { setUnreadNews(Boolean(latestNewsId && !reading)); }
        };
        update();
        window.addEventListener("storage", update);
        return () => window.removeEventListener("storage", update);
    }, [newsKey, latestNewsId, shell.active_module, shell.profile_tab, newsAnchor, newsNote]);
    const [profileAnchor, setProfileAnchor] = useState(null);
    const [membersOpen, setMembersOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {try {return localStorage.getItem("bold_sidebar_collapsed") !== "false";} catch {return true;}});
    const toggleSidebar = () => setSidebarCollapsed(value => {try {localStorage.setItem("bold_sidebar_collapsed", String(!value));} catch {} return !value;});
    useDialog(membersOpen, ".team_members_panel", () => setMembersOpen(false));
    useEffect(() => setMembersOpen(false), [core.activeAssignment?.id, shell.chat_target]);
    const reading=core.messaging?.unread?.reading?.items || [],markedChats=reading.filter(row=>row.target.kind==='chat').length,markedSlack=reading.filter(row=>row.target.kind==='channel').length;
    const membersActions = { membersOpen, toggleMembers: () => setMembersOpen(value => !value), unreadNews, unreadChats: core.messaging?.unread?.total > 0 || markedChats>0 };
    const [bellPulse, setBellPulse] = useState(0);
    const [bellReminder, setBellReminder] = useState(false);
    const hasUnreadNotifications = topBarProps.notifications.some(item => !item.is_read);
    const bellInterval = core.notifications.settings.bell_interval_minutes ?? 5;
    useEffect(() => setBellPulse(0), [core.activeAssignment?.id]);
    useEffect(() => {
        setBellReminder(false);
        if (!hasUnreadNotifications) return;
        return startNotificationBellReminder(bellInterval, ringing => {
            setBellReminder(ringing);
            if (ringing) setBellPulse(value => value + 1);
        });
    }, [core.activeAssignment?.id, hasUnreadNotifications, bellInterval]);
    useEffect(() => setProfileAnchor(null), [shell.active_module]);
    const profileActions = {newsOpen: Boolean(newsAnchor), onOpenNews: event => {const anchor = event.currentTarget; topBarProps.handle_close_notifications(); setProfileAnchor(null); setMembersOpen(false); setNewsAnchor(old => old === anchor ? null : anchor);}, onQuickProfile: event => {const anchor = event.currentTarget; setProfileAnchor(old => old === anchor ? null : anchor); globalThis.dispatchEvent?.(new CustomEvent("bold:sidebar-popover", {detail: "profile"}));}, onOpenProfile: shell.open_profile};
    const compact = useMediaQuery("(max-width: 1023px)");
    useDialog(compact && shell.is_sidebar_open, ".sidebar_shell", () => shell.set_is_sidebar_open(false));
    useDialog(compact && topBarProps.is_notifications_open, ".notifications_panel", topBarProps.handle_close_notifications);
    const identity = { current_user: core.activeAssignment, profileAvatar: core.account?.avatar_url };
    const handle_toggle_notifications = () => {
        setNewsAnchor(null);
        if (!topBarProps.is_notifications_open) setBellPulse(value => value + 1);
        topBarProps.handle_toggle_notifications();
    };
    useKeyboardShortcuts(core.activeAssignment?.id, shell, {handle_toggle_notifications});
    return <div className={`app_shell bold_v3 ${sidebarCollapsed && !compact ? "bold_sidebar_collapsed" : ""} ${shell.is_dark_mode ? "theme_dark" : ""} ${shell.is_sidebar_open ? "app_shell_with_mobile_sidebar" : ""} ${core.sessionEntrance ? "app_shell_session_enter" : ""}`}>
        <InterfaceWelcome account={core.account?.id} dark={shell.is_dark_mode} onTheme={shell.set_is_dark_mode} connectionContent={welcomeConnection}/>
        <Sidebar {...profileActions} {...sidebarProps} {...shell} {...identity} collapsed={sidebarCollapsed && !compact} toggleCollapsed={toggleSidebar} compact={compact} onLogout={core.logout} onManageMfa={core.mfa.open} mfaEnabled={core.mfa.enabled} />
        {shell.is_sidebar_open ? <button className="mobile_sidebar_overlay" type="button" aria-label="Cerrar navegacion" onClick={() => shell.set_is_sidebar_open(false)}></button> : null}
        <main className="main_workspace" inert={compact && shell.is_sidebar_open ? true : undefined}>
            {feedback}
            <TopBar {...mobileHeaderProps} {...membersActions} {...profileActions} {...topBarProps} {...shell} {...identity} compact={compact} bellPulse={bellPulse} bellReminder={bellReminder} handle_toggle_notifications={handle_toggle_notifications} />
            {newsAnchor && <ResponsiveOverlay query="(max-width: 1023px)"><div className="news_surface task_tool_anchor"><HeaderNewsPanel releaseNotes={releaseNotes} anchor={newsAnchor} onClose={() => setNewsAnchor(null)} onViewAll={() => {setNewsAnchor(null); shell.open_profile(false, "news");}} onSelect={index => {setNewsAnchor(null); setNewsNote(index);}}/></div></ResponsiveOverlay>}
            {newsNote !== null && NoteViewer && releaseNotes[newsNote] && <NoteViewer releaseNotes={releaseNotes} index={newsNote} select={setNewsNote} close={() => setNewsNote(null)}/>}
            {topBarProps.is_notifications_open && <ResponsiveOverlay query="(max-width: 1023px)" onClose={topBarProps.handle_close_notifications}><div className="notification_surface task_tool_anchor">{<NotificationsPanel {...topBarProps}/>}</div></ResponsiveOverlay>}
            {children}
        </main>
        <div className="team_members_overlay" hidden={!membersOpen} onClick={() => setMembersOpen(false)}>
            <aside className="team_members_panel" role="dialog" aria-modal="true" aria-labelledby="team_members_title" onClick={event => event.stopPropagation()}>
                <header><div><h2 id="team_members_title">Equipo</h2><small>Personas y disponibilidad</small></div><button type="button" className="theme_toggle_button" aria-label="Cerrar lista de miembros" onClick={() => setMembersOpen(false)}>{render_icon(x_icon, 18)}</button></header>
                {membersContent}
            </aside>
        </div>
        <div id="bold-overlay-root" />
        <span className="chat_unread_status" role="status" aria-atomic="true">{[core.messaging?.unread?.total>0 ? `${core.messaging.unread.total} ${core.messaging.unread.total===1 ? 'mensaje':'mensajes'} de Chat sin leer`:'',markedChats ? `${markedChats} ${markedChats===1 ? 'conversación de Chat marcada como no leída':'conversaciones de Chat marcadas como no leídas'}`: ''].filter(Boolean).join('. ')}</span>
        <span className="chat_unread_status" role="status" aria-atomic="true">{[core.slack?.unread?.total>0 ? `${core.slack.unread.total} ${core.slack.unread.total===1 ? "mensaje" : "mensajes"} de Slack sin leer`:'',markedSlack ? `${markedSlack} ${markedSlack===1 ? 'marca personal':'marcas personales'} de no leído en Slack`: ''].filter(Boolean).join('. ')}</span>
        {profileAnchor && <ProfileQuickMenu anchor={profileAnchor} close={() => setProfileAnchor(null)} openProfile={shell.open_profile} changeDepartment={async id => {if (!await shell.can_change_department()) return false; core.setActiveAssignment(id); return true;}}/>}
        {overlays}
    </div>;
}
function render_logo() {
    return (
        <div className="brand_logo" aria-label="Bold">
            <img src="/logo-bold.svg" alt="" />
        </div>
    );
}


function render_navigation_item(item, active_module, handle_module_change, options = {}) {
    const is_active = active_module === item.id;
    const item_icon = icon_map[item.icon] || home_icon;
    const is_expandable = Boolean(options.is_expandable);
    const is_expanded = Boolean(options.is_expanded);
    const handle_click = options.on_click || (() => handle_module_change(item.id));

    return (
        <button
            className={`navigation_item ${is_active ? "navigation_item_active" : ""} ${is_expandable ? "navigation_item_expandable" : ""}`}
            key={item.id}
            type="button"
            data-tour={`nav-${item.id}`}
            aria-expanded={is_expandable ? is_expanded : undefined}
            aria-controls={options.controls_id}
            aria-label={item.unread ? `${item.label}, mensajes sin leer` : item.label}
            title={item.label}
            aria-current={is_active ? "page" : undefined}
            onClick={handle_click}
        >
            <span className="navigation_icon">
                {render_icon(item_icon, 18)}
            </span>
            <span className="navigation_label">{item.label}</span>
            {item.unread && <span className="chat_unread_dot" aria-hidden="true"/>}
            {is_expandable ? (
                <span className={`navigation_chevron ${is_expanded ? "navigation_chevron_open" : ""}`}>
                    {render_icon(chevron_down_icon, 18)}
                </span>
            ) : null}
        </button>
    );
}


function Sidebar(props) {
    const { active_module, handle_module_change, is_sidebar_open, set_is_sidebar_open, navigation_items, current_user, navigationSlots = {} } = props;
    const groups = [{ id: "work" }, { id: "management", label: "Gestión" }];

    return (
        <aside className={`sidebar_shell ${is_sidebar_open ? "sidebar_shell_open" : ""}`} data-tour="sidebar" inert={props.compact && !is_sidebar_open ? true : undefined} role={props.compact ? "dialog" : undefined} aria-modal={props.compact && is_sidebar_open ? true : undefined} aria-label="Navegación">
            <div className="sidebar_header">
                <div className="bold_sidebar_brand">
                    <svg className="bold_sidebar_mark" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="10.5" fill="none" stroke="currentColor" strokeWidth="4"/></svg>
                    {render_logo()}
                </div>
                <button
                    className="sidebar_close_button"
                    type="button"
                    aria-label="Cerrar navegacion"
                    onClick={() => set_is_sidebar_open(false)}
                >
                    {render_icon(x_icon, 24)}
                </button>
            </div>

            <div className="sidebar_scroll_area" id="bold_sidebar_navigation">
                {groups.map(group => {
                    const items = navigation_items.filter(item => (item.group || "work") === group.id);
                    if (!items.length) return null;
                    return <div className="sidebar_section" key={group.id}>
                    {group.label && <p className="sidebar_label">{group.label}</p>}
                    <nav className="navigation_list" aria-label={group.label || "Principal"}>
                        {items.map((item) => {
                            const slot = navigationSlots[item.id];
                            if (!slot || props.collapsed) return render_navigation_item(item, active_module, handle_module_change, slot && props.collapsed ? {on_click: () => {props.toggleCollapsed(); slot.onToggle();}} : {});
                            return <div className={`tasks_navigation_group ${slot.open ? "tasks_navigation_group_open" : "tasks_navigation_group_closed"}`} key={item.id}>
                                {render_navigation_item(item, active_module, handle_module_change, { controls_id: slot.id, is_expandable: true, is_expanded: slot.open, on_click: slot.onToggle })}
                                {slot.content}
                            </div>;
                        })}
                    </nav>
                </div>; })}
            </div>

            <div className="bold_sidebar_bottom">
            <div className="sidebar_footer profile_footer_controls" data-tour="profile">
                <button className="profile_identity_button" aria-label="Abrir ajustes rápidos del perfil" onClick={props.onQuickProfile}>
                    <ProfileAvatar className="profile_avatar" url={props.profileAvatar} initials={current_user.initials}/>
                    <span className="profile_text"><strong>{current_user.name}</strong><span>{current_user?.job_role_title || "Administrador"}</span></span>
                </button>
                <button className="profile_menu_button" type="button" aria-label="Ajustes del perfil" onClick={() => props.onOpenProfile()}>{render_icon(settings_icon, 19)}</button>
            </div>
            {!props.compact && <button className="bold_sidebar_toggle navigation_item" type="button" onClick={props.toggleCollapsed} aria-expanded={!props.collapsed} aria-controls="bold_sidebar_navigation" aria-label={props.collapsed ? "Expandir navegación" : "Contraer navegación"} title={props.collapsed ? "Expandir navegación" : "Contraer navegación"}>
                <span className="navigation_icon">{render_icon(sidebar_toggle_icon,18)}</span>
                <span className="navigation_label">{props.collapsed ? "Expandir" : "Contraer"}</span>
            </button>}
            </div>
        </aside>
    );
}


function NotificationsPanel(props) {
    const core = useCore(), shell = useShell();
    return <NotificationPanel notifications={props.notifications} error={core.notifications.error}
        onClose={props.handle_close_notifications} onSelect={props.handle_notification_select} onReply={props.handle_notification_reply} onInbox={props.handle_open_inbox}
        onRead={(id, read) => core.notifications.setRead(id, read)} onDismiss={id => core.notifications.dismiss(id)}
        onReadAll={() => Promise.all(props.notifications.filter(item => !item.is_read).map(item => core.notifications.setRead(item.id, true)))} onClear={() => core.notifications.clear()}
        onSettings={() => {props.handle_close_notifications(); shell.open_profile(false, "notifications");}} />;
}


export function TopBar(props) {
    const { compact, handle_toggle_notifications,
        is_dark_mode,
        is_notifications_open,
        notifications,
        search_query,
        set_search_query,
        set_is_dark_mode
    } = props;
    const [open, setOpen] = useState(false), [activeIndex, setActiveIndex] = useState(0);
    const searchRef = useRef(null), mobileActionsRef = useRef(null);
    const results = useMemo(() => searchNavigation(props.navigation_items, search_query), [props.navigation_items, search_query]);
    const has_unread_notifications = notifications.some((notification_item) => !notification_item.is_read);
    useEffect(() => { setActiveIndex(0); setOpen(Boolean(search_query.trim())); }, [search_query]);
    useEffect(() => {
        if (!open) return undefined;
        const close = event => { if (!searchRef.current?.contains(event.target)) setOpen(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);
    useEffect(() => {
        if (!compact) return undefined;
        const close = event => { if (!mobileActionsRef.current?.contains(event.target)) closeMobileActions(); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [compact]);
    function closeMobileActions() {
        if (mobileActionsRef.current) mobileActionsRef.current.open = false;
    }
    function choose(result) {
        if (!result) return;
        if (!props.navigation_items?.some(item => item.id === result.module)) return;
        if (props.handle_search_navigate) props.handle_search_navigate(result);
        else props.set_active_module(result.target || result.module);
        set_search_query(""); setOpen(false);
    }
    function handleKeyDown(event) {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, Math.max(0, results.length - 1))); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
        if (event.key === "Enter" && open && results.length) { event.preventDefault(); choose(results[activeIndex]); }
        if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); }
    }

    return (
        <header className={`top_bar${compact ? " top_bar_compact" : ""}`} data-tour={compact ? "mobile-header" : undefined}>
            {compact && <button className="mobile_menu_button" data-tour="mobile-menu" type="button" aria-label={props.detailOpen ? "Volver" : "Abrir navegacion"} onClick={() => props.detailOpen ? props.onBack() : props.set_is_sidebar_open(true)}>{render_icon(props.detailOpen ? arrow_left_icon : menu_icon, 22)}</button>}
            <div className="global_search" ref={searchRef}>
            <label className="search_box" data-tour="search" htmlFor="task_search">
                {render_icon(search_icon, 18)}
                <input
                    id="task_search"
                    type="search"
                    value={search_query}
                    placeholder={compact ? "Buscar…" : "Buscar en BOLD…"}
                    aria-label="Buscar en BOLD"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls="global_search_results"
                    aria-activedescendant={open && results[activeIndex] ? `global-search-${results[activeIndex].id}` : undefined}
                    onFocus={() => search_query.trim() && setOpen(true)}
                    onKeyDown={handleKeyDown}
                    onChange={(event) => set_search_query(event.target.value)}
                />
            </label>
            {open && <div className="global_search_results" id="global_search_results" role="listbox">
                {results.length ? results.map((result, index) => <button id={`global-search-${result.id}`} className={index === activeIndex ? "is_active" : ""} type="button" role="option" aria-selected={index === activeIndex} key={result.id} onMouseEnter={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(result)}><span className="global_search_icon">{render_icon(icon_map[result.icon] || search_icon, 17)}</span><span><strong>{result.label}</strong><small>{result.reference}</small></span><em>{result.section}</em></button>) : <p>No hay módulos o vistas disponibles con esa búsqueda.</p>}
            </div>}
            </div>
            <div className="top_bar_actions">
                {!compact && <><button className="theme_toggle_button tour_help_button" data-tour="help" type="button" aria-label="Abrir tutorial de este módulo" title={["permissions", "administration"].includes(props.active_module) ? "Este módulo tendrá una guía en video" : "Tutorial de esta vista"} disabled={["permissions", "administration"].includes(props.active_module)} onClick={() => globalThis.dispatchEvent?.(new CustomEvent("bold:onboarding:start"))}>
                    <span className="theme_toggle_icon">{render_icon(circle_help_icon, 18)}</span>
                </button>
                <button className={`theme_toggle_button${props.unreadNews ? " news_unread" : ""}`} type="button" aria-label={props.unreadNews ? "Novedades sin leer" : "Novedades"} title={props.unreadNews ? "Hay novedades nuevas" : "Novedades"} aria-expanded={props.newsOpen} aria-controls="header_news_panel" onClick={props.onOpenNews}><span className="theme_toggle_icon">{render_icon(newspaper_icon, 18)}</span></button></>}
                <button
                    className="theme_toggle_button"
                    data-tour="theme"
                    type="button"
                    aria-label={is_dark_mode ? "Activar modo claro" : "Activar modo oscuro"}
                    title={is_dark_mode ? "Modo claro" : "Modo oscuro"}
                    onClick={() => set_is_dark_mode((current_value) => !current_value)}
                >
                    <span className="theme_toggle_icon">{render_icon(is_dark_mode ? sun_icon : moon_icon, 17)}</span>
                </button>
                <div className="task_tool_anchor">
                    <button
                        className={`bell_button ${is_notifications_open ? "bell_button_active" : ""}${has_unread_notifications ? " bell_has_unread" : ""}`}
                        data-tour={compact ? "mobile-notifications" : "notifications"}
                        type="button"
                        aria-label="Notificaciones"
                        aria-expanded={is_notifications_open}
                        title="Notificaciones"
                        onClick={handle_toggle_notifications}
                    >
                        <span key={props.bellPulse} className={props.bellPulse ? `notification_bell_arrival${props.bellReminder ? " notification_bell_reminder" : ""}` : undefined}>{render_icon(bell_icon, 18)}</span>
                        {has_unread_notifications ? <span className="bell_unread_dot"></span> : null}
                    </button>

                </div>
                {!compact && <button className="theme_toggle_button chat_members_button" type="button" aria-label={props.unreadChats ? "Mostrar lista de miembros, mensajes sin leer" : "Mostrar lista de miembros"} title="Mostrar lista de miembros" aria-expanded={props.membersOpen} onClick={props.toggleMembers}>{render_icon(users_icon, 19)}{props.unreadChats && <span className="chat_unread_dot" aria-hidden="true"/>}</button>}
                {compact && <details className="header_mobile_actions" ref={mobileActionsRef} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) closeMobileActions();}} onKeyDown={event => {if (event.key === "Escape") {event.preventDefault();closeMobileActions();mobileActionsRef.current?.querySelector("summary")?.focus();}}}>
                    <summary className="mobile_more_button" data-tour="mobile-help" aria-label="Más opciones" title="Más opciones">{render_icon(more_icon, 20)}{(props.unreadNews || props.unreadChats) && <span className="header_more_dot" aria-hidden="true"/>}</summary>
                    <div className="header_mobile_menu">
                        <button type="button" disabled={["permissions", "administration"].includes(props.active_module)} onClick={() => {closeMobileActions();globalThis.dispatchEvent?.(new CustomEvent("bold:onboarding:start"));}}>{render_icon(circle_help_icon, 18)}<span>Ayuda de esta vista</span></button>
                        <button type="button" aria-controls="header_news_panel" onClick={() => {const anchor = mobileActionsRef.current.querySelector("summary");anchor.focus();closeMobileActions();props.onOpenNews({currentTarget:anchor});}}>{render_icon(newspaper_icon, 18)}<span>Novedades</span>{props.unreadNews && <i aria-label="Sin leer"/>}</button>
                        <button type="button" onClick={() => {mobileActionsRef.current.querySelector("summary").focus();closeMobileActions();props.toggleMembers();}}>{render_icon(users_icon, 18)}<span>Equipo</span>{props.unreadChats && <i aria-label="Mensajes sin leer"/>}</button>
                    </div>
                </details>}
            </div>
        </header>
    );
}
