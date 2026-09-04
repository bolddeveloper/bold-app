import { Component as react_component, createElement as create_element, useEffect as use_effect, useMemo as use_memo, useState as use_state } from "react";
import {
    ArrowLeft as arrow_left_icon,
    ArrowUp as arrow_up_icon,
    BarChart3 as bar_chart_icon,
    Bell as bell_icon,
    CalendarDays as calendar_days_icon,
    Check as check_icon,
    CheckCircle2 as check_circle_icon,
    ChevronDown as chevron_down_icon,
    ChevronLeft as chevron_left_icon,
    ChevronRight as chevron_right_icon,
    Columns3 as columns_icon,
    FileText as file_text_icon,
    Folder as folder_icon,
    GanttChart as gantt_chart_icon,
    Home as home_icon,
    Inbox as inbox_icon,
    LayoutList as layout_list_icon,
    Link as link_icon,
    Menu as menu_icon,
    MessageCircle as message_circle_icon,
    MoreHorizontal as more_horizontal_icon,
    Paperclip as paperclip_icon,
    Pencil as pencil_icon,
    Plus as plus_icon,
    Search as search_icon,
    SlidersHorizontal as sliders_icon,
    Trash2 as trash_icon,
    UserPlus as user_plus_icon,
    X as x_icon
} from "lucide-react";
import { navigation_items, notification_items, project_items, starter_tasks, team_members } from "./data/task_data.js";
import {
    add_comment as add_comment_request,
    create_task as create_task_request,
    delete_task as delete_task_request,
    get_demo_workspace_id,
    is_using_real_backend,
    list_tasks as list_tasks_request,
    move_task as move_task_request,
    toggle_subtask as toggle_subtask_request,
    update_task as update_task_request
} from "./services/api_client.js";
import {
    connect_realtime_stream,
    disconnect_realtime_stream,
    publish_task_event,
    subscribe_to_task_events
} from "./services/realtime_adapter.js";
import { create_task_event, task_event_types } from "./services/task_events.js";


// Defines the project views available in the focused tasks module.
const view_items = [
    {
        id: "list",
        label: "Lista",
        icon: layout_list_icon
    },
    {
        id: "board",
        label: "Tablero",
        icon: columns_icon
    },
    {
        id: "timeline",
        label: "Cronograma",
        icon: gantt_chart_icon
    },
    {
        id: "calendar",
        label: "Calendario",
        icon: calendar_days_icon
    }
];


// Defines the workflow sections used by the task project.
const task_sections = [
    {
        id: "in_progress",
        label: "En curso"
    },
    {
        id: "todo",
        label: "Por hacer"
    },
    {
        id: "completed",
        label: "Completadas"
    }
];


// Maps navigation ids to Lucide icons while keeping app names in snake case.
const icon_map = {
    home: home_icon,
    check: check_icon,
    inbox: inbox_icon,
    reports: bar_chart_icon
};


// Defines empty shell content for modules that are not active in the MVP.
const placeholder_content = {
    home: {
        title: "Inicio",
        eyebrow: "BOLD WORKSPACE",
        body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer non sem sed mauris faucibus facilisis."
    },
    inbox: {
        title: "Bandeja de entrada",
        eyebrow: "ACTUALIZACIONES",
        body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent dictum erat nec lectus interdum."
    },
    reports: {
        title: "Informes",
        eyebrow: "REPORTES",
        body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse vitae justo vel nisi vehicula."
    }
};


// Defines the visible days for the static September calendar preview.
const calendar_days = Array.from({
    length: 30
}, (_item, index) => index + 1);


// Matches the "Hoy" (today) highlight used across the demo (due_day 2).
const today_day_of_month = 2;


// Defines the priority values used across filters and the task form.

// Defines the board columns used in the workflow view matching Image 3.
const default_board_columns = [
    { id: "todo", label: "Por hacer", status: "Pend." },
    { id: "in_progress", label: "En curso", status: "Activa" },
    { id: "completed", label: "Completadas", status: "Lista" }
];

const month_names_es = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

const month_abbrev_es = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
];

const priority_items = ["Alta", "Media", "Baja"];
const default_status_items = ["Activa", "Pend.", "Lista", "Inactiva"];


const projects_storage_key = "bold_task_projects";
const project_color_options = ["#ef1f2d", "#f97316", "#facc15", "#22c55e", "#22b8c7", "#4f6bed", "#8e4fd1", "#e85d94", "#9ca3af"];
const comments_storage_key = "bold_task_comments_by_task";


// Defines the optional desktop list columns and their labels/widths, in the
// fixed order they render, so "Campos visibles" can show/hide them.
const optional_column_items = [
    { key: "assignee", label: "RESPONSABLE", width: "140px" },
    { key: "date", label: "FECHA", width: "120px" },
    { key: "priority", label: "PRIORIDAD", width: "140px" },
    { key: "status", label: "ESTADO", width: "140px" },
    { key: "project", label: "PROYECTO", width: "160px" }
];


// Builds the grid-template-columns value matching the currently visible
// optional columns, so the header and every row stay aligned.
function get_task_table_columns_style(visible_fields, with_checkbox_column, column_items = optional_column_items) {
    const visible_widths = column_items
        .filter((column_item) => visible_fields[column_item.key])
        .map((column_item) => column_item.width);
    const checkbox_column = with_checkbox_column ? "32px " : "";

    return { gridTemplateColumns: `${checkbox_column}minmax(280px, 1fr) 68px ${visible_widths.join(" ")}` };
}


// Finds a team member by id for avatar and detail rendering.
function get_member(member_id) {
    return team_members.find((member_item) => member_item.id === member_id) || null;
}


// Resolves all collaborators assigned to a task (falling back to assignee_id if none set).
function get_task_collaborators(task) {
    if (!task) return [];
    const collaborator_ids = Array.isArray(task.collaborator_ids) ? task.collaborator_ids : [];
    const ids = collaborator_ids.length
        ? collaborator_ids
        : (task.assignee_id ? [task.assignee_id] : []);
    return ids.map((id) => get_member(id)).filter(Boolean);
}


function get_saved_comments_by_task() {
    try {
        const saved_comments = JSON.parse(localStorage.getItem(comments_storage_key));
        return saved_comments && typeof saved_comments === "object" && !Array.isArray(saved_comments) ? saved_comments : {};
    } catch (_error) {
        return {};
    }
}


function save_task_comments(task_id, comments) {
    localStorage.setItem(comments_storage_key, JSON.stringify({
        ...get_saved_comments_by_task(),
        [task_id]: comments
    }));
}


function normalize_task(task_item = {}) {
    return {
        ...task_item,
        title: String(task_item.title || "Tarea sin nombre"),
        tags: Array.isArray(task_item.tags) ? task_item.tags : [],
        subtasks: Array.isArray(task_item.subtasks) ? task_item.subtasks : [],
        comments: Array.isArray(task_item.comments) ? task_item.comments : [],
        collaborator_ids: Array.isArray(task_item.collaborator_ids) ? task_item.collaborator_ids : []
    };
}


function merge_saved_comments(tasks) {
    const saved_comments = get_saved_comments_by_task();

    return (Array.isArray(tasks) ? tasks : []).map((task_item) => normalize_task({
        ...task_item,
        comments: Array.isArray(saved_comments[task_item.id]) ? saved_comments[task_item.id] : task_item.comments
    }));
}


// Finds a project by id for labels and color rendering.
function get_project(project_id) {
    return project_items.find((project_item) => project_item.id === project_id) || project_items[0];
}


// Filters tasks by title, assignee, project, and tag text.
function get_filtered_tasks(tasks, search_query) {
    const normalized_query = search_query.trim().toLowerCase();

    if (!normalized_query) {
        return tasks;
    }

    return tasks.filter((task_item) => {
        const member_item = get_member(task_item.assignee_id);
        const project_item = get_project(task_item.project_id);
        const searchable_text = [
            task_item.title,
            task_item.description,
            task_item.priority,
            task_item.status,
            project_item.label,
            member_item?.name || "",
            ...(Array.isArray(task_item.tags) ? task_item.tags : [])
        ].join(" ").toLowerCase();

        return searchable_text.includes(normalized_query);
    });
}


// Ranks priorities so "Ordenar" can sort by them.
const priority_rank = {
    Alta: 3,
    Media: 2,
    Baja: 1
};


// Keeps only the tasks matching every active filter category (empty
// categories match everything).
function get_tasks_matching_active_filters(tasks, active_filters) {
    return tasks.filter((task_item) => {
        const matches_assignee = !active_filters.assignee_ids.length || active_filters.assignee_ids.includes(task_item.assignee_id);
        const matches_priority = !active_filters.priorities.length || active_filters.priorities.includes(task_item.priority);
        const matches_section = !active_filters.sections.length || active_filters.sections.includes(task_item.section);

        return matches_assignee && matches_priority && matches_section;
    });
}


// Sorts tasks by the requested field and direction without mutating the input.
function get_sorted_tasks(tasks, sort_field, sort_direction) {
    const direction_multiplier = sort_direction === "desc" ? -1 : 1;

    return [...tasks].sort((task_a, task_b) => {
        if (sort_field === "due_day") {
            return (task_a.due_day - task_b.due_day) * direction_multiplier;
        }

        if (sort_field === "priority") {
            return ((priority_rank[task_a.priority] || 0) - (priority_rank[task_b.priority] || 0)) * direction_multiplier;
        }

        return task_a.title.localeCompare(task_b.title) * direction_multiplier;
    });
}


// Returns the tasks that belong to a workflow section.
function get_tasks_by_section(tasks, section_id) {
    return tasks.filter((task_item) => task_item.section === section_id);
}


// Returns a class name for priority badges.
function get_priority_class(priority) {
    return `priority_${String(priority || "media").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}


// Returns a class name for status badges.
function get_status_class(status) {
    return `status_${String(status || "pend").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}


// Resolves the section and status that should follow a checkbox toggle.
function get_toggled_task_state(task_item) {
    if (task_item.completed) {
        return {
            completed: false,
            section: "in_progress",
            status: "Activa"
        };
    }

    return {
        completed: true,
        section: "completed",
        status: "Lista"
    };
}


// Renders a Lucide icon through React createElement so aliases can stay in snake case.
function render_icon(icon_component, size = 18) {
    return create_element(icon_component, {
        size,
        strokeWidth: 2,
        "aria-hidden": "true"
    });
}


// Parses a task's due_label (e.g. "10 sep" or "10 sep 2026") and returns
// a Date object at midnight for that deadline.  Falls back to the current
// year when the label does not include one.
function parse_due_date(task_item) {
    if (!task_item || !task_item.due_day) return null;
    const now_year = new Date().getFullYear();
    let due_month = 8; // default: September (index 8, same as starter data)
    let due_year  = now_year;

    if (task_item.due_label) {
        const parts = task_item.due_label.trim().split(/\s+/);
        // Formats: "10 sep"  →  ["10","sep"]
        //          "10 sep 2026"  →  ["10","sep","2026"]
        if (parts.length >= 2) {
            const month_index = month_abbrev_es.indexOf(parts[1].toLowerCase());
            if (month_index !== -1) due_month = month_index;
        }
        if (parts.length >= 3) {
            const parsed_year = parseInt(parts[2], 10);
            if (!isNaN(parsed_year)) due_year = parsed_year;
        }
    }

    const d = new Date(due_year, due_month, task_item.due_day);
    d.setHours(0, 0, 0, 0);
    return d;
}


// Calculates how many calendar days remain until a task's real deadline.
// Returns null when no due date is set or the task is already completed.
function get_days_remaining(task_item) {
    if (!task_item || !task_item.due_day || task_item.completed) return null;
    const due = parse_due_date(task_item);
    if (!due) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff_ms = due.getTime() - today.getTime();
    return Math.round(diff_ms / (1000 * 60 * 60 * 24));
}


// Renders a compact badge showing days remaining/overdue for a task.
function render_days_badge(task_item) {
    const days = get_days_remaining(task_item);
    if (days === null) return null;

    let badge_class = "days_badge";
    let label;

    if (days === 0) {
        badge_class += " days_badge_today";
        label = "Hoy";
    } else if (days > 0) {
        badge_class += " days_badge_future";
        label = `+${days}d`;
    } else {
        badge_class += " days_badge_overdue";
        label = `${days}d`;
    }

    const tooltip = days > 0
        ? `Faltan ${days} día(s)`
        : days === 0
            ? "Vence hoy"
            : `Vencida hace ${Math.abs(days)} día(s)`;

    return <span className={badge_class} title={tooltip}>{label}</span>;
}


// Renders the small Bold logo mark used in the navigation shell.
function render_logo() {
    return (
        <div className="brand_logo" aria-label="Bold">
            <span>bold</span>
            <span className="brand_dot"></span>
        </div>
    );
}


// Renders a reusable team avatar.
function render_avatar(member_item, size_class = "avatar_medium") {
    if (!member_item) {
        return (
            <span className={`${size_class} avatar_empty`}>
                {render_icon(plus_icon, 16)}
            </span>
        );
    }

    return (
        <span className={size_class} style={{ "--avatar_color": member_item.color }}>
            {member_item.initials}
        </span>
    );
}


// Renders a colored project dot.
function render_project_dot(color) {
    return (
        <span className="project_dot" style={{ "--project_color": color }}></span>
    );
}


// Renders one navigation item in the sidebar.
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
                {item.id === "tasks" && is_active ? render_icon(check_icon, 16) : render_icon(item_icon, 17)}
            </span>
            <span>{item.label}</span>
            {item.id === "tasks" ? (
                <span className={`navigation_chevron ${is_expanded ? "navigation_chevron_open" : ""}`}>
                    {render_icon(chevron_down_icon, 18)}
                </span>
            ) : null}
        </button>
    );
}


// Renders a project item in the sidebar workspace list.
function render_project_item(project_item, selected_project_id) {
    const is_active = selected_project_id === project_item.id;

    return (
        <button
            className={`project_item ${is_active ? "project_item_active" : ""}`}
            key={project_item.id}
            type="button"
        >
            {render_project_dot(project_item.color)}
            <span>{project_item.label}</span>
            {is_active ? (
                <span className="project_more">•••</span>
            ) : null}
        </button>
    );
}


// Renders the task workspace content nested below Tareas.
function render_tasks_workspace_menu(handle_module_change, set_active_modal, projects) {
    return (
        <div className="tasks_submenu" id="tasks_workspace_menu">
            <button className="my_tasks_button" type="button" onClick={() => handle_module_change("tasks")}>
                <span className="submenu_dot"></span>
                <span>Mis tareas</span>
            </button>

            <div className="sidebar_section workspace_block">
                <p className="sidebar_label">WORKSPACE</p>
                <button className="workspace_selector" type="button">
                    <span className="workspace_badge">B</span>
                    <span>BOLD Workspace</span>
                    {render_icon(chevron_down_icon, 16)}
                </button>
            </div>

            <div className="sidebar_section projects_block">
                <div className="projects_heading">
                    <p className="sidebar_label">PROYECTOS</p>
                    <button
                        className="sidebar_add_button"
                        type="button"
                        aria-label="Crear proyecto"
                        onClick={() => set_active_modal("project")}
                    >
                        {render_icon(plus_icon, 18)}
                    </button>
                </div>

                <div className="project_list">
                    {projects.map((project_item) => render_project_item(project_item, "launch_q4"))}
                </div>
            </div>
        </div>
    );
}


// Renders the desktop and mobile sidebar navigation.
function render_sidebar(props) {
    const {
        active_module,
        handle_module_change,
        handle_tasks_menu_toggle,
        is_sidebar_open,
        is_tasks_menu_open,
        projects,
        set_active_modal,
        set_is_sidebar_open
    } = props;
    const primary_navigation_items = navigation_items.filter((item) => ["home", "tasks", "inbox", "reports"].includes(item.id));

    return (
        <aside className={`sidebar_shell ${is_sidebar_open ? "sidebar_shell_open" : ""}`}>
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
                            if (item.id !== "tasks") {
                                return render_navigation_item(item, active_module, handle_module_change);
                            }

                            return (
                                <div className="tasks_navigation_group" key={item.id}>
                                    {render_navigation_item(item, active_module, handle_module_change, {
                                        controls_id: "tasks_workspace_menu",
                                        is_expandable: true,
                                        is_expanded: is_tasks_menu_open,
                                        on_click: handle_tasks_menu_toggle
                                    })}
                                    {is_tasks_menu_open ? render_tasks_workspace_menu(handle_module_change, set_active_modal, projects) : null}
                                </div>
                            );
                        })}
                    </nav>
                </div>
            </div>

            <div className="sidebar_footer">
                <span className="profile_avatar">JS</span>
                <div className="profile_text">
                    <strong>Joaquin Sierra</strong>
                    <span>Administrador</span>
                </div>
                <button className="profile_menu_button" type="button" aria-label="Perfil">
                    {render_icon(more_horizontal_icon, 18)}
                </button>
            </div>
        </aside>
    );
}


// Maps each notification type to the icon shown in its list item.
const notification_type_icons = {
    assignment: user_plus_icon,
    comment: message_circle_icon,
    status_changed: check_circle_icon
};


// Renders the "Notificaciones" dropdown panel opened from the bell button.
function render_notifications_panel(props) {
    const {
        handle_close_notifications,
        handle_mark_notifications_read,
        notifications
    } = props;

    return (
        <div className="task_tool_panel notifications_panel">
            <header className="notifications_panel_header">
                <h3>Notificaciones</h3>
                <button className="link_button" type="button" onClick={handle_mark_notifications_read}>
                    Marcar como leidas
                </button>
            </header>
            <div className="notification_list">
                {notifications.map((notification_item) => {
                    const actor = team_members.find((member) => member.id === notification_item.actor_id);
                    const notification_icon = notification_type_icons[notification_item.type] ?? bell_icon;

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
                    Ver todas las notificaciones
                </button>
            </footer>
        </div>
    );
}


// Renders the desktop top bar with search and user state.
function render_top_bar(props) {
    const {
        handle_close_notifications,
        handle_mark_notifications_read,
        handle_toggle_notifications,
        is_notifications_open,
        notifications,
        search_query,
        set_search_query
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
                    placeholder="Buscar tareas, proyectos o personas"
                    onChange={(event) => set_search_query(event.target.value)}
                />
            </label>
            <div className="top_bar_actions">
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
                    {is_notifications_open ? render_notifications_panel({
                        handle_close_notifications,
                        handle_mark_notifications_read,
                        notifications
                    }) : null}
                </div>
                <span className="soft_avatar">JS</span>
            </div>
        </header>
    );
}


// Renders the compact mobile header used above the active module.
function render_mobile_header(props) {
    const {
        active_module,
        selected_task,
        set_active_modal,
        set_is_sidebar_open
    } = props;

    const active_item = navigation_items.find((item) => item.id === active_module);
    const title = selected_task ? "Detalle de tarea" : active_item?.label || "Tareas";

    return (
        <header className="mobile_header">
            <div className="mobile_status_bar">
                <span>9:41</span>
                <span className="mobile_battery"></span>
            </div>
            <div className="mobile_header_row">
                <button
                    className="mobile_menu_button"
                    type="button"
                    aria-label={selected_task ? "Volver" : "Abrir navegacion"}
                    onClick={() => selected_task ? set_active_modal(null) : set_is_sidebar_open(true)}
                >
                    {selected_task ? render_icon(arrow_left_icon, 24) : render_icon(menu_icon, 24)}
                </button>
                {selected_task ? <h1>{title}</h1> : active_module === "tasks" ? render_logo() : <h1>{title}</h1>}
                <button
                    className="mobile_more_button"
                    type="button"
                    aria-label="Mas opciones"
                    onClick={() => set_active_modal(selected_task ? "project_menu" : null)}
                >
                    {selected_task ? render_icon(more_horizontal_icon, 21) : <span>JS</span>}
                </button>
            </div>
        </header>
    );
}


// Renders the empty placeholder used by modules outside the tasks MVP.
function render_placeholder_module(active_module) {
    const placeholder_item = placeholder_content[active_module] || placeholder_content.home;

    return (
        <section className="placeholder_module">
            <p className="eyebrow_text">{placeholder_item.eyebrow}</p>
            <h1>{placeholder_item.title}</h1>
            <p>{placeholder_item.body}</p>
            <div className="placeholder_card">
                <span className="placeholder_icon">{render_icon(file_text_icon, 36)}</span>
                <h2>Modulo vacio</h2>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec at arcu sed velit bibendum.</p>
            </div>
        </section>
    );
}


// Renders the "Filtrar" dropdown panel with assignee/state/priority checkboxes.
function render_filter_panel(props) {
    const {
        active_filters,
        handle_clear_filters,
        handle_close_task_tool,
        handle_toggle_filter_value
    } = props;
    const filter_groups = [
        {
            key: "assignee_ids",
            label: "Responsable",
            items: team_members.map((member_item) => ({ id: member_item.id, label: member_item.name }))
        },
        {
            key: "sections",
            label: "Estado",
            items: task_sections.map((section_item) => ({ id: section_item.id, label: section_item.label }))
        },
        {
            key: "priorities",
            label: "Prioridad",
            items: priority_items.map((priority_item) => ({ id: priority_item, label: priority_item }))
        }
    ];

    return (
        <div className="task_tool_panel">
            <h3>Filtrar</h3>
            <div className="filter_list">
                {filter_groups.map((group_item) => (
                    <details className="filter_list_group" key={group_item.key}>
                        <summary className="filter_group_label">
                            <span>{group_item.label}</span>
                            <span>{active_filters[group_item.key].length || ""}</span>
                            {render_icon(chevron_down_icon, 14)}
                        </summary>
                        {group_item.items.map((item) => (
                            <label className="filter_option filter_list_option" key={item.id}>
                                <input
                                    type="checkbox"
                                    checked={active_filters[group_item.key].includes(item.id)}
                                    onChange={() => handle_toggle_filter_value(group_item.key, item.id)}
                                />
                                {item.label}
                            </label>
                        ))}
                    </details>
                ))}
            </div>
            <footer className="modal_footer">
                <button className="secondary_button" type="button" onClick={handle_clear_filters}>
                    Limpiar
                </button>
                <button className="primary_button" type="button" onClick={handle_close_task_tool}>
                    Aplicar
                </button>
            </footer>
        </div>
    );
}


// Renders the "Ordenar" dropdown panel.
function render_sort_panel(props) {
    const {
        handle_close_task_tool,
        set_sort_direction,
        set_sort_field,
        sort_direction,
        sort_field
    } = props;
    const sort_field_items = [
        { id: "title", label: "Nombre de tarea" },
        { id: "due_day", label: "Fecha limite" },
        { id: "priority", label: "Prioridad" }
    ];

    return (
        <div className="task_tool_panel">
            <h3>Ordenar</h3>
            <div className="filter_option_list">
                {sort_field_items.map((field_item) => (
                    <button
                        className={`sort_option ${sort_field === field_item.id ? "sort_option_active" : ""}`}
                        key={field_item.id}
                        type="button"
                        onClick={() => set_sort_field(field_item.id)}
                    >
                        {field_item.label}
                        {sort_field === field_item.id ? render_icon(check_icon, 14) : null}
                    </button>
                ))}
            </div>
            <div className="filter_group">
                <span className="filter_group_label">Direccion</span>
                <select value={sort_direction} onChange={(event) => set_sort_direction(event.target.value)}>
                    <option value="asc">Ascendente</option>
                    <option value="desc">Descendente</option>
                </select>
            </div>
            <footer className="modal_footer">
                <button className="primary_button" type="button" onClick={handle_close_task_tool}>
                    Listo
                </button>
            </footer>
        </div>
    );
}


// Renders the "Personalizar" dropdown panel for toggling visible columns.
function render_customize_panel(props) {
    const {
        handle_close_task_tool,
        handle_toggle_visible_field,
        visible_fields
    } = props;

    return (
        <div className="task_tool_panel">
            <h3>Campos visibles</h3>
            <div className="filter_option_list">
                {optional_column_items.map((column_item) => (
                    <label className="filter_option" key={column_item.key}>
                        <input
                            type="checkbox"
                            checked={visible_fields[column_item.key]}
                            onChange={() => handle_toggle_visible_field(column_item.key)}
                        />
                        {column_item.label}
                    </label>
                ))}
            </div>
            <footer className="modal_footer">
                <button className="primary_button" type="button" onClick={handle_close_task_tool}>
                    Guardar
                </button>
            </footer>
        </div>
    );
}



// ─── COMPONENTES DEL PLAN MAESTRO ────────────────────────────────────────────

// SVG for list toggle: 3 circular dots with 3 rounded horizontal lines (exact match to visual reference)
function ListToggleIcon() {
    return (
        <svg width="26" height="20" viewBox="0 0 26 20" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="3.5" r="2.5" />
            <rect x="8.5" y="1.5" width="16.5" height="4" rx="2" />
            <circle cx="3" cy="10" r="2.5" />
            <rect x="8.5" y="8" width="16.5" height="4" rx="2" />
            <circle cx="3" cy="16.5" r="2.5" />
            <rect x="8.5" y="14.5" width="16.5" height="4" rx="2" />
        </svg>
    );
}

// SVG for columns toggle: 3 vertical outlined rounded rectangles (exact match to visual reference)
function ColumnsToggleIcon() {
    return (
        <svg width="24" height="22" viewBox="0 0 24 22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.5" y="1.5" width="5" height="19" rx="2" />
            <rect x="9.5" y="1.5" width="5" height="19" rx="2" />
            <rect x="17.5" y="1.5" width="5" height="19" rx="2" />
        </svg>
    );
}

// Toggle icon switch Lista ↔ Columnas (matching user reference image)
function render_view_switch(active_view, set_active_view) {
    return (
        <div className="view_switch_toggle" role="group" aria-label="Cambiar estilo de visualización">
            <button
                type="button"
                className={`toggle_side ${active_view === "list" ? "view_list_active" : ""}`}
                aria-pressed={active_view === "list"}
                title="Vista en lista"
                onClick={() => set_active_view("list")}
            >
                <ListToggleIcon />
            </button>
            <button
                type="button"
                className={`toggle_side ${active_view === "board" ? "view_board_active" : ""}`}
                aria-pressed={active_view === "board"}
                title="Vista en columnas"
                onClick={() => set_active_view("board")}
            >
                <ColumnsToggleIcon />
            </button>
        </div>
    );
}


// Inline priority quick-change popover (Image 5 of design reference).
function QuickPriorityPopover({ current_priority, on_close, on_select }) {
    const options = [
        { value: "Alta", dot: "#e22323", label: "ALTA" },
        { value: "Media", dot: "#f59e0b", label: "MEDIA" },
        { value: "Baja", dot: "#9ca3af", label: "BAJA" }
    ];
    return (
        <div className="quick_popover_bubble" role="menu" onClick={(e) => e.stopPropagation()}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className="quick_popover_item_btn"
                    role="menuitem"
                    onClick={() => { on_select(opt.value); on_close(); }}
                >
                    <span className="quick_popover_circle" style={{ background: opt.dot }}></span>
                    <span>{opt.label}</span>
                    {current_priority === opt.value ? (
                        <span className="quick_popover_check_icon">{render_icon(check_icon, 13)}</span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}


// Inline status quick-change popover (Image 5 of design reference).
function QuickStatusPopover({ current_status, on_close, on_select, status_options = default_status_items }) {
    const status_colors = {
        "Activa": "#3b82f6",
        "Pend.": "#f59e0b",
        "Inactiva": "#9ca3af",
        "Lista": "#22c55e"
    };
    const options = status_options.map((status_item) => ({
        value: status_item,
        dot: status_colors[status_item] || "#9ca3af",
        label: status_item === "Pend." ? "PENDIENTE" : status_item.toUpperCase()
    }));
    return (
        <div className="quick_popover_bubble" role="menu" onClick={(e) => e.stopPropagation()}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className="quick_popover_item_btn"
                    role="menuitem"
                    onClick={() => { on_select(opt.value); on_close(); }}
                >
                    <span className="quick_popover_circle" style={{ background: opt.dot }}></span>
                    <span>{opt.label}</span>
                    {current_status === opt.value ? (
                        <span className="quick_popover_check_icon">{render_icon(check_icon, 13)}</span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}


// Custom calendar date picker popover (Images 2 & 4 of design reference).
function CustomDatePicker({ current_day, on_apply, on_clear }) {
    const [view_month, set_view_month] = use_state(8); // 0-indexed, 8 = septiembre
    const [view_year, set_view_year] = use_state(2026);
    const [picked_day, set_picked_day] = use_state(current_day || null);
    const year_options = Array.from({ length: 101 }, (_, index) => 2000 + index);

    const days_in_month = new Date(view_year, view_month + 1, 0).getDate();
    const first_weekday = new Date(view_year, view_month, 1).getDay();
    const blanks = Array.from({ length: first_weekday });
    const day_cells = Array.from({ length: days_in_month }, (_, i) => i + 1);

    function go_prev() {
        if (view_month === 0) { set_view_month(11); set_view_year((y) => y - 1); }
        else set_view_month((m) => m - 1);
    }
    function go_next() {
        if (view_month === 11) { set_view_month(0); set_view_year((y) => y + 1); }
        else set_view_month((m) => m + 1);
    }

    return (
        <div className="custom_datepicker_popover" onClick={(e) => e.stopPropagation()}>
            <div className="custom_datepicker_nav">
                <button type="button" onClick={go_prev}>{render_icon(chevron_left_icon, 16)}</button>
                <select aria-label="Mes" value={view_month} onChange={(event) => set_view_month(Number(event.target.value))}>
                    {month_names_es.map((month_name, month_index) => (
                        <option key={month_name} value={month_index}>{month_name}</option>
                    ))}
                </select>
                <select aria-label="Año" value={view_year} onChange={(event) => set_view_year(Number(event.target.value))}>
                    {year_options.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
                <button type="button" onClick={go_next}>{render_icon(chevron_right_icon, 16)}</button>
            </div>
            <div className="custom_datepicker_grid">
                {["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"].map((d) => (
                    <span key={d} className="day_header_cell">{d}</span>
                ))}
                {blanks.map((_, i) => <span key={`b${i}`}></span>)}
                {day_cells.map((d) => (
                    <button
                        key={d}
                        type="button"
                        className={`day_cell ${picked_day === d ? "day_cell_active" : ""}`}
                        onClick={() => set_picked_day(d)}
                    >
                        {d}
                    </button>
                ))}
            </div>
            <div className="custom_datepicker_actions">
                <button type="button" className="dp_clear_btn" onClick={() => { set_picked_day(null); on_clear && on_clear(); }}>
                    Quitar fecha
                </button>
                <button
                    type="button"
                    className="dp_apply_btn"
                    onClick={() => on_apply && on_apply(picked_day, view_month, view_year)}
                >
                    Aplicar
                </button>
            </div>
        </div>
    );
}


// Right-side task detail sidebar panel (Image 3 of design reference).
function TaskDetailPanel({ handle_add_comment, handle_delete_task, handle_open_edit_task, handle_toggle_subtask, handle_toggle_task, on_close, selected_task }) {
    const [comment_text, set_comment_text] = use_state("");
    const member_item = get_member(selected_task.assignee_id);
    const project_item = get_project(selected_task.project_id);
    const subtasks = Array.isArray(selected_task.subtasks) ? selected_task.subtasks : [];
    const comments = Array.isArray(selected_task.comments) ? selected_task.comments : [];
    const collaborators = get_task_collaborators(selected_task);
    const done_count = subtasks.filter((s) => s.completed).length;
    const subtask_pct = subtasks.length ? Math.round((done_count / subtasks.length) * 100) : 0;

    const status_colors = {
        "Activa": "#3b82f6",
        "Pend.": "#f59e0b",
        "Inactiva": "#9ca3af",
        "Lista": "#22c55e"
    };
    const status_color = status_colors[selected_task.status] || "#9ca3af";

    return (
        <div className="task_detail_panel_card">
            <div className="detail_top_eyebrow_row">
                <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em" }}>DETALLE DE TAREA</span>
                <div style={{ display: "flex", gap: "6px" }}>
                    <button
                        type="button"
                        className="detail_action_btn"
                        title="Editar tarea"
                        onClick={() => handle_open_edit_task(selected_task.id)}
                    >
                        {render_icon(pencil_icon, 15)}
                    </button>
                    <button
                        type="button"
                        className="detail_action_btn detail_delete_btn"
                        title="Eliminar tarea"
                        onClick={() => handle_delete_task(selected_task.id)}
                    >
                        {render_icon(trash_icon, 15)}
                    </button>
                    <button type="button" className="detail_action_btn" title="Cerrar panel" onClick={on_close}>
                        {render_icon(x_icon, 16)}
                    </button>
                </div>
            </div>

            <div className="detail_title_row">
                <button
                    type="button"
                    className={`task_checkbox ${selected_task.completed ? "task_checkbox_checked" : ""}`}
                    onClick={() => handle_toggle_task(selected_task.id)}
                    aria-label="Completar tarea"
                >
                    {selected_task.completed ? render_icon(check_icon, 12) : null}
                </button>
                <h2 className="detail_task_title">{selected_task.title}</h2>
                <span
                    className="status_pill_badge"
                    style={{ background: `${status_color}1a`, color: status_color, border: `1px solid ${status_color}55` }}
                >
                    {selected_task.status}
                </span>
            </div>

            <div className="detail_meta_grid">
                <span className="meta_label">Colaboradores</span>
                <span className="meta_value" style={{ flexWrap: "wrap" }}>
                    {collaborators.length > 0 ? (
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            {collaborators.map((collab) => (
                                <span key={collab.id} className="collaborator_mini_pill" title={collab.name}>
                                    {render_avatar(collab, "avatar_tiny")}
                                    <span>{collab.name}</span>
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span style={{ color: "#9ca3af" }}>Sin asignar</span>
                    )}
                </span>

                <span className="meta_label">Fecha límite</span>
                <span className="meta_value">{selected_task.due_label || "Sin fecha"}</span>

                <span className="meta_label">Proyecto</span>
                <span className="meta_value">
                    {render_project_dot(project_item?.color)}
                    {project_item?.label || "Sin proyecto"}
                </span>

                <span className="meta_label">Prioridad</span>
                <span className="meta_value">
                    <span className={`priority_pill_badge priority_pill_${get_priority_class(selected_task.priority).replace("priority_", "")}`}>
                        {selected_task.priority || "Alta"}
                    </span>
                </span>
            </div>

            {/* Apartado visual de colaboradores del proyecto en el detalle */}
            <div className="detail_collaborators_card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        COLABORADORES ({collaborators.length})
                    </span>
                    <button
                        type="button"
                        className="detail_add_collab_link"
                        onClick={() => handle_open_edit_task(selected_task.id)}
                        title="Modificar colaboradores de la tarea"
                    >
                        {render_icon(user_plus_icon, 13)}
                        <span>Modificar</span>
                    </button>
                </div>

                {collaborators.length > 0 ? (
                    <div className="detail_collab_list">
                        {collaborators.map((c) => (
                            <div key={c.id} className="detail_collab_row">
                                {render_avatar(c, "avatar_small")}
                                <div className="detail_collab_info">
                                    <strong className="detail_collab_name">{c.name}</strong>
                                    <small className="detail_collab_email">{c.email}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="detail_collab_empty" onClick={() => handle_open_edit_task(selected_task.id)}>
                        {render_icon(user_plus_icon, 16)}
                        <span>Haz clic para asignar colaboradores a esta tarea</span>
                    </div>
                )}
            </div>

            {selected_task.description ? (
                <div className="detail_description_block">
                    <p className="meta_label" style={{ marginBottom: "6px" }}>Descripción</p>
                    <p style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>{selected_task.description}</p>
                </div>
            ) : null}

            {subtasks.length > 0 ? (
                <div className="detail_subtasks_block">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em" }}>SUBTAREAS</span>
                        <span className="subtasks_badge">{done_count} de {subtasks.length}</span>
                    </div>
                    <div className="subtasks_progress_bar">
                        <div className="subtasks_progress_fill" style={{ width: `${subtask_pct}%` }}></div>
                    </div>
                    {subtasks.map((sub) => (
                        <div key={sub.id} className="subtask_check_row">
                            <button
                                type="button"
                                className={`subtask_circle_btn ${sub.completed ? "subtask_circle_done" : ""}`}
                                onClick={() => handle_toggle_subtask(selected_task.id, sub.id)}
                            >
                                {sub.completed ? render_icon(check_icon, 11) : null}
                            </button>
                            <span className={`subtask_text ${sub.completed ? "subtask_text_done" : ""}`}>{sub.title}</span>
                        </div>
                    ))}
                </div>
            ) : null}

            {comments.length ? (
                <div className="detail_comments_list">
                    {comments.map((comment_item) => (
                        <div className="detail_comment_item" key={comment_item.id}>
                            <strong>{comment_item.author_name || "Joaquin Sierra"}</strong>
                            <p>{comment_item.body}</p>
                            {comment_item.created_at ? (
                                <small>{new Date(comment_item.created_at).toLocaleString()}</small>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="detail_comments_empty">Aun no hay comentarios.</p>
            )}

            <div className="detail_comment_input_box">
                <input
                    type="text"
                    className="detail_comment_input"
                    placeholder="Escribe un comentario..."
                    value={comment_text}
                    onChange={(e) => set_comment_text(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && comment_text.trim()) {
                            handle_add_comment(selected_task.id, comment_text);
                            set_comment_text("");
                        }
                    }}
                />
                <button
                    type="button"
                    className="detail_comment_send_btn"
                    disabled={!comment_text.trim()}
                    onClick={() => {
                        if (comment_text.trim()) {
                            handle_add_comment(selected_task.id, comment_text);
                            set_comment_text("");
                        }
                    }}
                >
                    {render_icon(arrow_up_icon, 15)}
                </button>
            </div>
        </div>
    );
}


// Selector de colaboradores para los modales de Crear y Editar tarea
function CollaboratorsSelector({ on_change, selected_ids = [] }) {
    const [is_picker_open, set_is_picker_open] = use_state(false);

    function toggle_member(member_id) {
        if (selected_ids.includes(member_id)) {
            on_change(selected_ids.filter((id) => id !== member_id));
        } else {
            on_change([...selected_ids, member_id]);
        }
    }

    function remove_member(e, member_id) {
        e.stopPropagation();
        on_change(selected_ids.filter((id) => id !== member_id));
    }

    const assigned_members = selected_ids.map((id) => get_member(id)).filter(Boolean);

    return (
        <div className="bold_field_group collaborators_field_group">
            <div className="collaborators_field_header">
                <label className="bold_field_label">
                    Colaboradores asignados ({assigned_members.length})
                </label>
                <div style={{ position: "relative" }}>
                    <button
                        type="button"
                        className="add_collaborator_btn"
                        onClick={() => set_is_picker_open((v) => !v)}
                    >
                        {render_icon(user_plus_icon, 14)}
                        <span>Agregar colaborador</span>
                    </button>

                    {is_picker_open ? (
                        <div className="collaborator_picker_dropdown">
                            <div className="picker_title">Personas del proyecto</div>
                            <div className="picker_list">
                                {team_members.map((member) => {
                                    const is_assigned = selected_ids.includes(member.id);
                                    return (
                                        <button
                                            key={member.id}
                                            type="button"
                                            className={`picker_member_row ${is_assigned ? "is_selected" : ""}`}
                                            onClick={() => toggle_member(member.id)}
                                        >
                                            {render_avatar(member, "avatar_small")}
                                            <div className="picker_member_text">
                                                <strong>{member.name}</strong>
                                                <small>{member.email}</small>
                                            </div>
                                            {is_assigned ? (
                                                <span className="picker_check">{render_icon(check_icon, 14)}</span>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                type="button"
                                className="picker_done_btn"
                                onClick={() => set_is_picker_open(false)}
                            >
                                Listo
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="collaborators_chips_container">
                {assigned_members.length > 0 ? (
                    assigned_members.map((member) => (
                        <span key={member.id} className="collaborator_chip">
                            {render_avatar(member, "avatar_tiny")}
                            <span className="chip_name">{member.name}</span>
                            <button
                                type="button"
                                className="chip_remove_btn"
                                aria-label={`Quitar a ${member.name}`}
                                onClick={(e) => remove_member(e, member.id)}
                            >
                                {render_icon(x_icon, 12)}
                            </button>
                        </span>
                    ))
                ) : (
                    <div
                        className="collaborators_empty_hint"
                        onClick={() => set_is_picker_open(true)}
                    >
                        {render_icon(user_plus_icon, 16)}
                        <span>Haz clic en "Agregar colaborador" para asignar personas del proyecto</span>
                    </div>
                )}
            </div>
        </div>
    );
}


// "Editar Tarea" modal (Image 2 of design reference).
function EditTaskModal({ board_columns, edit_attachments, edit_draft, handle_add_edit_attachment, handle_edit_field_change, handle_remove_edit_attachment, handle_toggle_subtask, on_cancel, on_save, selected_task, status_options }) {
    const [show_datepicker, set_show_datepicker] = use_state(false);
    const subtasks = Array.isArray(selected_task.subtasks) ? selected_task.subtasks : [];
    const done_count = subtasks.filter((s) => s.completed).length;

    const current_collaborators = edit_draft.collaborator_ids && edit_draft.collaborator_ids.length
        ? edit_draft.collaborator_ids
        : (edit_draft.assignee_id ? [edit_draft.assignee_id] : []);

    return (
        <div className="bold_modal_backdrop" onClick={on_cancel}>
            <div className="bold_modal_window" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Editar tarea">
                <div className="bold_modal_header">
                    <div>
                        <p className="modal_eyebrow">EDITAR TAREA</p>
                        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#111827" }}>
                            {edit_draft.title || "Tarea sin nombre"}
                        </h2>
                    </div>
                    <button type="button" className="modal_close_btn" onClick={on_cancel} aria-label="Cerrar modal">
                        {render_icon(x_icon, 20)}
                    </button>
                </div>

                <form className="bold_modal_body" onSubmit={on_save}>
                    {/* Nombre */}
                    <div className="bold_field_group">
                        <label className="bold_field_label">Nombre de la tarea</label>
                        <input
                            className="bold_text_input"
                            type="text"
                            value={edit_draft.title || ""}
                            onChange={(e) => handle_edit_field_change("title", e.target.value)}
                            placeholder="Nombre de la tarea"
                        />
                    </div>

                    {/* Proyecto & Sección */}
                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Proyecto</label>
                            <select
                                className="bold_select_input"
                                value={edit_draft.project_id || ""}
                                onChange={(e) => handle_edit_field_change("project_id", e.target.value)}
                            >
                                {project_items.map((p) => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Sección</label>
                            <select
                                className="bold_select_input"
                                value={edit_draft.section || "todo"}
                                onChange={(e) => handle_edit_field_change("section", e.target.value)}
                            >
                                {board_columns.map((col) => (
                                    <option key={col.id} value={col.id}>{col.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Fecha límite */}
                    <div className="bold_field_group" style={{ position: "relative" }}>
                        <label className="bold_field_label">Fecha límite</label>
                        <button
                            type="button"
                            className="bold_date_trigger_btn"
                            onClick={() => set_show_datepicker((v) => !v)}
                        >
                            {render_icon(calendar_days_icon, 15)}
                            {edit_draft.due_day ? edit_draft.due_label || `${edit_draft.due_day} sep 2026` : "Seleccionar fecha"}
                        </button>
                        {show_datepicker ? (
                            <CustomDatePicker
                                current_day={edit_draft.due_day}
                                on_clear={() => { handle_edit_field_change("due_day", null); set_show_datepicker(false); }}
                                on_apply={(day, month, year) => {
                                    handle_edit_field_change("due_day", day);
                                    handle_edit_field_change("due_label", `${day} ${month_abbrev_es[month]} ${year}`);
                                    set_show_datepicker(false);
                                }}
                            />
                        ) : null}
                    </div>

                    {/* Colaboradores asignados al proyecto */}
                    <CollaboratorsSelector
                        selected_ids={current_collaborators}
                        on_change={(new_ids) => {
                            handle_edit_field_change("collaborator_ids", new_ids);
                            handle_edit_field_change("assignee_id", new_ids[0] || null);
                        }}
                    />

                    {/* Prioridad & Estado */}
                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Prioridad</label>
                            <select className="bold_select_input pill_dropdown_select priority_dropdown_select" value={edit_draft.priority || "Media"} onChange={(e) => handle_edit_field_change("priority", e.target.value)}>
                                {priority_items.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Estado</label>
                            <select className="bold_select_input pill_dropdown_select status_dropdown_select" value={edit_draft.status || "Pend."} onChange={(e) => handle_edit_field_change("status", e.target.value)}>
                                {status_options.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Descripción */}
                    <div className="bold_field_group">
                        <label className="bold_field_label">Descripción</label>
                        <textarea
                            className="bold_textarea_input"
                            rows={3}
                            value={edit_draft.description || ""}
                            onChange={(e) => handle_edit_field_change("description", e.target.value)}
                            placeholder="Añade una descripción..."
                        />
                    </div>

                    {/* Subtareas */}
                    <div className="bold_field_group">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <span className="bold_field_label" style={{ margin: 0 }}>Subtareas</span>
                            <span className="subtasks_badge">{done_count} de {subtasks.length}</span>
                        </div>
                        {subtasks.map((sub) => (
                            <div key={sub.id} className="subtask_edit_row">
                                <button
                                    type="button"
                                    className={`subtask_circle_btn ${sub.completed ? "subtask_circle_done" : ""}`}
                                    onClick={() => handle_toggle_subtask(sub.id)}
                                >
                                    {sub.completed ? render_icon(check_icon, 11) : null}
                                </button>
                                <span className={`subtask_text ${sub.completed ? "subtask_text_done" : ""}`}>{sub.title}</span>
                            </div>
                        ))}
                    </div>

                    {/* Adjuntos */}
                    {edit_attachments.length > 0 ? (
                        <div className="bold_field_group">
                            <label className="bold_field_label">Archivos adjuntos</label>
                            {edit_attachments.map((att) => (
                                <div key={att.id} className="attachment_row_item">
                                    <span className="attachment_file_badge">{att.name.split(".").pop().toUpperCase()}</span>
                                    <span className="attachment_file_name">{att.name}</span>
                                    <button
                                        type="button"
                                        className="attachment_remove_btn"
                                        onClick={() => handle_remove_edit_attachment(att.id)}
                                    >
                                        {render_icon(x_icon, 14)}
                                    </button>
                                </div>
                            ))}
                            <button type="button" className="attachment_add_more_btn" onClick={handle_add_edit_attachment}>
                                {render_icon(paperclip_icon, 14)} Agregar más archivos
                            </button>
                        </div>
                    ) : (
                        <button type="button" className="attachment_dropzone" onClick={handle_add_edit_attachment}>
                            {render_icon(paperclip_icon, 18)}
                            <span>Agregar archivos adjuntos</span>
                        </button>
                    )}

                    <footer className="bold_modal_footer">
                        <button type="button" className="secondary_button" onClick={on_cancel}>Cancelar</button>
                        <button type="submit" className="primary_button">Guardar cambios</button>
                    </footer>
                </form>
            </div>
        </div>
    );
}


// "Nueva Tarea" creation modal (Image 4 of design reference).
function CreateTaskModal({ board_columns, on_cancel, on_create, status_options }) {
    const [title, set_title] = use_state("");
    const [project_id, set_project_id] = use_state(project_items[0]?.id || "");
    const [section, set_section] = use_state("todo");
    const [collaborator_ids, set_collaborator_ids] = use_state([]);
    const [due_day, set_due_day] = use_state(null);
    const [due_month, set_due_month] = use_state(8);
    const [due_year, set_due_year] = use_state(2026);
    const [priority, set_priority] = use_state("Media");
    const [status, set_status] = use_state("Pend.");
    const [description, set_description] = use_state("");
    const [subtasks, set_subtasks] = use_state([]);
    const [attachments, set_attachments] = use_state([]);
    const [show_datepicker, set_show_datepicker] = use_state(false);

    function handle_submit(e) {
        e.preventDefault();
        if (!title.trim()) return;
        const col = board_columns.find((c) => c.id === section);
        const new_task = {
            id: `task_${Date.now()}`,
            title: title.trim(),
            project_id,
            section,
            assignee_id: collaborator_ids[0] || null,
            collaborator_ids,
            due_day: due_day || null,
            due_label: due_day ? `${due_day} ${month_abbrev_es[due_month]} ${due_year}` : null,
            priority,
            status: col?.status || status,
            completed: section === "completed",
            description: description.trim(),
            subtasks: subtasks.filter((s) => s.title.trim()).map((s) => ({ ...s, completed: false })),
            attachment_name: attachments.length ? attachments[attachments.length - 1].name : null,
            tags: []
        };
        on_create(new_task);
    }

    return (
        <div className="bold_modal_backdrop" onClick={on_cancel}>
            <div className="bold_modal_window" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Nueva tarea">
                <div className="bold_modal_header">
                    <div>
                        <p className="modal_eyebrow">NUEVA TAREA</p>
                        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#111827" }}>Crear nueva tarea</h2>
                    </div>
                    <button type="button" className="modal_close_btn" onClick={on_cancel} aria-label="Cerrar modal">
                        {render_icon(x_icon, 20)}
                    </button>
                </div>

                <form className="bold_modal_body" onSubmit={handle_submit}>
                    <div className="bold_field_group">
                        <label className="bold_field_label">Nombre de la tarea *</label>
                        <input
                            className="bold_text_input"
                            type="text"
                            value={title}
                            onChange={(e) => set_title(e.target.value)}
                            placeholder="¿Qué hay que hacer?"
                            autoFocus
                            required
                        />
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Proyecto</label>
                            <select className="bold_select_input" value={project_id} onChange={(e) => set_project_id(e.target.value)}>
                                {project_items.map((p) => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Sección</label>
                            <select className="bold_select_input" value={section} onChange={(e) => set_section(e.target.value)}>
                                {board_columns.map((col) => (
                                    <option key={col.id} value={col.id}>{col.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="bold_field_group" style={{ position: "relative" }}>
                        <label className="bold_field_label">Fecha límite</label>
                        <button type="button" className="bold_date_trigger_btn" onClick={() => set_show_datepicker((v) => !v)}>
                            {render_icon(calendar_days_icon, 15)}
                            {due_day ? `${due_day} ${month_abbrev_es[due_month]} ${due_year}` : "Seleccionar fecha"}
                        </button>
                        {show_datepicker ? (
                            <CustomDatePicker
                                current_day={due_day}
                                on_clear={() => { set_due_day(null); set_show_datepicker(false); }}
                                on_apply={(day, month, year) => {
                                    set_due_day(day);
                                    set_due_month(month);
                                    set_due_year(year);
                                    set_show_datepicker(false);
                                }}
                            />
                        ) : null}
                    </div>

                    {/* Botón y selector de colaboradores del proyecto */}
                    <CollaboratorsSelector
                        selected_ids={collaborator_ids}
                        on_change={set_collaborator_ids}
                    />

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Prioridad</label>
                            <select className="bold_select_input pill_dropdown_select priority_dropdown_select" value={priority} onChange={(e) => set_priority(e.target.value)}>
                                {priority_items.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Estado</label>
                            <select className="bold_select_input pill_dropdown_select status_dropdown_select" value={status} onChange={(e) => set_status(e.target.value)}>
                                {status_options.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="bold_field_group">
                        <label className="bold_field_label">Descripción</label>
                        <textarea
                            className="bold_textarea_input"
                            rows={3}
                            value={description}
                            onChange={(e) => set_description(e.target.value)}
                            placeholder="Añade una descripción..."
                        />
                    </div>

                    {/* Subtareas */}
                    {subtasks.length > 0 ? (
                        <div className="bold_field_group">
                            <label className="bold_field_label">Subtareas</label>
                            {subtasks.map((sub) => (
                                <div key={sub.id} className="subtask_edit_row">
                                    <input
                                        className="bold_text_input"
                                        type="text"
                                        value={sub.title}
                                        onChange={(e) => set_subtasks((ss) => ss.map((s) => s.id === sub.id ? { ...s, title: e.target.value } : s))}
                                        placeholder="Nombre de la subtarea"
                                    />
                                    <button
                                        type="button"
                                        className="attachment_remove_btn"
                                        onClick={() => set_subtasks((ss) => ss.filter((s) => s.id !== sub.id))}
                                    >
                                        {render_icon(trash_icon, 14)}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="add_subtask_link_btn"
                        onClick={() => set_subtasks((ss) => [...ss, { id: `ns_${Date.now()}`, title: "" }])}
                    >
                        {render_icon(plus_icon, 14)} Agregar subtarea
                    </button>

                    {/* Adjuntos */}
                    <button
                        type="button"
                        className="attachment_dropzone"
                        onClick={() => set_attachments((aa) => [...aa, { id: `f_${Date.now()}`, name: `archivo_${aa.length + 1}.pdf` }])}
                    >
                        {render_icon(paperclip_icon, 18)}
                        <span>{attachments.length > 0 ? `${attachments.length} archivo(s) adjunto(s)` : "Agregar archivos adjuntos"}</span>
                    </button>

                    <footer className="bold_modal_footer">
                        <button type="button" className="secondary_button" onClick={on_cancel}>Cancelar</button>
                        <button type="submit" className="primary_button" disabled={!title.trim()}>Crear tarea</button>
                    </footer>
                </form>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────


// Renders the task project header and active project view.
function render_tasks_module(props) {
    const {
        active_filters,
        active_quick_popover,
        active_section = "tasks",
        active_task_tool,
        active_view,
        board_columns = default_board_columns,
        collapsed_sections,
        dragged_task_id,
        editing_column_id,
        editing_column_name,
        filtered_tasks,
        handle_add_column,
        handle_add_comment,
        handle_clear_filters,
        handle_close_task_tool,
        handle_column_drop,
        handle_delete_task,
        handle_delete_column,
        handle_drag_start,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_filter_value,
        handle_toggle_quick_popover,
        handle_toggle_section,
        handle_toggle_subtask,
        handle_toggle_task,
        handle_toggle_task_tool,
        handle_toggle_visible_field,
        handle_save_column_name,
        handle_start_edit_column,
        is_adding_column,
        new_column_name,
        search_query,
        selected_task,
        selected_task_id,
        set_active_modal,
        set_active_section,
        set_active_view,
        set_editing_column_id,
        set_is_adding_column,
        set_editing_column_name,
        set_new_column_name,
        set_search_query,
        set_sort_direction,
        set_sort_field,
        sort_direction,
        sort_field,
        status_options,
        tasks,
        visible_fields
    } = props;

    const completed_count = tasks.filter((task_item) => task_item.completed).length;
    const completion_percent = tasks.length ? Math.round((completed_count / tasks.length) * 100) : 0;

    return (
        <section className="tasks_module">
            <div className="task_project_header">
                <div className="project_title_group">
                    <p className="breadcrumb_text">
                        TAREAS / BOLD WORKSPACE
                        <span className="desktop_breadcrumb_tail"> / PROYECTOS / MARKETING</span>
                    </p>
                    <h1>Lanzamiento Q4</h1>
                    <p className="project_subtitle">Campaña y entregables del último trimestre</p>
                    <button className="mobile_workspace_selector" type="button">
                        <span className="workspace_badge">B</span>
                        <span>BOLD Workspace</span>
                        {render_icon(chevron_down_icon, 14)}
                    </button>
                </div>

                <div className="project_actions">
                    <div className="avatar_stack" aria-label="Miembros del proyecto">
                        {team_members.slice(0, 3).map((member_item) => (
                            <span
                                className="avatar_medium"
                                key={member_item.id}
                                style={{ "--avatar_color": member_item.color }}
                            >
                                {member_item.initials}
                            </span>
                        ))}
                        <span className="avatar_more">+2</span>
                    </div>
                    <button className="secondary_button" type="button" onClick={() => set_active_modal("share")}>
                        Compartir
                    </button>
                    <button className="primary_button" type="button" onClick={() => set_active_modal("task")}>
                        {render_icon(plus_icon, 17)}
                        Agregar tarea
                    </button>
                    <button className="icon_button" type="button" aria-label="Más opciones" onClick={() => set_active_modal("project_menu")}>
                        {render_icon(more_horizontal_icon, 22)}
                    </button>
                </div>
            </div>

            <div className="task_tabs_row">
                {/* 1 & 2. Navegación principal: Tareas | Cronograma | Calendario */}
                <nav className="main_section_nav_tabs" role="tablist" aria-label="Navegación principal">
                    <button
                        className={`main_nav_tab_btn ${active_section === "tasks" ? "main_nav_tab_active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={active_section === "tasks"}
                        onClick={() => set_active_section("tasks")}
                    >
                        Tareas
                    </button>
                    <button
                        className={`main_nav_tab_btn ${active_section === "timeline" ? "main_nav_tab_active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={active_section === "timeline"}
                        onClick={() => set_active_section("timeline")}
                    >
                        Cronograma
                    </button>
                    <button
                        className={`main_nav_tab_btn ${active_section === "calendar" ? "main_nav_tab_active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={active_section === "calendar"}
                        onClick={() => set_active_section("calendar")}
                    >
                        Calendario
                    </button>
                </nav>

                {/* 3 & 4 & 5. Dentro del apartado Tareas: Acciones de tareas — Personalizar — Botón de visualización */}
                {active_section === "tasks" ? (
                    <div className="task_tools">
                        <div className="task_tool_anchor">
                            <button
                                className={`text_tool_button ${active_task_tool === "sort" ? "text_tool_button_active" : ""}`}
                                type="button"
                                onClick={() => handle_toggle_task_tool("sort")}
                            >
                                Ordenar
                            </button>
                            {active_task_tool === "sort" ? render_sort_panel({
                                handle_close_task_tool,
                                set_sort_direction,
                                set_sort_field,
                                sort_direction,
                                sort_field
                            }) : null}
                        </div>
                        <div className="task_tool_anchor">
                            <button
                                className={`text_tool_button ${active_task_tool === "filter" ? "text_tool_button_active" : ""}`}
                                type="button"
                                onClick={() => handle_toggle_task_tool("filter")}
                            >
                                Filtrar
                            </button>
                            {active_task_tool === "filter" ? render_filter_panel({
                                active_filters,
                                handle_clear_filters,
                                handle_close_task_tool,
                                handle_toggle_filter_value
                            }) : null}
                        </div>
                        <div className="task_tool_anchor">
                            <button
                                className={`text_tool_button ${active_task_tool === "customize" ? "text_tool_button_active" : ""}`}
                                type="button"
                                onClick={() => handle_toggle_task_tool("customize")}
                            >
                                Personalizar
                            </button>
                            {active_task_tool === "customize" ? render_customize_panel({
                                handle_close_task_tool,
                                handle_toggle_visible_field,
                                visible_fields
                            }) : null}
                        </div>

                        {/* Botón de visualización Lista ↔ Columnas al lado derecho de Personalizar */}
                        {render_view_switch(active_view, set_active_view)}
                    </div>
                ) : null}

                {active_section === "tasks" ? (
                    <button className="mobile_filter_button" type="button" onClick={() => set_search_query(search_query ? "" : "zzz")}>
                        {render_icon(sliders_icon, 15)}
                        Filtrar
                    </button>
                ) : null}
                <button className="mobile_floating_add" type="button" aria-label="Agregar tarea" onClick={() => set_active_modal("task")}>
                    {render_icon(plus_icon, 28)}
                </button>
            </div>

            {/* Vista según el apartado activo */}
            {active_section === "tasks" ? (
                <div className={`tasks_workspace_split ${selected_task ? "has_detail" : ""}`}>
                    <div className="tasks_main_area">
                        {active_view === "list" ? render_list_view({
                            active_quick_popover,
                            board_columns,
                            collapsed_sections,
                            completed_count,
                            completion_percent,
                            editing_column_id,
                            editing_column_name,
                            filtered_tasks,
                            handle_add_column,
                            handle_delete_column,
                            handle_delete_task,
                            handle_open_edit_task,
                            handle_quick_change,
                            handle_save_column_name,
                            handle_start_edit_column,
                            handle_task_select,
                            handle_toggle_quick_popover,
                            handle_toggle_section,
                            handle_toggle_task,
                            is_adding_column,
                            new_column_name,
                            selected_task_id,
                            set_editing_column_id,
                            set_editing_column_name,
                            set_is_adding_column,
                            set_active_modal,
                            set_new_column_name,
                            status_options,
                            tasks,
                            visible_fields
                        }) : null}

                        {active_view === "board" ? render_board_view({
                            active_quick_popover,
                            board_columns,
                            dragged_task_id,
                            editing_column_id,
                            editing_column_name,
                            filtered_tasks,
                            handle_add_column,
                            handle_column_drop,
                            handle_delete_column,
                            handle_drag_start,
                            handle_save_column_name,
                            handle_start_edit_column,
                            handle_open_edit_task,
                            handle_quick_change,
                            handle_task_select,
                            handle_toggle_quick_popover,
                            handle_toggle_task,
                            is_adding_column,
                            new_column_name,
                            selected_task_id,
                            set_editing_column_id,
                            set_is_adding_column,
                            set_editing_column_name,
                            set_new_column_name
                        }) : null}
                    </div>

                    {selected_task ? (
                        <div className="task_detail_sidebar">
                            <TaskDetailPanel
                                handle_add_comment={handle_add_comment}
                                handle_delete_task={handle_delete_task}
                                handle_open_edit_task={handle_open_edit_task}
                                handle_toggle_subtask={handle_toggle_subtask}
                                handle_toggle_task={handle_toggle_task}
                                on_close={() => handle_task_select(null)}
                                selected_task={selected_task}
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}

            {active_section === "timeline" ? (
                <div className="timeline_view_wrapper">
                    {render_timeline_view(filtered_tasks, handle_task_select)}
                </div>
            ) : null}

            {active_section === "calendar" ? (
                <div className="calendar_view_wrapper">
                    {render_calendar_view({
                        filtered_tasks,
                        handle_task_select,
                        set_active_modal
                    })}
                </div>
            ) : null}
        </section>
    );
}


// Renders the progress strip used by desktop and mobile task lists.
function render_progress_card(tasks, completed_count, completion_percent) {
    return (
        <div className="progress_card">
            <div>
                <span>PROGRESO</span>
                <strong>{completed_count} de {tasks.length} tareas completadas</strong>
            </div>
            <div className="progress_meter_group">
                <span className="progress_meter">
                    <span style={{ width: `${completion_percent}%` }}></span>
                </span>
                <strong>{completion_percent}%</strong>
            </div>
        </div>
    );
}


// Renders the list view for the active project.
function render_list_view(props) {
    const {
        active_quick_popover,
        board_columns = default_board_columns,
        collapsed_sections = [],
        completed_count,
        completion_percent,
        editing_column_id,
        editing_column_name,
        filtered_tasks,
        handle_add_column,
        handle_delete_column,
        handle_delete_task,
        handle_open_edit_task,
        handle_quick_change,
        handle_save_column_name,
        handle_start_edit_column,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_section,
        handle_toggle_task,
        is_adding_column,
        new_column_name,
        selected_task_id,
        set_editing_column_id,
        set_editing_column_name,
        set_is_adding_column,
        set_active_modal,
        set_new_column_name,
        status_options,
        tasks,
        visible_fields
    } = props;
    const field_items = optional_column_items;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="list_view">
            <div className="mobile_only">
                {render_progress_card(tasks, completed_count, completion_percent)}
            </div>

            <div className="task_table_card desktop_only">
                <div className="task_table_header" style={get_task_table_columns_style(visible_fields, false, field_items)}>
                    <span>TAREA</span>
                    <span aria-hidden="true"></span>
                    {field_items
                        .filter((column_item) => visible_fields[column_item.key])
                        .map((column_item) => <span key={column_item.key}>{column_item.label}</span>)}
                </div>

                {board_columns.map((section_item) => render_task_group({
                    active_quick_popover,
                    collapsed_sections,
                    column_items: field_items,
                    editing_column_id,
                    editing_column_name,
                    filtered_tasks,
                    handle_delete_column,
                    handle_delete_task,
                    handle_open_edit_task,
                    handle_quick_change,
                    handle_save_column_name,
                    handle_start_edit_column,
                    handle_task_select,
                    handle_toggle_quick_popover,
                    handle_toggle_section,
                    handle_toggle_task,
                    section_item,
                    selected_task_id,
                    set_editing_column_id,
                    set_editing_column_name,
                    status_options,
                    visible_fields
                }))}

                <button className="add_row_button" type="button" onClick={() => set_active_modal("task")}>
                    + Agregar tarea
                </button>
                <div className="list_section_creator">
                    {is_adding_column ? (
                        <div className="board_column_form">
                            <input
                                autoFocus
                                className="board_column_name_input"
                                placeholder="Nombre de sección..."
                                type="text"
                                value={new_column_name}
                                onChange={(event) => set_new_column_name(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") handle_add_column();
                                    if (event.key === "Escape") set_is_adding_column(false);
                                }}
                            />
                            <div>
                                <button type="button" onClick={() => set_is_adding_column(false)}>
                                    Cancelar
                                </button>
                                <button type="button" onClick={handle_add_column}>
                                    Crear
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button className="add_row_button" type="button" onClick={() => set_is_adding_column(true)}>
                            + Nueva sección
                        </button>
                    )}
                </div>

                <div className="table_footer">
                    <div>
                        <strong>{tasks.length} tareas</strong>
                        <span>{completed_count} completadas</span>
                    </div>
                    <span className="footer_progress">
                        <span style={{ width: `${completion_percent}%` }}></span>
                    </span>
                    <strong>{completion_percent}%</strong>
                </div>
            </div>

            <div className="mobile_task_stack mobile_only">
                {board_columns.map((section_item) => render_mobile_section({
                    collapsed_sections,
                    filtered_tasks,
                    handle_task_select,
                    handle_toggle_section,
                    handle_toggle_task,
                    section_item
                }))}
            </div>
        </div>
    );
}


// Renders one grouped task section in the desktop table.
function render_task_group(props) {
    const {
        active_quick_popover,
        collapsed_sections = [],
        column_items = optional_column_items,
        editing_column_id,
        editing_column_name,
        filtered_tasks,
        handle_delete_column,
        handle_delete_task,
        handle_open_edit_task,
        handle_quick_change,
        handle_save_column_name,
        handle_start_edit_column,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_section,
        handle_toggle_task,
        section_item,
        selected_task_id,
        set_editing_column_id,
        set_editing_column_name,
        status_options = default_status_items,
        visible_fields
    } = props;
    const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);
    const is_collapsed = collapsed_sections.includes(section_item.id);

    return (
        <div className="task_group" key={section_item.id}>
            <div className="task_group_header" role="button" tabIndex={0} onClick={() => handle_toggle_section(section_item.id)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") handle_toggle_section(section_item.id);
            }}>
                <span className={`section_chevron ${is_collapsed ? "section_chevron_collapsed" : ""}`}>
                    {render_icon(chevron_down_icon, 14)}
                </span>
                {editing_column_id === section_item.id ? (
                    <input
                        autoFocus
                        className="board_column_title_input list_section_title_input"
                        value={editing_column_name}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => set_editing_column_name(event.target.value)}
                        onBlur={handle_save_column_name}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") handle_save_column_name();
                            if (event.key === "Escape") {
                                set_editing_column_id(null);
                                set_editing_column_name("");
                            }
                        }}
                    />
                ) : (
                    <strong>{section_item.label.toUpperCase()}</strong>
                )}
                <span>{section_tasks.length}</span>
                {section_item.id.startsWith("col_") ? (
                    <div className="board_section_actions list_section_actions" onClick={(event) => event.stopPropagation()}>
                        <button type="button" title="Renombrar sección" onClick={() => handle_start_edit_column(section_item)}>
                            {render_icon(pencil_icon, 13)}
                        </button>
                        <button type="button" title="Eliminar sección" onClick={() => handle_delete_column(section_item.id)}>
                            {render_icon(trash_icon, 13)}
                        </button>
                    </div>
                ) : null}
            </div>
            {is_collapsed ? null : section_tasks.map((task_item) => render_task_row({
                active_quick_popover,
                column_items,
                handle_delete_task,
                handle_open_edit_task,
                handle_quick_change,
                handle_task_select,
                handle_toggle_quick_popover,
                handle_toggle_task,
                is_selected: selected_task_id === task_item.id,
                status_options,
                task_item,
                visible_fields
            }))}
        </div>
    );
}


// Renders one task row in desktop list view.
function render_task_row(props) {
    const {
        active_quick_popover,
        column_items = optional_column_items,
        handle_delete_task,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_task,
        is_selected,
        status_options = default_status_items,
        task_item,
        visible_fields
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id);

    const is_priority_open = active_quick_popover?.taskId === task_item.id && active_quick_popover?.type === "priority";
    const is_status_open = active_quick_popover?.taskId === task_item.id && active_quick_popover?.type === "status";

    return (
        <div
            className={`task_row ${task_item.completed ? "task_row_completed" : ""} ${is_selected ? "task_row_selected" : ""}`}
            key={task_item.id}
            style={{
                ...get_task_table_columns_style(visible_fields, true, column_items),
                cursor: "pointer",
                zIndex: is_priority_open || is_status_open ? 50 : 1
            }}
            onClick={() => handle_task_select(task_item.id)}
        >
            <button
                className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                type="button"
                aria-label="Completar tarea"
                onClick={(e) => {
                    e.stopPropagation();
                    handle_toggle_task(task_item.id);
                }}
            >
                {task_item.completed ? render_icon(check_icon, 13) : null}
            </button>

            <div
                className="task_name_cell"
                style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}
            >
                <button
                    className="task_name_button"
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handle_task_select(task_item.id);
                    }}
                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                >
                    <span className="task_name_button_inner">{task_item.title}</span>
                    {render_days_badge(task_item)}
                </button>
            </div>

            <div className="task_quick_actions" aria-label="Acciones de tarea">
                <button
                    type="button"
                    className="task_edit_pencil_btn"
                    title="Editar tarea"
                    aria-label={`Editar ${task_item.title}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        handle_open_edit_task(task_item.id);
                    }}
                >
                    {render_icon(pencil_icon, 15)}
                </button>
                <button
                    type="button"
                    className="task_edit_pencil_btn task_delete_quick_btn"
                    title="Eliminar tarea"
                    aria-label={`Eliminar ${task_item.title}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        handle_delete_task(task_item.id);
                    }}
                >
                    {render_icon(trash_icon, 15)}
                </button>
            </div>

            {visible_fields.assignee ? (
                <span className="task_assignee">
                    {render_avatar(member_item, "avatar_small")}
                </span>
            ) : null}

            {visible_fields.date ? (
                <span className="task_date">{task_item.due_label || "Sin fecha"}</span>
            ) : null}

            {visible_fields.priority ? (
                <div className="quick_popover_container">
                    <button
                        type="button"
                        className={`priority_pill_badge priority_pill_${get_priority_class(task_item.priority).replace("priority_", "")}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            handle_toggle_quick_popover(task_item.id, "priority");
                        }}
                    >
                        {(task_item.priority || "Alta").toUpperCase()}
                        {render_icon(chevron_down_icon, 11)}
                    </button>
                    {is_priority_open ? (
                        <QuickPriorityPopover
                            current_priority={task_item.priority}
                            on_close={() => handle_toggle_quick_popover(null, null)}
                            on_select={(val) => handle_quick_change(task_item.id, "priority", val)}
                        />
                    ) : null}
                </div>
            ) : null}

            {visible_fields.status ? (
                <div className="quick_popover_container">
                    <button
                        type="button"
                        className={`status_pill_badge status_pill_${get_status_class(task_item.status).replace("status_", "")}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            handle_toggle_quick_popover(task_item.id, "status");
                        }}
                    >
                        {(task_item.status || "Pend.").toUpperCase()}
                        {render_icon(chevron_down_icon, 11)}
                    </button>
                    {is_status_open ? (
                        <QuickStatusPopover
                            current_status={task_item.status}
                            on_close={() => handle_toggle_quick_popover(null, null)}
                            on_select={(val) => handle_quick_change(task_item.id, "status", val)}
                            status_options={status_options}
                        />
                    ) : null}
                </div>
            ) : null}

            {visible_fields.project ? (
                <span className="task_project_cell">
                    {render_project_dot(project_item.color)}
                    {project_item.label}
                </span>
            ) : null}

        </div>
    );
}


// Renders one task section in the mobile list.
function render_mobile_section(props) {
    const {
        collapsed_sections = [],
        filtered_tasks,
        handle_task_select,
        handle_toggle_section,
        handle_toggle_task,
        section_item
    } = props;
    const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);
    const is_collapsed = collapsed_sections.includes(section_item.id);

    if (!section_tasks.length) {
        return null;
    }

    return (
        <div className="mobile_task_section" key={section_item.id}>
            <button className="mobile_section_header" type="button" onClick={() => handle_toggle_section(section_item.id)}>
                <span className={`section_chevron ${is_collapsed ? "section_chevron_collapsed" : ""}`}>
                    {render_icon(chevron_down_icon, 14)}
                </span>
                {section_item.label}
                <span>{section_tasks.length}</span>
            </button>
            {is_collapsed ? null : section_tasks.map((task_item) => render_task_card({
                handle_task_select,
                handle_toggle_task,
                task_item
            }))}
        </div>
    );
}


// Renders a mobile card for a task.
function render_task_card(props) {
    const {
        handle_task_select,
        handle_toggle_task,
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id);

    return (
        <article
            className={`task_card ${task_item.priority === "Alta" && !task_item.completed ? "task_card_alert" : ""}`}
            key={task_item.id}
            onClick={() => handle_task_select(task_item.id)}
            style={{ cursor: "pointer" }}
        >
            <button
                className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                type="button"
                aria-label="Completar tarea"
                onClick={(e) => {
                    e.stopPropagation();
                    handle_toggle_task(task_item.id);
                }}
            >
                {task_item.completed ? render_icon(check_icon, 13) : null}
            </button>
            <button
                className="task_card_content"
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    handle_task_select(task_item.id);
                }}
                style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
            >
                <span className="task_card_title">
                    <span className="task_card_title_text">{task_item.title}</span>
                    {render_days_badge(task_item)}
                </span>
                <span className="mobile_badge_row">
                    <span className={`task_badge status_badge ${get_status_class(task_item.status)}`}>
                        {task_item.status}
                    </span>
                    {task_item.priority === "Alta" ? (
                        <span className="alert_meta">
                            {render_project_dot(project_item.color)}
                            Vence hoy - Prioridad alta
                        </span>
                    ) : (
                        <span className="muted_meta">{task_item.due_label} - Prioridad {task_item.priority.toLowerCase()}</span>
                    )}
                </span>
            </button>
            {render_avatar(member_item, "avatar_medium")}
        </article>
    );
}


// Renders the board view for project workflow columns.
function render_board_view(props) {
    const {
        board_columns = default_board_columns,
        dragged_task_id,
        editing_column_id,
        editing_column_name,
        filtered_tasks,
        handle_add_column,
        handle_column_drop,
        handle_delete_column,
        handle_drag_start,
        handle_save_column_name,
        handle_start_edit_column,
        handle_task_select,
        handle_toggle_task,
        is_adding_column,
        new_column_name,
        set_editing_column_id,
        set_editing_column_name,
        set_is_adding_column,
        set_new_column_name
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    const columns_to_render = board_columns && board_columns.length ? board_columns : default_board_columns;

    return (
        <div className="board_view">
            {columns_to_render.map((section_item) => {
                const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);

                return (
                    <section
                        className="board_column"
                        key={section_item.id}
                        onDragOver={handle_column_drop ? (event) => event.preventDefault() : undefined}
                        onDrop={handle_column_drop ? () => handle_column_drop(section_item.id) : undefined}
                    >
                        <header>
                            {editing_column_id === section_item.id ? (
                                <input
                                    autoFocus
                                    className="board_column_title_input"
                                    value={editing_column_name}
                                    onChange={(event) => set_editing_column_name(event.target.value)}
                                    onBlur={handle_save_column_name}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") handle_save_column_name();
                                        if (event.key === "Escape") {
                                            set_editing_column_id(null);
                                            set_editing_column_name("");
                                        }
                                    }}
                                />
                            ) : (
                                <h2>{section_item.label}</h2>
                            )}
                            <span>{section_tasks.length}</span>
                            {section_item.id.startsWith("col_") ? (
                                <div className="board_section_actions" onClick={(event) => event.stopPropagation()}>
                                    <button type="button" title="Renombrar sección" onClick={() => handle_start_edit_column(section_item)}>
                                        {render_icon(pencil_icon, 13)}
                                    </button>
                                    <button type="button" title="Eliminar sección" onClick={() => handle_delete_column(section_item.id)}>
                                        {render_icon(trash_icon, 13)}
                                    </button>
                                </div>
                            ) : null}
                        </header>
                        <div className="board_card_stack">
                            {section_tasks.map((task_item) => render_board_card({
                                handle_drag_start,
                                handle_task_select,
                                handle_toggle_task,
                                is_dragging: dragged_task_id === task_item.id,
                                task_item
                            }))}
                        </div>
                    </section>
                );
            })}

            {handle_add_column ? (
                <div className="board_column_new">
                    {is_adding_column ? (
                        <div className="board_column_form">
                            <input
                                autoFocus
                                className="board_column_name_input"
                                placeholder="Nombre de sección..."
                                type="text"
                                value={new_column_name}
                                onChange={(event) => set_new_column_name(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") handle_add_column();
                                    if (event.key === "Escape") set_is_adding_column(false);
                                }}
                            />
                            <div>
                                <button type="button" onClick={() => set_is_adding_column(false)}>
                                    Cancelar
                                </button>
                                <button type="button" onClick={handle_add_column}>
                                    Crear
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            className="board_add_column_button"
                            type="button"
                            onClick={() => set_is_adding_column(true)}
                        >
                            {render_icon(plus_icon, 16)}
                            Nueva sección
                        </button>
                    )}
                </div>
            ) : null}
        </div>
    );
}


// Renders a task card inside the board view.
function render_board_card(props) {
    const {
        handle_drag_start,
        handle_task_select,
        handle_toggle_task,
        is_dragging,
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id);

    return (
        <article
            className="board_card"
            data-dragging={is_dragging ? "true" : "false"}
            key={task_item.id}
            draggable={Boolean(handle_drag_start)}
            onDragStart={handle_drag_start ? () => handle_drag_start(task_item.id) : undefined}
            onClick={() => handle_task_select(task_item.id)}
            style={{ cursor: "pointer" }}
        >
            <div className="board_card_topline">
                {render_project_dot(project_item.color)}
                <span>{project_item.label}</span>
                <button
                    className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                    type="button"
                    aria-label="Completar tarea"
                    onClick={(e) => {
                        e.stopPropagation();
                        handle_toggle_task(task_item.id);
                    }}
                >
                    {task_item.completed ? render_icon(check_icon, 13) : null}
                </button>
            </div>
            <button
                className="board_title_button"
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    handle_task_select(task_item.id);
                }}
                style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
            >
                <span className="board_title_text">{task_item.title}</span>
                {render_days_badge(task_item)}
            </button>
            <p>{task_item.description || "Sin descripción adicional."}</p>
            <footer>
                {render_avatar(member_item, "avatar_small")}
                <span>{task_item.due_label}</span>
                <span className={`task_badge priority_badge ${get_priority_class(task_item.priority)}`}>
                    {task_item.priority}
                </span>
            </footer>
        </article>
    );
}


// Renders the timeline/Gantt view for the Cronograma apartado.
function render_timeline_view(filtered_tasks, handle_task_select) {
    const days = Array.from({ length: 30 }, (_, i) => i + 1);

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="timeline_view_card">
            <div className="timeline_header">
                <div className="timeline_col_label">TAREA</div>
                <div className="timeline_days_track_header">
                    {days.map((d) => (
                        <div key={d} className={`timeline_day_header_cell ${d === today_day_of_month ? "timeline_day_today" : ""}`}>
                            <span className="timeline_day_num">{d}</span>
                            <span className="timeline_day_sub">sep</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="timeline_body">
                {filtered_tasks.map((task_item) => {
                    const member_item = get_member(task_item.assignee_id);
                    const due = task_item.due_day || 15;
                    const duration = Math.min(due, 4);
                    const start_day = Math.max(1, due - duration + 1);
                    const left_pct = ((start_day - 1) / 30) * 100;
                    const width_pct = Math.max(8, (duration / 30) * 100);

                    return (
                        <div className="timeline_row" key={task_item.id}>
                            <div className="timeline_row_title_col">
                                <button
                                    type="button"
                                    className="timeline_task_link"
                                    onClick={() => handle_task_select(task_item.id)}
                                >
                                    {task_item.title}
                                    {render_days_badge(task_item)}
                                </button>
                            </div>
                            <div className="timeline_row_track">
                                <div
                                    className={`timeline_bar ${get_priority_class(task_item.priority)}`}
                                    style={{ left: `${left_pct}%`, width: `${width_pct}%` }}
                                    onClick={() => handle_task_select(task_item.id)}
                                    title={`${task_item.title} (${task_item.due_label || `${due} sep`})`}
                                >
                                    <span className="timeline_bar_text">{task_item.title}</span>
                                    {member_item ? render_avatar(member_item, "avatar_tiny") : null}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


// Renders the static calendar view with tasks placed on due dates.
function render_calendar_view(props) {
    const {
        filtered_tasks,
        handle_task_select,
        set_active_modal
    } = props;
    const weekday_items = [
        "Lun",
        "Mar",
        "Mie",
        "Jue",
        "Vie",
        "Sab",
        "Dom"
    ];
    // September 2026 is what the whole mock dataset (due_day/due_label) is
    // anchored to; the leading blank cells align day 1 under its real
    // weekday instead of always starting on Monday.
    const leading_blank_count = (new Date(2026, 8, 1).getDay() + 6) % 7;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="calendar_view">
            <div className="calendar_header">
                <div className="calendar_title_group">
                    <button className="icon_button" type="button" aria-label="Mes anterior">
                        {render_icon(chevron_left_icon, 18)}
                    </button>
                    <div>
                        <p className="eyebrow_text">CALENDARIO</p>
                        <h2>Septiembre 2026</h2>
                    </div>
                    <button className="icon_button" type="button" aria-label="Mes siguiente">
                        {render_icon(chevron_right_icon, 18)}
                    </button>
                </div>
                <div className="calendar_header_actions">
                    <button className="outline_button" type="button">Hoy</button>
                    <button className="primary_button" type="button" onClick={() => set_active_modal("task")}>
                        {render_icon(plus_icon, 16)}
                        Agregar tarea
                    </button>
                </div>
            </div>
            <div className="calendar_grid">
                {weekday_items.map((weekday_item) => (
                    <span className="weekday_cell" key={weekday_item}>{weekday_item}</span>
                ))}
                {Array.from({ length: leading_blank_count }, (_item, index) => (
                    <div className="calendar_day calendar_day_blank" key={`blank_${index}`}></div>
                ))}
                {calendar_days.map((day_item) => {
                    const day_tasks = filtered_tasks.filter((task_item) => task_item.due_day === day_item);
                    const is_today = day_item === today_day_of_month;

                    return (
                        <div className={`calendar_day ${is_today ? "calendar_day_today" : ""}`} key={day_item}>
                            <div className="calendar_day_head">
                                <strong>{day_item}</strong>
                                {is_today ? <span className="calendar_today_label">Hoy</span> : null}
                            </div>
                            {day_tasks.slice(0, 2).map((task_item) => (
                                <button
                                    className={`calendar_task ${get_priority_class(task_item.priority)}`}
                                    key={task_item.id}
                                    type="button"
                                    onClick={() => handle_task_select(task_item.id)}
                                >
                                    {task_item.title}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


// Renders the empty task state shown when active filters remove all items.
function render_empty_tasks_state() {
    return (
        <div className="empty_tasks_state">
            <div className="empty_search_icon">
                {render_icon(search_icon, 96)}
            </div>
            <h2>No encontramos tareas</h2>
            <p>Prueba cambiando o eliminando los filtros activos.</p>
            <button className="primary_button" type="button">
                Limpiar filtros
            </button>
        </div>
    );
}


// Renders the sharing modal based on the desktop reference asset.
function render_share_modal(set_active_modal) {
    return (
        <div className="modal_overlay">
            <section className="form_modal share_modal" role="dialog" aria-modal="true" aria-label="Compartir proyecto">
                <header className="modal_header">
                    <h2>Compartir "Lanzamiento Q4"</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="share_content">
                    <label className="form_field">
                        <span>Invitar personas</span>
                        <div className="invite_row">
                            <input type="text" placeholder="Nombre o correo electronico" />
                            <button className="primary_button" type="button">Enviar invitacion</button>
                        </div>
                    </label>
                    <p className="sidebar_label">PERSONAS CON ACCESO</p>
                    {team_members.slice(0, 2).map((member_item) => (
                        <div className="access_row" key={member_item.id}>
                            {render_avatar(member_item, "avatar_medium")}
                            <div>
                                <strong>{member_item.name}</strong>
                                <span>{member_item.email}</span>
                            </div>
                            <button className="outline_button" type="button">Puede editar</button>
                        </div>
                    ))}
                    <div className="link_access_card">
                        <span>{render_icon(user_plus_icon, 18)}</span>
                        <div>
                            <strong>Cualquiera en BOLD Workspace</strong>
                            <p>Puede ver este proyecto con el enlace</p>
                        </div>
                        {render_icon(chevron_down_icon, 16)}
                    </div>
                    <div className="copy_link_row">
                        <input type="text" value="bold.gt/proyectos/lanzamiento-q4" readOnly />
                        <button className="dark_button" type="button">
                            {render_icon(link_icon, 16)}
                            Copiar enlace
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}


function DeleteConfirmModal({ item_label, item_meta, item_type, on_cancel, on_confirm }) {
    return (
        <div className="delete_confirm_overlay" onClick={on_cancel}>
            <section className="delete_confirm_modal" role="dialog" aria-modal="true" aria-label={`Eliminar ${item_type}`} onClick={(event) => event.stopPropagation()}>
                <div className="delete_confirm_header">
                    <span className="delete_confirm_icon">!</span>
                    <div>
                        <h2>Eliminar {item_type}</h2>
                        <p>Esta accion eliminara {item_type === "tarea" ? "la tarea seleccionada" : "el proyecto seleccionado"} y no se podra deshacer desde esta vista.</p>
                    </div>
                </div>
                <div className="delete_confirm_target">
                    <strong>Se eliminara: {item_label}</strong>
                    <span>{item_meta}</span>
                </div>
                <footer className="delete_confirm_actions">
                    <button type="button" onClick={on_cancel}>Cancelar</button>
                    <button type="button" onClick={on_confirm}>Eliminar</button>
                </footer>
            </section>
        </div>
    );
}


// Renders the create project modal shown from the sidebar add button.
function render_project_modal(props) {
    const {
        handle_create_project,
        project_color,
        project_people_ids,
        project_people_query,
        set_active_modal,
        set_project_color,
        set_project_people_query,
        toggle_project_person
    } = props;
    const visible_people = team_members.filter((member_item) => (
        !project_people_query.trim()
        || `${member_item.name} ${member_item.email}`.toLowerCase().includes(project_people_query.trim().toLowerCase())
    ));

    return (
        <div className="project_create_overlay">
            <section className="project_create_modal" role="dialog" aria-modal="true" aria-label="Crear proyecto">
                <header className="project_create_header">
                    <h2>
                        {render_icon(folder_icon, 34)}
                        Crear nuevo proyecto
                    </h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 30)}
                    </button>
                </header>

                <form className="project_create_body" onSubmit={handle_create_project}>
                    <label className="project_create_step">
                        <span><strong>1</strong> Nombre del proyecto</span>
                        <input name="project_name" type="text" placeholder="Ej. Campana de lanzamiento Q4" required />
                    </label>

                    <label className="project_create_step">
                        <span><strong>2</strong> Descripcion</span>
                        <textarea name="project_description" rows="4" placeholder="Describe brevemente el objetivo y alcance del proyecto..."></textarea>
                    </label>

                    <section className="project_create_step">
                        <span><strong>3</strong> Color del proyecto</span>
                        <p>Elige un color para identificar tu proyecto en todo el espacio de trabajo.</p>
                        <div className="project_color_options">
                            {project_color_options.map((color_item) => (
                                <button
                                    className={`project_color_option ${project_color === color_item ? "project_color_option_active" : ""}`}
                                    key={color_item}
                                    style={{ "--project_color": color_item }}
                                    type="button"
                                    aria-label={`Color ${color_item}`}
                                    onClick={() => set_project_color(color_item)}
                                >
                                    {project_color === color_item ? render_icon(check_icon, 25) : null}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="project_create_step">
                        <span><strong>4</strong> Informacion existente del proyecto</span>
                        <div className="project_create_grid_3">
                            <label>
                                Fecha de inicio
                                <input name="project_start" type="date" />
                            </label>
                            <label>
                                Fecha de fin
                                <input name="project_end" type="date" />
                            </label>
                            <label>
                                Estado inicial
                                <select name="project_status" defaultValue="Activo">
                                    <option>Activo</option>
                                    <option>Pendiente</option>
                                    <option>Inactivo</option>
                                </select>
                            </label>
                        </div>
                        <label className="project_create_full_select">
                            Prioridad
                            <select name="project_priority" defaultValue="Media">
                                {priority_items.map((priority_item) => <option key={priority_item}>{priority_item}</option>)}
                            </select>
                        </label>
                    </section>

                    <section className="project_create_step">
                        <span><strong>5</strong> Personas relacionadas al proyecto</span>
                        <p>Agrega las personas que estaran relacionadas o participaran en este proyecto.</p>
                        <div className="project_people_box">
                            <label className="project_people_search">
                                {render_icon(search_icon, 23)}
                                <input
                                    value={project_people_query}
                                    placeholder="Buscar personas por nombre o correo..."
                                    onChange={(event) => set_project_people_query(event.target.value)}
                                />
                            </label>
                            <div className="project_people_selected">
                                {visible_people.map((member_item) => {
                                    const is_selected = project_people_ids.includes(member_item.id);

                                    return (
                                        <button
                                            className={`project_person_chip ${is_selected ? "project_person_chip_active" : ""}`}
                                            key={member_item.id}
                                            type="button"
                                            onClick={() => toggle_project_person(member_item.id)}
                                        >
                                            {render_avatar(member_item, "avatar_small")}
                                            {member_item.name}
                                            {render_icon(is_selected ? x_icon : plus_icon, 16)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    <footer className="project_create_footer">
                        <button type="button" onClick={() => set_active_modal(null)}>Cancelar</button>
                        <button type="submit">Crear proyecto</button>
                    </footer>
                </form>
            </section>
        </div>
    );
}


// Renders the project overflow menu from the desktop reference.
function render_project_menu(set_active_modal, handle_request_delete_project) {
    return (
        <div className="project_menu_popover">
            <button type="button">Editar detalles del proyecto <span>Ctrl+E</span></button>
            <button type="button">Duplicar proyecto <span>Ctrl+D</span></button>
            <button type="button">Guardar como plantilla</button>
            <button type="button">Exportar como CSV <span>CSV</span></button>
            <button type="button">Archivar proyecto</button>
            <button className="danger_menu_item" type="button" onClick={handle_request_delete_project}>Eliminar proyecto</button>
        </div>
    );
}


// Renders the complete Bold tasks application.

// Renders the dedicated Cronogramas module with Timeline and Calendar planning views.
function render_schedules_module(props) {
    const {
        filtered_tasks,
        handle_task_select,
        schedule_view,
        set_active_modal,
        set_schedule_view
    } = props;

    return (
        <section className="tasks_module schedules_module">
            <div className="task_project_header">
                <div className="project_title_group">
                    <p className="breadcrumb_text">
                        CRONOGRAMAS / BOLD WORKSPACE
                        <span className="desktop_breadcrumb_tail"> / PROYECTOS / MARKETING</span>
                    </p>
                    <h1>Lanzamiento Q4 — Cronogramas</h1>
                    <p className="project_subtitle">Planificación temporal, hitos y fechas de entrega del proyecto</p>
                </div>

                <div className="project_actions">
                    <button className="primary_button" type="button" onClick={() => set_active_modal("task")}>
                        {render_icon(plus_icon, 17)}
                        Planificar tarea
                    </button>
                </div>
            </div>

            <div className="schedules_tabs_row">
                <div className="schedules_nav_tabs" role="tablist" aria-label="Visualización de cronograma">
                    <button
                        className={`schedules_tab_btn ${schedule_view === "timeline" ? "schedules_tab_btn_active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={schedule_view === "timeline"}
                        onClick={() => set_schedule_view("timeline")}
                    >
                        {render_icon(gantt_chart_icon, 16)}
                        Cronograma (Gantt)
                    </button>
                    <button
                        className={`schedules_tab_btn ${schedule_view === "calendar" ? "schedules_tab_btn_active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={schedule_view === "calendar"}
                        onClick={() => set_schedule_view("calendar")}
                    >
                        {render_icon(calendar_days_icon, 16)}
                        Calendario mensual
                    </button>
                </div>
            </div>

            {schedule_view === "timeline" ? render_timeline_view(filtered_tasks, handle_task_select) : null}
            {schedule_view === "calendar" ? render_calendar_view({
                filtered_tasks,
                handle_task_select,
                set_active_modal
            }) : null}
        </section>
    );
}

class TaskAppErrorBoundary extends react_component {
    constructor(props) {
        super(props);
        this.state = { has_error: false };
    }

    static getDerivedStateFromError() {
        return { has_error: true };
    }

    componentDidCatch(error) {
        console.error("Error renderizando tareas.", error);
    }

    render() {
        if (this.state.has_error) {
            return (
                <div className="app_error_fallback">
                    <strong>No se pudo mostrar esta vista.</strong>
                    <button type="button" onClick={() => this.setState({ has_error: false })}>
                        Reintentar
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}


function TaskAppContent() {
    const [active_module, set_active_module] = use_state("tasks");
    const [active_view, set_active_view] = use_state("list");
    const [active_modal, set_active_modal] = use_state(null);
    const [is_sidebar_open, set_is_sidebar_open] = use_state(false);
    const [is_tasks_menu_open, set_is_tasks_menu_open] = use_state(true);
    const [search_query, set_search_query] = use_state("");
    const [tasks, set_tasks] = use_state(() => merge_saved_comments(starter_tasks));
    const [selected_task_id, set_selected_task_id] = use_state(null);
    const [delete_target, set_delete_target] = use_state(null);
    const [edit_draft, set_edit_draft] = use_state(null);
    const [edit_attachments, set_edit_attachments] = use_state([]);
    const [active_task_tool, set_active_task_tool] = use_state(null);
    const [sort_field, set_sort_field] = use_state("due_day");
    const [sort_direction, set_sort_direction] = use_state("asc");
    const [active_filters, set_active_filters] = use_state({
        assignee_ids: [],
        priorities: [],
        sections: []
    });
    const [visible_fields, set_visible_fields] = use_state({
        assignee: true,
        date: true,
        priority: true,
        status: true,
        project: false
    });
    const status_options = default_status_items;
    const [collapsed_sections, set_collapsed_sections] = use_state([]);
    const [is_notifications_open, set_is_notifications_open] = use_state(false);
    const [projects, set_projects] = use_state(() => {
        try {
            const saved_projects = JSON.parse(localStorage.getItem(projects_storage_key));

            return Array.isArray(saved_projects) && saved_projects.length ? saved_projects : project_items;
        } catch (_error) {
            return project_items;
        }
    });
    const [project_color, set_project_color] = use_state(project_color_options[0]);
    const [project_people_ids, set_project_people_ids] = use_state(team_members.map((member_item) => member_item.id));
    const [project_people_query, set_project_people_query] = use_state("");
    const [board_columns, set_board_columns] = use_state(default_board_columns);
    const [dragged_task_id, set_dragged_task_id] = use_state(null);
    const [is_adding_column, set_is_adding_column] = use_state(false);
    const [new_column_name, set_new_column_name] = use_state("");
    const [editing_column_id, set_editing_column_id] = use_state(null);
    const [editing_column_name, set_editing_column_name] = use_state("");
    const [schedule_view, set_schedule_view] = use_state("timeline");
    const [active_quick_popover, set_active_quick_popover] = use_state(null);
    const [active_section, set_active_section] = use_state("tasks");

    use_effect(() => {
        localStorage.setItem(projects_storage_key, JSON.stringify(projects));
    }, [projects]);

    function toggle_project_person(member_id) {
        set_project_people_ids((current_ids) => (
            current_ids.includes(member_id)
                ? current_ids.filter((current_id) => current_id !== member_id)
                : [...current_ids, member_id]
        ));
    }

    function handle_create_project(event) {
        event.preventDefault();
        const form_data = new FormData(event.currentTarget);
        const label = (form_data.get("project_name") || "").toString().trim();

        if (!label) {
            return;
        }

        set_projects((current_projects) => [
            ...current_projects,
            {
                id: `project_${Date.now()}`,
                label,
                description: (form_data.get("project_description") || "").toString(),
                color: project_color,
                start_date: form_data.get("project_start") || "",
                end_date: form_data.get("project_end") || "",
                status: form_data.get("project_status") || "Activo",
                priority: form_data.get("project_priority") || "Media",
                member_ids: project_people_ids
            }
        ]);
        set_project_color(project_color_options[0]);
        set_project_people_ids(team_members.map((member_item) => member_item.id));
        set_project_people_query("");
        set_active_modal(null);
    }

    function handle_drag_start(task_id) {
        set_dragged_task_id(task_id);
    }

    function handle_column_drop(column_id) {
        if (!dragged_task_id) return;
        const target_column = board_columns.find((c) => c.id === column_id);
        const next_section = column_id;
        const next_status = target_column ? target_column.status : "Pend.";
        const next_completed = column_id === "completed";

        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== dragged_task_id) {
                return task_item;
            }

            const updated_task = {
                ...task_item,
                section: next_section,
                status: next_status,
                completed: next_completed
            };

            update_task_request(task_item.id, updated_task).catch(() => {});
            move_task_request(task_item.id, next_section).catch(() => {});
            publish_task_event(create_task_event(task_event_types.task_status_changed, task_item.id, updated_task));

            return updated_task;
        }));

        set_dragged_task_id(null);
    }

    function handle_add_column() {
        const trimmed_name = new_column_name.trim();
        if (!trimmed_name) return;

        const new_column_id = `col_${Date.now()}`;
        set_board_columns((current_cols) => [
            ...current_cols,
            { id: new_column_id, label: trimmed_name, status: trimmed_name }
        ]);
        set_new_column_name("");
        set_is_adding_column(false);
    }

    function handle_start_edit_column(column_item) {
        set_editing_column_id(column_item.id);
        set_editing_column_name(column_item.label);
    }

    function handle_save_column_name() {
        const label = editing_column_name.trim();
        if (!editing_column_id || !label) return;
        set_board_columns((current_cols) => current_cols.map((column_item) => (
            column_item.id === editing_column_id ? { ...column_item, label, status: label } : column_item
        )));
        set_editing_column_id(null);
        set_editing_column_name("");
    }

    function handle_delete_column(column_id) {
        set_board_columns((current_cols) => current_cols.filter((column_item) => column_item.id !== column_id));
        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.section === column_id ? { ...task_item, section: "todo", status: "Pend.", completed: false } : task_item
        )));
    }

    function handle_toggle_section(section_id) {
        set_collapsed_sections((current_ids) => (
            current_ids.includes(section_id)
                ? current_ids.filter((id) => id !== section_id)
                : [...current_ids, section_id]
        ));
    }

    const [notifications, set_notifications] = use_state(notification_items);

    const filtered_tasks = use_memo(() => {
        const by_search = get_filtered_tasks(tasks, search_query);
        const by_filters = get_tasks_matching_active_filters(by_search, active_filters);

        return get_sorted_tasks(by_filters, sort_field, sort_direction);
    }, [
        active_filters,
        search_query,
        sort_direction,
        sort_field,
        tasks
    ]);

    const selected_task = use_memo(() => {
        if (!selected_task_id) return null;
        return tasks.find((task_item) => task_item.id === selected_task_id) || null;
    }, [selected_task_id, tasks]);


    // Loads real tasks from the boldApp backend on mount (falling back to
    // the static starter_tasks already set as initial state if the backend
    // is not reachable), then opens the live WebSocket connection so this
    // client re-reads the task list whenever another client (a different
    // browser/device) creates, updates, or deletes a task.
    use_effect(() => {
        let is_mounted = true;

        function refresh_tasks_from_backend(on_failure_message) {
            list_tasks_request()
                .then((backend_tasks) => {
                    if (is_mounted && backend_tasks.length) {
                        set_tasks(merge_saved_comments(backend_tasks));
                    }
                })
                .catch((error) => {
                    console.warn(on_failure_message, error);
                });
        }

        function handle_incoming_event(envelope) {
            const event_type = envelope?.event_type || "";
            const is_task_or_comment_event = event_type.startsWith("task.") || event_type.startsWith("comment.");

            if (is_task_or_comment_event) {
                refresh_tasks_from_backend("No se pudo refrescar las tareas tras un evento en vivo.");
            }
        }

        refresh_tasks_from_backend("No se pudo conectar con el backend, usando datos de ejemplo.");

        // Suscribirse a eventos y abrir el WebSocket solo tiene sentido
        // contra el backend real: en modo plantilla no hay otros clientes
        // de los que escuchar cambios, y las propias acciones locales ya
        // actualizan el estado directamente. Sin este guard, el eco local
        // de publish_task_event dispara un refetch que puede resolver
        // antes que la propia mutacion (por ejemplo, al crear una tarea),
        // pisando el estado optimista.
        let unsubscribe = () => {};

        if (is_using_real_backend()) {
            unsubscribe = subscribe_to_task_events(handle_incoming_event);

            get_demo_workspace_id()
                .then((workspace_id) => {
                    if (is_mounted) {
                        connect_realtime_stream(workspace_id);
                    }
                })
                .catch((error) => {
                    console.warn("No se pudo abrir la conexion en vivo con el backend.", error);
                });
        }

        return () => {
            is_mounted = false;
            unsubscribe();
            disconnect_realtime_stream();
        };
    }, []);


    // Opens/closes one of the Ordenar/Filtrar/Personalizar dropdown panels,
    // closing the others if one is already open.
    function handle_toggle_task_tool(tool_id) {
        set_active_task_tool((current_tool) => (current_tool === tool_id ? null : tool_id));
    }

    function handle_close_task_tool() {
        set_active_task_tool(null);
    }


    // Opens/closes the notifications dropdown panel from the top bar bell.
    function handle_toggle_notifications() {
        set_is_notifications_open((current_value) => !current_value);
    }

    function handle_close_notifications() {
        set_is_notifications_open(false);
    }

    function handle_mark_notifications_read() {
        set_notifications((current_notifications) => current_notifications.map((notification_item) => ({
            ...notification_item,
            is_read: true
        })));
    }


    // Toggles one value inside an active_filters category (assignee_ids/priorities/sections).
    function handle_toggle_filter_value(filter_key, value) {
        set_active_filters((current_filters) => {
            const current_values = current_filters[filter_key];
            const next_values = current_values.includes(value)
                ? current_values.filter((item) => item !== value)
                : [...current_values, value];

            return {
                ...current_filters,
                [filter_key]: next_values
            };
        });
    }

    function handle_clear_filters() {
        set_active_filters({
            assignee_ids: [],
            priorities: [],
            sections: []
        });
    }


    // Toggles whether an optional column shows in the desktop list view.
    function handle_toggle_visible_field(field_key) {
        set_visible_fields((current_fields) => ({
            ...current_fields,
            [field_key]: !current_fields[field_key]
        }));
    }


    // Changes the active shell module and closes mobile navigation.
    function handle_module_change(module_id) {
        if (module_id === "schedules") {
            set_active_module("tasks");
            set_active_section("timeline");
        } else {
            set_active_module(module_id);
            if (module_id === "tasks") {
                set_active_section("tasks");
            }
        }
        set_is_sidebar_open(false);
        set_selected_task_id(null);
        set_active_modal(null);
    }

    function handle_tasks_menu_toggle() {
        set_active_module("tasks");
        set_active_section("tasks");
        set_selected_task_id(null);
        set_active_modal(null);
        set_is_tasks_menu_open((current_value) => !current_value);
    }


    // Opens the task detail sidebar panel (right side split view).
    function handle_task_select(task_id) {
        if (!task_id) {
            set_selected_task_id(null);
            return;
        }
        set_selected_task_id(task_id);
        set_active_quick_popover(null);
    }


    // Opens the "Editar tarea" modal and seeds the draft.
    function handle_open_edit_task(task_id) {
        const task_item = tasks.find((t) => t.id === task_id);
        if (!task_item) return;
        const draft_snapshot = {
            title: task_item.title,
            description: task_item.description || "",
            project_id: task_item.project_id,
            section: task_item.section,
            assignee_id: task_item.assignee_id,
            due_day: task_item.due_day,
            due_label: task_item.due_label || "",
            priority: task_item.priority,
            status: task_item.status
        };
        set_selected_task_id(task_id);
        set_edit_draft(draft_snapshot);
        set_edit_attachments(task_item.attachment_name ? [{ id: "existing_attachment", name: task_item.attachment_name }] : []);
        set_active_modal("edit_task");
    }


    // Toggles / closes a quick priority or status popover in the table row.
    function handle_toggle_quick_popover(task_id, popover_type) {
        if (!task_id) {
            set_active_quick_popover(null);
            return;
        }
        set_active_quick_popover((current) =>
            current?.taskId === task_id && current?.type === popover_type
                ? null
                : { taskId: task_id, type: popover_type }
        );
    }


    // Applies a quick priority or status change from the inline popover.
    function handle_quick_change(task_id, field, value) {
        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) return task_item;
            const state_patch = field === "status"
                ? {
                    completed: value === "Lista",
                    section: value === "Lista" ? "completed" : value === "Activa" ? "in_progress" : "todo"
                }
                : {};
            const updated = { ...task_item, [field]: value, ...state_patch };
            update_task_request(task_id, updated).catch(() => {});
            return updated;
        }));
        set_active_quick_popover(null);
    }


    function handle_add_comment(task_id, comment_text) {
        const body = comment_text.trim();
        if (!body) return;

        const new_comment = {
            id: `comment_${Date.now()}`,
            task_id,
            author_name: "Joaquin Sierra",
            body,
            created_at: new Date().toISOString()
        };

        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) return task_item;

            const comments = [...(Array.isArray(task_item.comments) ? task_item.comments : []), new_comment];
            save_task_comments(task_id, comments);
            return { ...task_item, comments };
        }));

        add_comment_request(task_id, body, "Joaquin Sierra").catch((error) => {
            console.warn("No se pudo sincronizar el comentario.", error);
        });
    }


    // Toggles task completion and emits a local template event for future sync.
    function handle_toggle_task(task_id) {
        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) {
                return task_item;
            }

            const toggled_state = get_toggled_task_state(task_item);
            const updated_task = {
                ...task_item,
                ...toggled_state
            };

            update_task_request(task_id, updated_task);
            move_task_request(task_id, updated_task.section);
            publish_task_event(create_task_event(task_event_types.task_status_changed, task_id, updated_task));

            return updated_task;
        }));
    }


    function handle_request_delete_task(task_id) {
        const task_item = tasks.find((item) => item.id === task_id);
        if (!task_item) return;
        set_delete_target({ type: "task", id: task_id });
        set_active_modal("delete_confirm");
    }

    function handle_request_delete_project() {
        set_delete_target({ type: "project", id: "launch_q4" });
        set_active_modal("delete_confirm");
    }

    // Deletes a task through the backend and removes it from local state.
    function handle_confirm_delete_task(task_id) {
        delete_task_request(task_id)
            .then(() => {
                set_tasks((current_tasks) => current_tasks.filter((task_item) => task_item.id !== task_id));
                set_active_modal(null);
                set_selected_task_id(null);
                set_delete_target(null);
            })
            .catch((error) => {
                console.warn("No se pudo eliminar la tarea en el backend.", error);
            });
    }

    function handle_confirm_delete_project(project_id) {
        set_projects((current_projects) => current_projects.filter((project_item) => project_item.id !== project_id));
        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.project_id === project_id ? { ...task_item, project_id: project_items[0].id } : task_item
        )));
        set_active_modal(null);
        set_delete_target(null);
    }


    // Toggles one subtask's completed state, optimistically and through the backend.
    function handle_toggle_subtask(task_id, subtask_id) {
        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) {
                return task_item;
            }

            return {
                ...task_item,
                subtasks: (Array.isArray(task_item.subtasks) ? task_item.subtasks : []).map((subtask_item) => (
                    subtask_item.id === subtask_id
                        ? { ...subtask_item, completed: !subtask_item.completed }
                        : subtask_item
                ))
            };
        }));

        toggle_subtask_request(task_id, subtask_id).catch((error) => {
            console.warn("No se pudo actualizar la subtarea en el backend.", error);
        });
    }


    // Updates one field of the "Editar tarea" draft as the user types/selects.
    function handle_edit_field_change(field_name, value) {
        set_edit_draft((current_draft) => ({ ...current_draft, [field_name]: value }));
    }


    // Simulates picking a file from the "Agregar mas" dropzone in the
    // "Editar tarea" modal (same placeholder behavior as the create modal).
    function handle_add_edit_attachment() {
        set_edit_attachments((current_attachments) => [
            ...current_attachments,
            { id: `edit_file_${Date.now()}`, name: `archivo_${current_attachments.length + 1}.pdf` }
        ]);
    }

    function handle_remove_edit_attachment(attachment_id) {
        set_edit_attachments((current_attachments) => current_attachments.filter((attachment_item) => attachment_item.id !== attachment_id));
    }


    // Saves the "Editar tarea" draft, optimistically and through the backend.
    function handle_save_task_edits(event, task_id) {
        event.preventDefault();

        const due_label = edit_draft.due_day ? edit_draft.due_label || `${edit_draft.due_day} sep` : "";
        const completed = edit_draft.section === "completed";
        const updated_fields = { ...edit_draft, due_label, completed };

        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.id === task_id ? { ...task_item, ...updated_fields } : task_item
        )));
        publish_task_event(create_task_event(task_event_types.task_updated, task_id, updated_fields));
        set_active_modal(null);
        set_selected_task_id(null);

        update_task_request(task_id, updated_fields).catch((error) => {
            console.warn("No se pudo guardar los cambios de la tarea en el backend.", error);
        });
        move_task_request(task_id, updated_fields.section).catch((error) => {
            console.warn("No se pudo mover la tarea en el backend.", error);
        });
    }


    // Renders the active modal requested by the application state.
    function render_active_modal() {
        // New Master-Plan Crear modal
        if (active_modal === "task") {
            return (
                <CreateTaskModal
                    board_columns={board_columns}
                    on_cancel={() => set_active_modal(null)}
                    on_create={(new_task) => {
                        const temporary_id = new_task.id;
                        set_tasks((current_tasks) => [...current_tasks, normalize_task(new_task)]);
                        set_active_modal(null);
                        set_active_view("list");
                        create_task_request(new_task)
                            .then((created_task) => {
                                set_tasks((current_tasks) => current_tasks.map((t) =>
                                    t.id === temporary_id ? normalize_task(created_task) : t
                                ));
                            })
                            .catch((error) => {
                                console.warn("No se pudo crear la tarea.", error);
                            });
                    }}
                    status_options={status_options}
                />
            );
        }

        // New Master-Plan Editar modal
        if (active_modal === "edit_task" && selected_task && edit_draft) {
            return (
                <EditTaskModal
                    board_columns={board_columns}
                    edit_attachments={edit_attachments}
                    edit_draft={edit_draft}
                    handle_add_edit_attachment={handle_add_edit_attachment}
                    handle_edit_field_change={handle_edit_field_change}
                    handle_remove_edit_attachment={handle_remove_edit_attachment}
                    handle_toggle_subtask={(subtask_id) => handle_toggle_subtask(selected_task.id, subtask_id)}
                    on_cancel={() => { set_active_modal(null); }}
                    on_save={(event) => handle_save_task_edits(event, selected_task.id)}
                    selected_task={selected_task}
                    status_options={status_options}
                />
            );
        }

        if (active_modal === "share") {
            return render_share_modal(set_active_modal);
        }

        if (active_modal === "project") {
            return render_project_modal({
                handle_create_project,
                project_color,
                project_people_ids,
                project_people_query,
                set_active_modal,
                set_project_color,
                set_project_people_query,
                toggle_project_person
            });
        }

        if (active_modal === "project_menu") {
            return render_project_menu(set_active_modal, handle_request_delete_project);
        }

        if (active_modal === "delete_confirm" && delete_target) {
            const is_task = delete_target.type === "task";
            const task_item = is_task ? tasks.find((item) => item.id === delete_target.id) : null;
            const project_item = is_task ? get_project(task_item?.project_id) : projects.find((item) => item.id === delete_target.id) || project_items[0];

            return (
                <DeleteConfirmModal
                    item_label={is_task ? task_item?.title : project_item?.label}
                    item_meta={is_task ? `Proyecto: ${project_item?.label || "Sin proyecto"}` : "Proyecto"}
                    item_type={is_task ? "tarea" : "proyecto"}
                    on_cancel={() => { set_active_modal(null); set_delete_target(null); }}
                    on_confirm={() => {
                        if (is_task) handle_confirm_delete_task(delete_target.id);
                        else handle_confirm_delete_project(delete_target.id);
                    }}
                />
            );
        }

        return null;
    }


    // Returns the full shell with the focused tasks module.
    return (
        <div className={`app_shell ${is_sidebar_open ? "app_shell_with_mobile_sidebar" : ""}`}>
            {render_sidebar({
                active_module,
                handle_module_change,
                handle_tasks_menu_toggle,
                is_sidebar_open,
                is_tasks_menu_open,
                projects,
                set_active_modal,
                set_is_sidebar_open
            })}

            {is_sidebar_open ? (
                <button
                    className="mobile_sidebar_overlay"
                    type="button"
                    aria-label="Cerrar navegacion"
                    onClick={() => set_is_sidebar_open(false)}
                ></button>
            ) : null}

            <main className="main_workspace">
                {render_mobile_header({
                    active_module,
                    selected_task,
                    set_active_modal,
                    set_is_sidebar_open
                })}
                {render_top_bar({
                    handle_close_notifications,
                    handle_mark_notifications_read,
                    handle_toggle_notifications,
                    is_notifications_open,
                    notifications,
                    search_query,
                    set_search_query
                })}
                {active_module === "tasks" ? render_tasks_module({
                    active_filters,
                    active_quick_popover,
                    active_section,
                    active_task_tool,
                    active_view,
                    board_columns,
                    collapsed_sections,
                    dragged_task_id,
                    editing_column_id,
                    editing_column_name,
                    filtered_tasks,
                    handle_add_column,
                    handle_add_comment,
                    handle_clear_filters,
                    handle_close_task_tool,
                    handle_column_drop,
                    handle_delete_column,
                    handle_delete_task: handle_request_delete_task,
                    handle_drag_start,
                    handle_open_edit_task,
                    handle_quick_change,
                    handle_save_column_name,
                    handle_start_edit_column,
                    handle_task_select,
                    handle_toggle_filter_value,
                    handle_toggle_quick_popover,
                    handle_toggle_section,
                    handle_toggle_subtask,
                    handle_toggle_task,
                    handle_toggle_task_tool,
                    handle_toggle_visible_field,
                    is_adding_column,
                    new_column_name,
                    search_query,
                    selected_task,
                    selected_task_id,
                    set_active_modal,
                    set_active_section,
                    set_active_view,
                    set_editing_column_id,
                    set_editing_column_name,
                    set_is_adding_column,
                    set_new_column_name,
                    set_search_query,
                    set_sort_direction,
                    set_sort_field,
                    sort_direction,
                    sort_field,
                    status_options,
                    tasks,
                    visible_fields
                }) : active_module === "schedules" ? render_schedules_module({
                    filtered_tasks,
                    handle_task_select,
                    schedule_view,
                    set_active_modal,
                    set_schedule_view
                }) : render_placeholder_module(active_module)}
            </main>

            {render_active_modal()}
        </div>
    );
}


export default function task_app() {
    return (
        <TaskAppErrorBoundary>
            <TaskAppContent />
        </TaskAppErrorBoundary>
    );
}
