import { ResponsiveOverlay } from "../shared/responsive_overlay.jsx";
import { useMediaQuery } from "../shared/use_media_query.js";
import { useDialog } from "../shared/use_dialog.js";
import { createContext, useContext, useEffect, useState, createElement } from "react";
import { ArrowLeft as arrow_left_icon, BarChart3 as bar_chart_icon, Bell as bell_icon, Check as check_icon, ChevronDown as chevron_down_icon, Home as home_icon, Inbox as inbox_icon, Menu as menu_icon, Moon as moon_icon, MoreHorizontal as more_horizontal_icon, Search as search_icon, Sun as sun_icon, X as x_icon } from "lucide-react";
import { useCore } from "./core_provider.jsx";
import { is_using_real_backend } from "./http_client.js";
const icon_map = { home: home_icon, check: check_icon, inbox: inbox_icon, reports: bar_chart_icon };
const render_icon = (icon, size) => createElement(icon, { size, strokeWidth: 2, "aria-hidden": "true" });
const ShellContext = createContext(null);
export const useShell = () => useContext(ShellContext);
export function ShellProvider({ children, navigation }) {
    const [active_module, set_active_module] = useState(navigation.find(item => item.default)?.id || navigation[0]?.id);
    const [is_sidebar_open, set_is_sidebar_open] = useState(false);
    const [is_dark_mode, set_is_dark_mode] = useState(() => {
        try { const theme = localStorage.getItem("bold_color_theme"); return theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
    });
    useEffect(() => {
        try { localStorage.setItem("bold_color_theme", is_dark_mode ? "dark" : "light"); } catch {}
        document.documentElement.style.colorScheme = is_dark_mode ? "dark" : "light";
    }, [is_dark_mode]);
    return <ShellContext.Provider value={{ active_module, set_active_module, is_sidebar_open, set_is_sidebar_open, is_dark_mode, set_is_dark_mode, navigation_items: navigation }}>{children}</ShellContext.Provider>;
}
export function AppShell({ sidebarProps, topBarProps, mobileHeaderProps, feedback, overlays, children }) {
    const shell = useShell();
    const core = useCore();
    const compact = useMediaQuery("(max-width: 1023px)");
    useDialog(compact && shell.is_sidebar_open, ".sidebar_shell", () => shell.set_is_sidebar_open(false));
    useDialog(compact && topBarProps.is_notifications_open, ".notifications_panel", topBarProps.handle_close_notifications);
    const identity = { current_user: core.activeAssignment };
    const sessionControls = is_using_real_backend() && <div className="session_toolbar"><label>Cargo <select aria-label="Asignación activa" value={core.activeAssignment.id} onChange={event => core.setActiveAssignment(event.target.value)}>{core.assignments.map(item => <option key={item.id} value={item.id}>{item.job_role_title} · {item.unit_name}</option>)}</select></label><button className="secondary_button" onClick={core.logout}>Cerrar sesión</button></div>;
    return <div className={`app_shell ${shell.is_dark_mode ? "theme_dark" : ""} ${shell.is_sidebar_open ? "app_shell_with_mobile_sidebar" : ""}`}>
        {render_sidebar({ ...sidebarProps, ...shell, ...identity, compact, sessionControls: compact ? sessionControls : null })}
        {shell.is_sidebar_open ? <button className="mobile_sidebar_overlay" type="button" aria-label="Cerrar navegacion" onClick={() => shell.set_is_sidebar_open(false)}></button> : null}
        <main className="main_workspace" inert={compact && shell.is_sidebar_open ? true : undefined}>
            {!compact && sessionControls}
            {feedback}
            {render_mobile_header({ ...mobileHeaderProps, ...shell, ...identity, ...topBarProps })}
            {render_top_bar({ ...topBarProps, ...shell, ...identity })}
            {topBarProps.is_notifications_open && <ResponsiveOverlay query="(max-width: 1023px)" onClose={topBarProps.handle_close_notifications}><div className="notification_surface task_tool_anchor">{render_notifications_panel(topBarProps)}</div></ResponsiveOverlay>}
            {children}
        </main>
        <div id="bold-overlay-root" />
        {overlays}
    </div>;
}
function render_logo() {
    return (
        <div className="brand_logo" aria-label="Bold">
            <span>bold</span>
            <span className="brand_dot"></span>
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


function render_sidebar(props) {
    const { active_module, handle_module_change, is_sidebar_open, set_is_sidebar_open, navigation_items, current_user, navigationSlots = {} } = props;
    const primary_navigation_items = navigation_items;

    return (
        <aside className={`sidebar_shell ${is_sidebar_open ? "sidebar_shell_open" : ""}`} inert={props.compact && !is_sidebar_open ? true : undefined} role={props.compact ? "dialog" : undefined} aria-modal={props.compact && is_sidebar_open ? true : undefined} aria-label="Navegación">
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
                <div className="sidebar_section">
                    <p className="sidebar_label">NAVEGACION</p>
                    <nav className="navigation_list" aria-label="Principal">
                        {primary_navigation_items.map((item) => {
                            const slot = navigationSlots[item.id];
                            if (!slot) return render_navigation_item(item, active_module, handle_module_change);
                            return <div className={`tasks_navigation_group ${slot.open ? "tasks_navigation_group_open" : "tasks_navigation_group_closed"}`} key={item.id}>
                                {render_navigation_item(item, active_module, handle_module_change, { controls_id: slot.id, is_expandable: true, is_expanded: slot.open, on_click: slot.onToggle })}
                                {slot.content}
                            </div>;
                        })}
                    </nav>
                </div>
            </div>

            {props.sessionControls}
            <div className="sidebar_footer">
                <span className="profile_avatar">{current_user.initials}</span>
                <div className="profile_text">
                    <strong>{current_user.name}</strong>
                    <span>{current_user?.job_role_title || "Administrador"}</span>
                </div>
                <button className="profile_menu_button" type="button" aria-label="Perfil">
                    {render_icon(more_horizontal_icon, 18)}
                </button>
            </div>
        </aside>
    );
}


// Renders the "Notificaciones" dropdown panel opened from the bell button.
function render_notifications_panel(props) {
    const {
        handle_close_notifications,
        handle_mark_notifications_read,
        notifications
    } = props;

    return (
        <div className="task_tool_panel notifications_panel" role="dialog" aria-label="Notificaciones">
            <header className="notifications_panel_header">
                <h3>Notificaciones</h3><button type="button" className="icon_button" aria-label="Cerrar notificaciones" onClick={handle_close_notifications}>{render_icon(x_icon, 20)}</button>
                <button className="link_button" type="button" onClick={handle_mark_notifications_read}>
                    Marcar como leidas
                </button>
            </header>
            <div className="notification_list">
                {notifications.map((notification_item) => {
                    const actor = notification_item.actor;
                    const notification_icon = notification_item.icon || bell_icon;

                    return (
                        <div
                            className={`notification_item ${notification_item.is_read ? "" : "notification_item_unread"}`}
                            key={notification_item.id}
                        >
                            <span className="notification_avatar" style={{ backgroundColor: actor ? actor.color : "#7c8b9a" }}>
                                {actor ? actor.initials : render_icon(notification_icon, 14)}
                            </span>
                            <div className="notification_body">
                                <p className="notification_title">{notification_item.title}</p>
                                <p className="notification_text">{notification_item.body}</p>
                                <span className="notification_time">{notification_item.time_label}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            <footer className="modal_footer">
                <button className="link_button" type="button" onClick={handle_close_notifications}>
                    Cerrar notificaciones
                </button>
            </footer>
        </div>
    );
}


// Renders the desktop top bar with search and user state.
function render_top_bar(props) {
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
    const has_unread_notifications = notifications.some((notification_item) => !notification_item.is_read);

    return (
        <header className="top_bar">
            <label className="search_box" htmlFor="task_search">
                {render_icon(search_icon, 18)}
                <input
                    id="task_search"
                    type="search"
                    value={search_query}
                    placeholder={props.searchPlaceholder || "Buscar"}
                    onChange={(event) => set_search_query(event.target.value)}
                />
            </label>
            <div className="top_bar_actions">
                <button
                    className="theme_toggle_button"
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
                        type="button"
                        aria-label="Notificaciones"
                        onClick={handle_toggle_notifications}
                    >
                        {render_icon(bell_icon, 18)}
                        {has_unread_notifications ? <span className="bell_unread_dot"></span> : null}
                    </button>

                </div>
                <span className="soft_avatar">{current_user.initials}</span>
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
        <header className="mobile_header">
            <div className="mobile_header_row">
                <button
                    className="mobile_menu_button"
                    type="button"
                    aria-label={detailOpen ? "Volver" : "Abrir navegacion"}
                    onClick={() => detailOpen ? onBack() : set_is_sidebar_open(true)}
                >
                    {detailOpen ? render_icon(arrow_left_icon, 24) : render_icon(menu_icon, 24)}
                </button>
                {detailOpen ? <h1>{title}</h1> : active_item?.brand ? render_logo() : <h1>{title}</h1>}
                <button className="mobile_more_button" type="button" aria-label="Notificaciones" aria-expanded={props.is_notifications_open} onClick={props.handle_toggle_notifications}>
                    {render_icon(bell_icon, 22)}
                    {props.notifications.some(item => !item.is_read) && <span className="bell_unread_dot" />}
                </button>
            </div>
        </header>
    );
}


