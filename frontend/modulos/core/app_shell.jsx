import "./shared/bold_dialog.css";
import {useKeyboardShortcuts} from "./use_keyboard_shortcuts.js";
import {confirmBold} from "./shared/bold_dialog.js";
import { ProfileAvatar, ProfileQuickMenu } from "./shared/profile_menu.jsx";
import { workspaceTabs, emptyWorkspaceTabs } from "./workspace_tabs.js";
import { ResponsiveOverlay } from "./shared/responsive_overlay.jsx";
import { useMediaQuery } from "./shared/use_media_query.js";
import { useDialog } from "./shared/use_dialog.js";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useReducer, createElement } from "react";
import { FileText as docs_icon, FolderOpen as drive_icon, ArrowLeft as arrow_left_icon, BarChart3 as bar_chart_icon, Bell as bell_icon, CalendarDays as calendar_icon, Check as check_icon, ChevronDown as chevron_down_icon, CircleHelp as circle_help_icon, Home as home_icon, Inbox as inbox_icon, KeyRound as key_round_icon, Menu as menu_icon, MessageSquarePlus as message_square_plus_icon, Moon as moon_icon, Settings as settings_icon, Search as search_icon, ShieldCheck as shield_check_icon, Sun as sun_icon, X as x_icon } from "lucide-react";
import { useCore } from "./core_provider.jsx";
import { shouldLeaveRestrictedShellModule } from "./core_models.js";
import { searchNavigation } from "./global_search.js";
import { entranceModule, historyModule, isShellModuleAllowed } from "./shell_navigation_state.js";
const icon_map = { profile: settings_icon, docs: docs_icon, drive: drive_icon, home: home_icon, check: check_icon, inbox: inbox_icon, calendar: calendar_icon, reports: bar_chart_icon, suggestions: message_square_plus_icon, administration: shield_check_icon, permissions: key_round_icon };
const render_icon = (icon, size) => createElement(icon, { size, strokeWidth: 2, "aria-hidden": "true" });
const ShellContext = createContext(null);
export const useShell = () => useContext(ShellContext);
export function ShellProvider({ children, navigation, contextId = "demo" }) {
    const storageKey = `bold_shell_module:${contextId}`;
    const [active_module, set_module] = useState(() => {
        let saved;
        try { saved = sessionStorage.getItem(storageKey); } catch { /* Optional navigation preference. */ }
        return entranceModule(navigation, saved);
    });
    useEffect(() => {
        if (isShellModuleAllowed(active_module, navigation)) {
            try { sessionStorage.setItem(storageKey, active_module); } catch { /* No authorization is stored here. */ }
        }
    }, [active_module, storageKey, navigation]);
    const [is_sidebar_open, set_is_sidebar_open] = useState(false);
    const [profile_editing, set_profile_editing] = useState(false);
    const [profile_tab, set_profile_tab] = useState("account");
    const profile_dirty = useRef(false);
    const set_profile_dirty = value => {profile_dirty.current = value;};
    const [workspace_file, set_workspace_file] = useState(null);
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
    return <ShellContext.Provider value={{ profile_tab, set_profile_tab, profile_editing, set_profile_editing, set_profile_dirty, can_change_department: async () => {if (active_module === "docs" && workspace_busy.current) return false; return !(workspace_dirty.current || profile_dirty.current) || await confirmBold("\u00bfCambiar departamento y descartar los cambios sin guardar?");}, open_profile: async (edit = false, tab = "account") => {if (await set_active_module("profile")) {set_profile_tab(tab);if (edit || active_module !== "profile") set_profile_editing(edit); set_is_sidebar_open(false);}}, active_module, set_active_module, workspace_tab_state, workspace_connection, open_workspace_tab, close_workspace_tab, select_workspace_tab, sync_workspace_account, workspace_file, set_workspace_file, set_workspace_dirty, set_workspace_busy, is_sidebar_open, set_is_sidebar_open, is_dark_mode, set_is_dark_mode, navigation_items: navigation }}>{children}</ShellContext.Provider>;
}
export function AppShell({ sidebarProps, topBarProps, mobileHeaderProps, feedback, overlays, children }) {
    const shell = useShell();
    const core = useCore();
    const [profileAnchor, setProfileAnchor] = useState(null);
    const [bellPulse, setBellPulse] = useState(0);
    useEffect(() => {
        setBellPulse(0);
        const ring = () => setBellPulse(value => value + 1);
        window.addEventListener("bold:notification-arrived", ring);
        return () => window.removeEventListener("bold:notification-arrived", ring);
    }, [core.activeAssignment?.id]);
    useEffect(() => setProfileAnchor(null), [shell.active_module]);
    const profileActions = {onQuickProfile: event => {const anchor = event.currentTarget; setProfileAnchor(old => old === anchor ? null : anchor); globalThis.dispatchEvent?.(new CustomEvent("bold:sidebar-popover", {detail: "profile"}));}, onOpenProfile: shell.open_profile};
    const compact = useMediaQuery("(max-width: 1023px)");
    useDialog(compact && shell.is_sidebar_open, ".sidebar_shell", () => shell.set_is_sidebar_open(false));
    useDialog(compact && topBarProps.is_notifications_open, ".notifications_panel", topBarProps.handle_close_notifications);
    const identity = { current_user: core.activeAssignment, profileAvatar: core.account?.avatar_url };
    const handle_toggle_notifications = () => {
        if (!topBarProps.is_notifications_open) setBellPulse(value => value + 1);
        topBarProps.handle_toggle_notifications();
    };
    useKeyboardShortcuts(core.activeAssignment?.id, shell, {handle_toggle_notifications});
    return <div className={`app_shell ${shell.is_dark_mode ? "theme_dark" : ""} ${shell.is_sidebar_open ? "app_shell_with_mobile_sidebar" : ""} ${core.sessionEntrance ? "app_shell_session_enter" : ""}`}>
        <Sidebar {...profileActions} {...sidebarProps} {...shell} {...identity} compact={compact} onLogout={core.logout} onManageMfa={core.mfa.open} mfaEnabled={core.mfa.enabled} />
        {shell.is_sidebar_open ? <button className="mobile_sidebar_overlay" type="button" aria-label="Cerrar navegacion" onClick={() => shell.set_is_sidebar_open(false)}></button> : null}
        <main className="main_workspace" inert={compact && shell.is_sidebar_open ? true : undefined}>
            {feedback}
            {render_mobile_header({ ...profileActions, ...mobileHeaderProps, ...shell, ...identity, ...topBarProps, bellPulse, handle_toggle_notifications })}
            <TopBar {...profileActions} {...topBarProps} {...shell} {...identity} bellPulse={bellPulse} handle_toggle_notifications={handle_toggle_notifications} />
            {topBarProps.is_notifications_open && <ResponsiveOverlay query="(max-width: 1023px)" onClose={topBarProps.handle_close_notifications}><div className="notification_surface task_tool_anchor">{<NotificationsPanel {...topBarProps}/>}</div></ResponsiveOverlay>}
            {children}
        </main>
        <div id="bold-overlay-root" />
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
            onClick={handle_click}
        >
            <span className="navigation_icon">
                {is_expandable && is_active ? render_icon(check_icon, 16) : render_icon(item_icon, 17)}
            </span>
            <span>{item.label}</span>
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
    const groups = [{ id: "work", label: current_user?.unit_name || "Trabajo" }, { id: "management", label: "Gestión" }];

    return (
        <aside className={`sidebar_shell ${is_sidebar_open ? "sidebar_shell_open" : ""}`} data-tour="sidebar" inert={props.compact && !is_sidebar_open ? true : undefined} role={props.compact ? "dialog" : undefined} aria-modal={props.compact && is_sidebar_open ? true : undefined} aria-label="Navegación">
            <div className="sidebar_header">
                {render_logo()}
                <button
                    className="sidebar_close_button"
                    type="button"
                    aria-label="Cerrar navegacion"
                    onClick={() => set_is_sidebar_open(false)}
                >
                    {render_icon(x_icon, 24)}
                </button>
            </div>

            <div className="sidebar_scroll_area">
                {groups.map(group => {
                    const items = navigation_items.filter(item => (item.group || "work") === group.id);
                    if (!items.length) return null;
                    return <div className="sidebar_section" key={group.id}>
                    <p className="sidebar_label">{group.label}</p>
                    <nav className="navigation_list" aria-label="Principal">
                        {items.map((item) => {
                            const slot = navigationSlots[item.id];
                            if (!slot) return render_navigation_item(item, active_module, handle_module_change);
                            return <div className={`tasks_navigation_group ${slot.open ? "tasks_navigation_group_open" : "tasks_navigation_group_closed"}`} key={item.id}>
                                {render_navigation_item(item, active_module, handle_module_change, { controls_id: slot.id, is_expandable: true, is_expanded: slot.open, on_click: slot.onToggle })}
                                {slot.content}
                            </div>;
                        })}
                    </nav>
                </div>; })}
            </div>

            <div className="sidebar_footer profile_footer_controls" data-tour="profile">
                <button className="profile_identity_button" aria-label="Abrir ajustes rápidos del perfil" onClick={props.onQuickProfile}>
                    <ProfileAvatar className="profile_avatar" url={props.profileAvatar} initials={current_user.initials}/>
                    <span className="profile_text"><strong>{current_user.name}</strong><span>{current_user?.job_role_title || "Administrador"}</span></span>
                </button>
                <button className="profile_menu_button" type="button" aria-label="Ajustes del perfil" onClick={() => props.onOpenProfile()}>{render_icon(settings_icon, 19)}</button>
            </div>
        </aside>
    );
}


// Renders the "Notificaciones" dropdown panel opened from the bell button.
function NotificationsPanel(props) {
    const core = useCore();
    const shell = useShell();
    const [clearing, setClearing] = useState(false), [clearError, setClearError] = useState("");
    async function clear() {
        setClearing(true); setClearError("");
        try {await core.notifications.clear();} catch (problem) {setClearError(problem.message);} finally {setClearing(false);}
    }
    const {
        handle_close_notifications,
        handle_mark_notifications_read,
        handle_notification_select,
        notifications
    } = props;

    return (
        <div className="task_tool_panel notifications_panel" role="dialog" aria-label="Notificaciones">
            <header className="notifications_panel_header">
                <h3>Notificaciones</h3><button type="button" className="icon_button" aria-label="Cerrar notificaciones" onClick={handle_close_notifications}>{render_icon(x_icon, 20)}</button>
                <button className="link_button" type="button" onClick={() => {handle_close_notifications(); shell.open_profile(false, "notifications");}}>Configurar notificaciones</button>
                <button className="link_button" type="button" onClick={handle_mark_notifications_read}>
                    Marcar como leidas
                </button>
            </header>
            {clearError && <p role="alert">{clearError}</p>}
            <div className="notification_list">
                {notifications.map((notification_item) => {
                    const actor = notification_item.actor;
                    const notification_icon = notification_item.icon || bell_icon;

                    return (
                        <button
                            type="button"
                            className={`notification_item ${notification_item.is_read ? "" : "notification_item_unread"}`}
                            key={notification_item.id}
                            onClick={() => handle_notification_select?.(notification_item)}
                        >
                            <span className="notification_avatar" style={{ backgroundColor: actor ? actor.color : "#7c8b9a" }}>
                                {actor ? actor.initials : render_icon(notification_icon, 14)}
                            </span>
                            <div className="notification_body">
                                <p className="notification_title">{notification_item.title}</p>
                                <p className="notification_text">{notification_item.body}</p>
                                <span className="notification_time">{notification_item.time_label}</span>
                            </div>
                        </button>
                    );
                })}
                {!notifications.length && <p className="notification_empty">No tienes notificaciones por ahora.</p>}
            </div>
            <footer className="modal_footer">
                <button className="link_button" type="button" disabled={clearing || !notifications.length} onClick={clear}>{clearing ? "Limpiando…" : "Limpiar notificaciones"}</button>
                <button className="link_button" type="button" onClick={handle_close_notifications}>
                    Cerrar notificaciones
                </button>
            </footer>
        </div>
    );
}


// Renders the desktop top bar with search and user state.
function TopBar(props) {
    const { current_user,
        handle_close_notifications,
        handle_mark_notifications_read,
        handle_toggle_notifications,
        is_dark_mode,
        is_notifications_open,
        notifications,
        search_query,
        set_search_query,
        set_is_dark_mode
    } = props;
    const [open, setOpen] = useState(false), [activeIndex, setActiveIndex] = useState(0);
    const searchRef = useRef(null);
    const results = useMemo(() => searchNavigation(props.navigation_items, search_query), [props.navigation_items, search_query]);
    const has_unread_notifications = notifications.some((notification_item) => !notification_item.is_read);
    useEffect(() => { setActiveIndex(0); setOpen(Boolean(search_query.trim())); }, [search_query]);
    useEffect(() => {
        if (!open) return undefined;
        const close = event => { if (!searchRef.current?.contains(event.target)) setOpen(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);
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
        <header className="top_bar">
            <div className="global_search" ref={searchRef}>
            <label className="search_box" data-tour="search" htmlFor="task_search">
                {render_icon(search_icon, 18)}
                <input
                    id="task_search"
                    type="search"
                    value={search_query}
                    placeholder="Buscar módulos, vistas y herramientas"
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
                <button
                    className="theme_toggle_button tour_help_button"
                    data-tour="help"
                    type="button"
                    aria-label="Abrir tutorial de este módulo"
                    title={["permissions", "administration"].includes(props.active_module) ? "Este módulo tendrá una guía en video" : "Tutorial de esta vista"}
                    disabled={["permissions", "administration"].includes(props.active_module)}
                    onClick={() => globalThis.dispatchEvent?.(new CustomEvent("bold:onboarding:start"))}
                >
                    <span className="theme_toggle_icon">{render_icon(circle_help_icon, 18)}</span>
                </button>
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
                        className={`bell_button ${is_notifications_open ? "bell_button_active" : ""}`}
                        data-tour="notifications"
                        type="button"
                        aria-label="Notificaciones"
                        onClick={handle_toggle_notifications}
                    >
                        <span key={props.bellPulse} className={props.bellPulse ? "notification_bell_arrival" : undefined}>{render_icon(bell_icon, 18)}</span>
                        {has_unread_notifications ? <span className="bell_unread_dot"></span> : null}
                    </button>

                </div>
                <button className="profile_header_button" aria-label="Abrir ajustes rápidos del perfil" onClick={props.onQuickProfile}><ProfileAvatar className="soft_avatar" url={props.profileAvatar} initials={current_user.initials}/></button>
            </div>
        </header>
    );
}


// Renders the compact mobile header used above the active module.
function render_mobile_header(props) {
    const { current_user, navigation_items,
        active_module,
        detailOpen,
        onBack, onMore,
        set_is_sidebar_open
    } = props;

    const active_item = navigation_items.find((item) => item.id === active_module);
    const title = props.detailTitle || active_item?.label || "Bold";

    return (
        <header className="mobile_header" data-tour="mobile-header">
            <div className="mobile_header_row">
                <button
                    className="mobile_menu_button"
                    data-tour="mobile-menu"
                    type="button"
                    aria-label={detailOpen ? "Volver" : "Abrir navegacion"}
                    onClick={() => detailOpen ? onBack() : set_is_sidebar_open(true)}
                >
                    {detailOpen ? render_icon(arrow_left_icon, 24) : render_icon(menu_icon, 24)}
                </button>
                {detailOpen ? <h1>{title}</h1> : active_item?.brand ? render_logo() : <h1>{title}</h1>}
                <div className="mobile_tour_actions">
                    <button className="profile_header_button profile_mobile_button" aria-label={"Abrir ajustes r\u00e1pidos del perfil"} onClick={props.onQuickProfile}><ProfileAvatar initials={current_user.initials} url={props.profileAvatar}/></button>
                <button className="mobile_more_button tour_help_button" data-tour="mobile-help" type="button" aria-label="Abrir tutorial de este módulo" title="Tutorial de esta vista" disabled={["permissions", "administration"].includes(active_module)} onClick={() => globalThis.dispatchEvent?.(new CustomEvent("bold:onboarding:start"))}>{render_icon(circle_help_icon, 22)}</button>
                <button className="mobile_more_button" data-tour="mobile-notifications" type="button" aria-label="Notificaciones" aria-expanded={props.is_notifications_open} onClick={props.handle_toggle_notifications}>
                    <span key={props.bellPulse} className={props.bellPulse ? "notification_bell_arrival" : undefined}>{render_icon(bell_icon, 22)}</span>
                    {props.notifications.some(item => !item.is_read) && <span className="bell_unread_dot" />}
                </button>
                </div>
            </div>
        </header>
    );
}


