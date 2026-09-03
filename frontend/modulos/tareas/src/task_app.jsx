import { createElement as create_element, useEffect as use_effect, useMemo as use_memo, useState as use_state } from "react";
import {
    Archive as archive_icon,
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
    Download as download_icon,
    FileText as file_text_icon,
    GanttChart as gantt_chart_icon,
    Home as home_icon,
    Inbox as inbox_icon,
    LayoutList as layout_list_icon,
    Link as link_icon,
    Menu as menu_icon,
    MessageCircle as message_circle_icon,
    MoreHorizontal as more_horizontal_icon,
    MoreVertical as more_vertical_icon,
    Paperclip as paperclip_icon,
    Pencil as pencil_icon,
    Plus as plus_icon,
    Search as search_icon,
    Send as send_icon,
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


// Identifies the signed-in user for the local demo task filters.
const current_user_id = "joaquin_sierra";


// Defines the palette available when creating projects from the sidebar.
const project_color_options = [
    "#ef3c3c",
    "#f3a43b",
    "#66b885",
    "#7d6bd6",
    "#4d9ae6",
    "#2c3038"
];


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
function get_task_table_columns_style(visible_fields, with_checkbox_column) {
    const visible_widths = optional_column_items
        .filter((column_item) => visible_fields[column_item.key])
        .map((column_item) => column_item.width);
    const checkbox_column = with_checkbox_column ? "32px " : "";

    return { gridTemplateColumns: `${checkbox_column}minmax(280px, 1fr) ${visible_widths.join(" ")}` };
}


// Finds a team member by id for avatar and detail rendering.
function get_member(member_id) {
    return team_members.find((member_item) => member_item.id === member_id) || null;
}


// Finds a project by id for labels and color rendering.
function get_project(project_id, projects = project_items) {
    return projects.find((project_item) => project_item.id === project_id) || projects[0] || project_items[0];
}


// Filters tasks by title, assignee, project, and tag text.
function get_filtered_tasks(tasks, search_query, projects = project_items) {
    const normalized_query = search_query.trim().toLowerCase();

    if (!normalized_query) {
        return tasks;
    }

    return tasks.filter((task_item) => {
        const member_item = get_member(task_item.assignee_id);
        const project_item = get_project(task_item.project_id, projects);
        const searchable_text = [
            task_item.title,
            task_item.description,
            task_item.priority,
            task_item.status,
            project_item.label,
            member_item?.name || "",
            ...task_item.tags
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
    return `priority_${priority.toLowerCase()}`;
}


// Returns a class name for status badges.
function get_status_class(status) {
    return `status_${status.toLowerCase().replace(".", "")}`;
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


// Creates a task object from the new task form fields.
function build_new_task(form_data) {
    const section = form_data.get("section") || "todo";
    const due_day = Number(form_data.get("due_day") || 8);
    const priority = form_data.get("priority") || "Media";
    const assignee_id = form_data.get("assignee_id") || current_user_id;
    const title = form_data.get("task_name") || "Nueva tarea";
    const description = form_data.get("description") || "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

    return {
        id: `task_${Date.now()}`,
        title,
        description,
        project_id: form_data.get("project_id") || "launch_q4",
        section,
        assignee_id,
        due_day,
        due_label: `${due_day} sep`,
        priority,
        status: section === "completed" ? "Lista" : section === "in_progress" ? "Activa" : "Pend.",
        completed: section === "completed",
        tags: [
            "Nuevo"
        ],
        subtasks: [],
        attachment_name: "documento.pdf"
    };
}


// Builds a readable, unique id for projects created in the local UI.
function build_project_id(project_name, projects) {
    const base_id = project_name
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "proyecto";
    const existing_ids = new Set(projects.map((project_item) => project_item.id));
    let next_id = base_id;
    let suffix = 2;

    while (existing_ids.has(next_id)) {
        next_id = `${base_id}_${suffix}`;
        suffix += 1;
    }

    return next_id;
}


// Escapes one value for CSV export.
function get_csv_cell(value) {
    const cell_value = (value ?? "").toString();

    return `"${cell_value.replace(/"/g, '""')}"`;
}


// Builds a CSV file body for the tasks in one project.
function build_tasks_csv(tasks, projects) {
    const header = [
        "Tarea",
        "Descripcion",
        "Proyecto",
        "Responsable",
        "Fecha",
        "Prioridad",
        "Estado",
        "Completada"
    ];
    const rows = tasks.map((task_item) => {
        const project_item = get_project(task_item.project_id, projects);
        const member_item = get_member(task_item.assignee_id);

        return [
            task_item.title,
            task_item.description,
            project_item.label,
            member_item?.name || "Sin responsable",
            task_item.due_label,
            task_item.priority,
            task_item.status,
            task_item.completed ? "Si" : "No"
        ];
    });

    return [header, ...rows].map((row) => row.map(get_csv_cell).join(",")).join("\n");
}


// Converts a label into a filesystem-friendly filename segment.
function get_file_safe_name(label) {
    return label
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "proyecto";
}


// Triggers a CSV download in the browser.
function download_text_file(filename, file_body, mime_type) {
    const blob = new Blob([file_body], { type: mime_type });
    const download_url = URL.createObjectURL(blob);
    const download_link = document.createElement("a");

    download_link.href = download_url;
    download_link.download = filename;
    document.body.appendChild(download_link);
    download_link.click();
    download_link.remove();
    URL.revokeObjectURL(download_url);
}


// Renders a Lucide icon through React createElement so aliases can stay in snake case.
function render_icon(icon_component, size = 18) {
    return create_element(icon_component, {
        size,
        strokeWidth: 2,
        "aria-hidden": "true"
    });
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
            <span className={item.id === "tasks" ? "navigation_task_label" : ""}>{item.label}</span>
            {item.id === "tasks" ? (
                <span className={`navigation_chevron ${is_expanded ? "navigation_chevron_open" : ""}`}>
                    {render_icon(chevron_down_icon, 18)}
                </span>
            ) : null}
        </button>
    );
}


// Renders a project item in the sidebar workspace list.
function render_project_item(project_item, selected_project_id, handle_project_select) {
    const is_active = selected_project_id === project_item.id;

    return (
        <button
            className={`project_item ${is_active ? "project_item_active" : ""}`}
            key={project_item.id}
            type="button"
            onClick={() => handle_project_select(project_item.id)}
        >
            {render_project_dot(project_item.color)}
            <span>{project_item.label}</span>
            {is_active ? (
                <span className="project_more">•••</span>
            ) : null}
        </button>
    );
}


// Renders the workspace and project links nested below the Tareas item.
function render_tasks_workspace_menu(props) {
    const {
        active_project_id,
        active_task_scope,
        handle_my_tasks_select,
        handle_open_project_modal,
        handle_project_select,
        projects
    } = props;

    return (
        <div className="workspace_panel" id="tasks_workspace_menu">
            <p className="sidebar_label">WORKSPACE</p>
            <button className="workspace_selector" type="button">
                <span className="workspace_badge">B</span>
                <span>BOLD Workspace</span>
                {render_icon(chevron_down_icon, 16)}
            </button>

            <button
                className={`my_tasks_button ${active_task_scope === "my_tasks" ? "my_tasks_button_active" : ""}`}
                type="button"
                onClick={handle_my_tasks_select}
            >
                {render_project_dot("#ef3c3c")}
                <span>Mis tareas</span>
            </button>

            <div className="projects_heading">
                <p className="sidebar_label">PROYECTOS</p>
                <button
                    className="sidebar_add_button"
                    type="button"
                    aria-label="Crear proyecto"
                    onClick={handle_open_project_modal}
                >
                    {render_icon(plus_icon, 18)}
                </button>
            </div>

            <div className="project_list">
                {projects.map((project_item) => render_project_item(
                    project_item,
                    active_task_scope === "project" ? active_project_id : null,
                    handle_project_select
                ))}
            </div>
        </div>
    );
}


// Renders the desktop and mobile sidebar navigation.
function render_sidebar(props) {
    const {
        active_project_id,
        active_module,
        active_task_scope,
        handle_module_change,
        handle_my_tasks_select,
        handle_open_project_modal,
        handle_project_select,
        handle_tasks_menu_toggle,
        is_sidebar_open,
        is_tasks_menu_open,
        current_user,
        projects,
        set_is_sidebar_open
    } = props;
    // Show Inicio, Tareas and Cronogramas in the primary section
    const primary_navigation_items = navigation_items.slice(0, 3);

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
                                {is_tasks_menu_open ? render_tasks_workspace_menu({
                                    active_project_id,
                                    active_task_scope,
                                    handle_my_tasks_select,
                                    handle_open_project_modal,
                                    handle_project_select,
                                    projects
                                }) : null}
                            </div>
                        );
                    })}
                </nav>
            </div>

            <div className="sidebar_section sidebar_secondary">
                <nav className="navigation_list" aria-label="Secundaria">
                    {navigation_items.slice(3).map((item) => render_navigation_item(item, active_module, handle_module_change))}
                </nav>
            </div>

            <div className="sidebar_footer">
                <span className="profile_avatar" style={{ "--avatar_color": current_user?.color || "var(--bold_red)" }}>
                    {current_user?.initials || "JS"}
                </span>
                <div className="profile_text">
                    <strong>{current_user?.name || "Joaquin Sierra"}</strong>
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
                    data-project-menu-trigger="true"
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

    return (
        <div className="task_tool_panel">
            <h3>Filtrar</h3>
            <div className="filter_group">
                <span className="filter_group_label">Responsable</span>
                <div className="filter_option_list">
                    {team_members.map((member_item) => (
                        <label className="filter_option" key={member_item.id}>
                            <input
                                type="checkbox"
                                checked={active_filters.assignee_ids.includes(member_item.id)}
                                onChange={() => handle_toggle_filter_value("assignee_ids", member_item.id)}
                            />
                            {member_item.name}
                        </label>
                    ))}
                </div>
            </div>
            <div className="filter_group">
                <span className="filter_group_label">Estado</span>
                <div className="filter_option_list">
                    {task_sections.map((section_item) => (
                        <label className="filter_option" key={section_item.id}>
                            <input
                                type="checkbox"
                                checked={active_filters.sections.includes(section_item.id)}
                                onChange={() => handle_toggle_filter_value("sections", section_item.id)}
                            />
                            {section_item.label}
                        </label>
                    ))}
                </div>
            </div>
            <div className="filter_group">
                <span className="filter_group_label">Prioridad</span>
                <div className="filter_option_list">
                    {priority_items.map((priority_item) => (
                        <label className="filter_option" key={priority_item}>
                            <input
                                type="checkbox"
                                checked={active_filters.priorities.includes(priority_item)}
                                onChange={() => handle_toggle_filter_value("priorities", priority_item)}
                            />
                            {priority_item}
                        </label>
                    ))}
                </div>
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


// Renders the task project header and active project view.
function render_tasks_module(props) {
    const {
        active_filters,
        active_quick_popover,
        active_task_tool,
        active_view,
        board_columns = default_board_columns,
        dragged_task_id,
        active_task_scope,
        active_task_tool,
        active_view,
        current_user,
        filtered_tasks,
        handle_add_column,
        handle_add_comment,
        handle_clear_filters,
        handle_close_task_tool,
        handle_column_drop,
        handle_delete_task,
        handle_drag_start,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_filter_value,
        handle_toggle_quick_popover,
        handle_toggle_subtask,
        handle_toggle_task,
        handle_toggle_task_tool,
        handle_toggle_visible_field,
        is_adding_column,
        new_column_name,
        search_query,
        selected_task,
        selected_task_id,
        is_compact_view,
        projects,
        search_query,
        scoped_tasks,
        selected_project,
        set_active_modal,
        set_active_view,
        set_is_adding_column,
        set_new_column_name,
        set_search_query,
        set_sort_direction,
        set_sort_field,
        sort_direction,
        sort_field,
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
                        <span className="desktop_breadcrumb_tail">{breadcrumb_tail}</span>
                    </p>
                    <h1>{project_title}</h1>
                    <p className="project_subtitle">{project_subtitle}</p>
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
                <div className="view_tabs" role="tablist" aria-label="Cambiar vista">
                    {render_view_switch(active_view, set_active_view)}
                </div>
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
                </div>
                <button className="mobile_filter_button" type="button" onClick={() => set_search_query(search_query ? "" : "zzz")}>
                    {render_icon(sliders_icon, 15)}
                    Filtrar
                </button>
                <button className="mobile_floating_add" type="button" aria-label="Agregar tarea" onClick={() => set_active_modal("task")}>
                    {render_icon(plus_icon, 28)}
                </button>
            </div>

            <div className={`tasks_workspace_split ${selected_task ? "has_detail" : ""}`}>
                <div className="tasks_main_area">
                    {active_view === "list" ? render_list_view({
                        active_quick_popover,
                        board_columns,
                        completed_count,
                        completion_percent,
                        filtered_tasks,
                        handle_open_edit_task,
                        handle_quick_change,
                        handle_task_select,
                        handle_toggle_quick_popover,
                        handle_toggle_task,
                        selected_task_id,
                        set_active_modal,
                        tasks,
                        visible_fields
                    }) : null}

                    {active_view === "board" ? render_board_view({
                        active_quick_popover,
                        board_columns,
                        dragged_task_id,
                        filtered_tasks,
                        handle_add_column,
                        handle_column_drop,
                        handle_drag_start,
                        handle_open_edit_task,
                        handle_quick_change,
                        handle_task_select,
                        handle_toggle_quick_popover,
                        handle_toggle_task,
                        is_adding_column,
                        new_column_name,
                        selected_task_id,
                        set_is_adding_column,
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
        completed_count,
        completion_percent,
        empty_state,
        filtered_tasks,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_task,
        selected_task_id,
        is_compact_view,
        projects,
        set_active_modal,
        tasks,
        visible_fields
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(empty_state);
    }

    return (
        <div className="list_view">
            <div className="mobile_only">
                {render_progress_card(tasks, completed_count, completion_percent)}
            </div>

            <div className="task_table_card desktop_only">
                <div className="table_actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button className="primary_button" type="button" onClick={() => set_active_modal("task")}>
                        {render_icon(plus_icon, 16)}
                        Nueva tarea
                    </button>
                </div>

                <div className="task_table_header" style={get_task_table_columns_style(visible_fields, false)}>
                    <span>TAREA</span>
                    {optional_column_items
                        .filter((column_item) => visible_fields[column_item.key])
                        .map((column_item) => <span key={column_item.key}>{column_item.label}</span>)}
                </div>

                {board_columns.map((section_item) => render_task_group({
                    active_quick_popover,
                    filtered_tasks,
                    handle_open_edit_task,
                    handle_quick_change,
                    handle_task_select,
                    handle_toggle_quick_popover,
                    handle_toggle_task,
                    projects,
                    section_item,
                    selected_task_id,
                    visible_fields
                }))}

                <button className="add_row_button" type="button" onClick={() => set_active_modal("task")}>
                    + Agregar tarea
                </button>

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
                    filtered_tasks,
                    handle_task_select,
                    handle_toggle_task,
                    projects,
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
        filtered_tasks,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_task,
        projects,
        section_item,
        selected_task_id,
        visible_fields
    } = props;
    const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);

    if (!section_tasks.length) {
        return null;
    }

    return (
        <div className="task_group" key={section_item.id}>
            <div className="task_group_header">
                {render_icon(chevron_down_icon, 14)}
                <strong>{section_item.label.toUpperCase()}</strong>
                <span>{section_tasks.length}</span>
            </div>
            {section_tasks.map((task_item) => render_task_row({
                active_quick_popover,
                handle_open_edit_task,
                handle_quick_change,
                handle_task_select,
                handle_toggle_quick_popover,
                handle_toggle_task,
                is_selected: selected_task_id === task_item.id,
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
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_task,
        is_selected,
        task_item,
        visible_fields
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id, projects);

    const is_priority_open = active_quick_popover?.taskId === task_item.id && active_quick_popover?.type === "priority";
    const is_status_open = active_quick_popover?.taskId === task_item.id && active_quick_popover?.type === "status";

    return (
        <div
            className={`task_row ${task_item.completed ? "task_row_completed" : ""} ${is_selected ? "task_row_selected" : ""}`}
            key={task_item.id}
            style={get_task_table_columns_style(visible_fields, true)}
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
                className="task_name_button"
                type="button"
                onClick={() => handle_task_select(task_item.id)}
            >
                {task_item.title}
            </button>

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
                        className={`priority_pill_badge priority_pill_${(task_item.priority || "alta").toLowerCase()}`}
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
                        className={`status_pill_badge status_pill_${(task_item.status || "pend").toLowerCase().replace(".", "")}`}
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

            <button
                type="button"
                className="task_edit_pencil_btn"
                title="Editar tarea"
                onClick={(e) => {
                    e.stopPropagation();
                    handle_open_edit_task(task_item.id);
                }}
            >
                {render_icon(pencil_icon, 15)}
            </button>
        </div>
    );
}


// Renders one task section in the mobile list.
function render_mobile_section(props) {
    const {
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
        projects,
        section_item
    } = props;
    const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);

    if (!section_tasks.length) {
        return null;
    }

    return (
        <div className="mobile_task_section" key={section_item.id}>
            <h2>
                {section_item.label}
                <span>{section_tasks.length}</span>
            </h2>
            {section_tasks.map((task_item) => render_task_card({
                handle_task_select,
                handle_toggle_task,
                projects,
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
        projects,
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id, projects);

    return (
        <article className={`task_card ${task_item.priority === "Alta" && !task_item.completed ? "task_card_alert" : ""}`} key={task_item.id}>
            <button
                className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                type="button"
                aria-label="Completar tarea"
                onClick={() => handle_toggle_task(task_item.id)}
            >
                {task_item.completed ? render_icon(check_icon, 13) : null}
            </button>
            <button className="task_card_content" type="button" onClick={() => handle_task_select(task_item.id)}>
                <span className="task_card_title">{task_item.title}</span>
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
        filtered_tasks,
        handle_add_column,
        handle_column_drop,
        handle_drag_start,
        handle_task_select,
        handle_toggle_task,
        is_adding_column,
        new_column_name,
        set_is_adding_column,
        set_new_column_name
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(empty_state);
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
                            <h2>{section_item.label}</h2>
                            <span>{section_tasks.length}</span>
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
                                placeholder="Nombre de columna..."
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
                            Nueva columna
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
    const project_item = get_project(task_item.project_id, projects);

    return (
        <article
            className="board_card"
            data-dragging={is_dragging ? "true" : "false"}
            key={task_item.id}
            draggable={Boolean(handle_drag_start)}
            onDragStart={handle_drag_start ? () => handle_drag_start(task_item.id) : undefined}
        >
            <div className="board_card_topline">
                {render_project_dot(project_item.color)}
                <span>{project_item.label}</span>
                <button
                    className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                    type="button"
                    aria-label="Completar tarea"
                    onClick={() => handle_toggle_task(task_item.id)}
                >
                    {task_item.completed ? render_icon(check_icon, 13) : null}
                </button>
            </div>
            <button className="board_title_button" type="button" onClick={() => handle_task_select(task_item.id)}>
                {task_item.title}
            </button>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
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


// Renders the placeholder for the timeline/Gantt view, not built yet.
function render_timeline_view() {
    return (
        <div className="placeholder_card timeline_placeholder">
            <span className="placeholder_icon">{render_icon(gantt_chart_icon, 36)}</span>
            <h2>Cronograma en construccion</h2>
            <p>La vista de linea de tiempo para este proyecto todavia no esta disponible en esta demo.</p>
        </div>
    );
}


// Renders the static calendar view with tasks placed on due dates.
function render_calendar_view(props) {
    const {
        empty_state,
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
        return render_empty_tasks_state(empty_state);
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


// Renders the empty task state shown when a view has no visible tasks.
function render_empty_tasks_state(options = {}) {
    const {
        action_label,
        body = "Prueba cambiando o eliminando los filtros activos.",
        on_action,
        title = "No encontramos tareas"
    } = options;

    return (
        <div className="empty_tasks_state">
            <div className="empty_search_icon">
                {render_icon(search_icon, 96)}
            </div>
            <h2>{title}</h2>
            <p>{body}</p>
            {action_label ? (
                <button className="primary_button" type="button" onClick={on_action}>
                    {action_label}
                </button>
            ) : null}
        </div>
    );
}


// 1. View Switch Toggle (Image 1)
function render_view_switch(active_view, set_active_view) {
    return (
        <button
            className={`view_switch_toggle ${active_view === "list" ? "view_list_active" : "view_board_active"}`}
            type="button"
            aria-label="Cambiar vista Lista o Tablero"
            title={`Cambiar a ${active_view === "list" ? "Tablero" : "Lista"}`}
            onClick={() => set_active_view(active_view === "list" ? "board" : "list")}
        >
            <span className="toggle_side toggle_left">
                {render_icon(layout_list_icon, 18)}
            </span>
            <span className="toggle_side toggle_right">
                {render_icon(columns_icon, 18)}
            </span>
        </button>
    );
}

// 2. Quick Priority Popover (Image 5)
function QuickPriorityPopover(props) {
    const { current_priority, on_close, on_select } = props;
    const options = [
        { label: "ALTA", value: "Alta", color: "#fca5a5", checkColor: "#e22323" },
        { label: "MEDIA", value: "Media", color: "#fde047", checkColor: "#b45309" },
        { label: "BAJA", value: "Baja", color: "#cbd5e1", checkColor: "#475569" }
    ];

    return (
        <div className="quick_popover_bubble" onClick={(e) => e.stopPropagation()}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className="quick_popover_item_btn"
                    onClick={() => {
                        on_select(opt.value);
                        on_close();
                    }}
                >
                    <span className="quick_popover_circle" style={{ background: opt.color }} />
                    <span style={{ color: opt.value.toLowerCase() === (current_priority || "").toLowerCase() ? opt.checkColor : "inherit" }}>
                        {opt.label}
                    </span>
                    {opt.value.toLowerCase() === (current_priority || "").toLowerCase() ? (
                        <span className="quick_popover_check_icon" style={{ color: opt.checkColor }}>✓</span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}

// 3. Quick Status Popover (Image 5)
function QuickStatusPopover(props) {
    const { current_status, on_close, on_select } = props;
    const options = [
        { label: "ACTIVA", value: "Activa", color: "#93c5fd", checkColor: "#0284c7" },
        { label: "PENDIENTE", value: "Pend.", color: "#fde047", checkColor: "#b45309" },
        { label: "INACTIVA", value: "Inactiva", color: "#cbd5e1", checkColor: "#64748b" },
        { label: "LISTA", value: "Lista", color: "#86efac", checkColor: "#15803d" }
    ];

    return (
        <div className="quick_popover_bubble" onClick={(e) => e.stopPropagation()}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className="quick_popover_item_btn"
                    onClick={() => {
                        on_select(opt.value);
                        on_close();
                    }}
                >
                    <span className="quick_popover_circle" style={{ background: opt.color }} />
                    <span style={{ color: opt.value.toLowerCase() === (current_status || "").toLowerCase() ? opt.checkColor : "inherit" }}>
                        {opt.label}
                    </span>
                    {opt.value.toLowerCase() === (current_status || "").toLowerCase() ? (
                        <span className="quick_popover_check_icon" style={{ color: opt.checkColor }}>✓</span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}

// 4. Custom Date Picker Popover (Section 13)
function CustomDatePicker(props) {
    const {
        due_day,
        due_month = 8,
        due_year = 2026,
        on_close,
        on_save
    } = props;

    const [temp_year, set_temp_year] = use_state(due_year);
    const [temp_month, set_temp_month] = use_state(due_month);
    const [temp_day, set_temp_day] = use_state(due_day);

    const days_in_month = new Date(temp_year, temp_month + 1, 0).getDate();
    const first_weekday = (new Date(temp_year, temp_month, 1).getDay() + 6) % 7;

    function handle_change_month(new_month) {
        let m = new_month;
        let y = temp_year;
        if (m < 0) {
            m = 11;
            y -= 1;
        } else if (m > 11) {
            m = 0;
            y += 1;
        }
        set_temp_month(m);
        set_temp_year(y);
        const max_days = new Date(y, m + 1, 0).getDate();
        if (temp_day && temp_day > max_days) {
            set_temp_day(max_days);
        }
    }

    return (
        <div className="custom_datepicker_popover" onClick={(e) => e.stopPropagation()}>
            <div className="custom_datepicker_nav">
                <button
                    type="button"
                    className="icon_button"
                    aria-label="Mes anterior"
                    onClick={() => handle_change_month(temp_month - 1)}
                >
                    {render_icon(chevron_left_icon, 16)}
                </button>
                <div style={{ display: "flex", gap: "6px" }}>
                    <select
                        value={temp_month}
                        onChange={(e) => handle_change_month(Number(e.target.value))}
                    >
                        {month_names_es.map((m_name, idx) => (
                            <option key={idx} value={idx}>{m_name}</option>
                        ))}
                    </select>
                    <select
                        value={temp_year}
                        onChange={(e) => {
                            const y = Number(e.target.value);
                            set_temp_year(y);
                            const max_d = new Date(y, temp_month + 1, 0).getDate();
                            if (temp_day && temp_day > max_d) set_temp_day(max_d);
                        }}
                    >
                        {[2024, 2025, 2026, 2027, 2028].map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>
                <button
                    type="button"
                    className="icon_button"
                    aria-label="Mes siguiente"
                    onClick={() => handle_change_month(temp_month + 1)}
                >
                    {render_icon(chevron_right_icon, 16)}
                </button>
            </div>

            <div className="custom_datepicker_grid">
                {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((d) => (
                    <span key={d} className="custom_datepicker_weekday">{d}</span>
                ))}
                {Array.from({ length: first_weekday }).map((_, i) => (
                    <div key={`blank_${i}`} />
                ))}
                {Array.from({ length: days_in_month }).map((_, i) => {
                    const day_num = i + 1;
                    const is_selected = temp_day === day_num;
                    return (
                        <button
                            key={day_num}
                            type="button"
                            className={`custom_datepicker_day_btn ${is_selected ? "active_day" : ""}`}
                            onClick={() => set_temp_day(day_num)}
                        >
                            {day_num}
                        </button>
                    );
                })}
            </div>

            <div className="custom_datepicker_actions">
                <button
                    type="button"
                    className="custom_datepicker_clear_btn"
                    onClick={() => {
                        on_save(null, temp_month, temp_year);
                        on_close();
                    }}
                >
                    Quitar fecha
                </button>
                <button
                    type="button"
                    className="custom_datepicker_apply_btn"
                    onClick={() => {
                        on_save(temp_day, temp_month, temp_year);
                        on_close();
                    }}
                >
                    Aplicar
                </button>
            </div>
        </div>
    );
}

// 5. Task Detail Panel (Image 3 - Right Side)
function TaskDetailPanel(props) {
    const {
        handle_add_comment,
        handle_delete_task,
        handle_open_edit_task,
        handle_toggle_subtask,
        handle_toggle_task,
        on_close,
        selected_task
    } = props;

    const [comment_text, set_comment_text] = use_state("");

    if (!selected_task) return null;

    const member_item = get_member(selected_task.assignee_id);
    const project_item = get_project(selected_task.project_id);
    const subtasks = selected_task.subtasks || [];
    const completed_subtasks = subtasks.filter((s) => s.completed).length;
    const progress_pct = subtasks.length ? Math.round((completed_subtasks / subtasks.length) * 100) : 0;

    function handle_comment_submit(e) {
        if (e) e.preventDefault();
        const trimmed = comment_text.trim();
        if (!trimmed) return;
        handle_add_comment(selected_task.id, trimmed);
        set_comment_text("");
    }

    const due_display = selected_task.due_day
        ? `${selected_task.due_day} de ${month_names_es[selected_task.due_month ?? 8] || "septiembre"}`
        : "Sin fecha";

    return (
        <aside className="task_detail_panel_card" role="region" aria-label="Detalle de tarea">
            <div className="detail_top_eyebrow_row">
                <span className="detail_eyebrow_text">DETALLE DE TAREA</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                        className="task_edit_pencil_btn"
                        type="button"
                        title="Editar tarea"
                        onClick={() => handle_open_edit_task(selected_task.id)}
                    >
                        {render_icon(pencil_icon, 16)}
                    </button>
                    <button
                        className="detail_close_circle_btn"
                        type="button"
                        aria-label="Cerrar detalle"
                        onClick={on_close}
                    >
                        {render_icon(x_icon, 16)}
                    </button>
                </div>
            </div>

            <div className="detail_title_row">
                <button
                    className={`task_checkbox ${selected_task.completed ? "task_checkbox_checked" : ""}`}
                    type="button"
                    aria-label="Completar tarea"
                    onClick={() => handle_toggle_task(selected_task.id)}
                >
                    {selected_task.completed ? render_icon(check_icon, 14) : null}
                </button>
                <h2>{selected_task.title}</h2>
            </div>

            <div>
                <span className={`status_pill_badge status_pill_${(selected_task.status || "pend").toLowerCase().replace(".", "")}`}>
                    {selected_task.status || "PEND."}
                </span>
            </div>

            <div className="detail_meta_grid">
                <div className="detail_meta_item">
                    <span className="meta_label">Responsable</span>
                    <span className="meta_val">
                        {render_avatar(member_item, "avatar_small")}
                        {member_item?.name || "Sin asignar"}
                    </span>
                </div>
                <div className="detail_meta_item">
                    <span className="meta_label">Fecha límite</span>
                    <span className="meta_val">
                        {selected_task.due_day ? (
                            <span className="detail_day_badge">{selected_task.due_day}</span>
                        ) : null}
                        {due_display}
                    </span>
                </div>
                <div className="detail_meta_item">
                    <span className="meta_label">Proyecto</span>
                    <span className="meta_val">
                        {render_project_dot(project_item.color)}
                        {project_item.label}
                    </span>
                </div>
                <div className="detail_meta_item">
                    <span className="meta_label">Prioridad</span>
                    <span className="meta_val">
                        <span className={`priority_pill_badge priority_pill_${(selected_task.priority || "alta").toLowerCase()}`}>
                            {(selected_task.priority || "ALTA").toUpperCase()}
                        </span>
                    </span>
                </div>
            </div>

            {selected_task.description ? (
                <div>
                    <h4 style={{ fontSize: "12px", fontWeight: 800, color: "#797f8c", margin: "0 0 6px 0", textTransform: "uppercase" }}>Descripción</h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.5 }}>{selected_task.description}</p>
                </div>
            ) : null}

            <div className="detail_dependency_box">
                <strong>DEPENDENCIA</strong>
                <span>Bloquea: Publicar campaña</span>
            </div>

            <div className="detail_subtasks_block">
                <div className="detail_subtasks_header">
                    <h4>Subtareas</h4>
                    <span>{completed_subtasks} de {subtasks.length}</span>
                </div>
                <div className="detail_subtasks_progress_bar">
                    <div className="detail_subtasks_progress_fill" style={{ width: `${progress_pct}%` }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                    {subtasks.length ? subtasks.map((st) => (
                        <div key={st.id} className={`detail_subtask_row ${st.completed ? "completed" : ""}`}>
                            <button
                                type="button"
                                className={`task_checkbox ${st.completed ? "task_checkbox_checked" : ""}`}
                                onClick={() => handle_toggle_subtask(selected_task.id, st.id)}
                            >
                                {st.completed ? render_icon(check_icon, 12) : null}
                            </button>
                            <span>{st.title}</span>
                        </div>
                    )) : (
                        <span style={{ fontSize: "13px", color: "#9499a5" }}>Sin subtareas asociadas.</span>
                    )}
                </div>
            </div>

            <div className="detail_files_block">
                <h4>Archivos</h4>
                {selected_task.attachments && selected_task.attachments.length > 0 ? (
                    selected_task.attachments.map((att) => (
                        <div key={att.id} className="detail_file_item" style={{ marginBottom: 6 }}>
                            <span className={att.type === "zip" ? "file_badge_zip" : "file_badge_pdf"}>
                                {(att.type || "pdf").toUpperCase()}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ display: "block", fontSize: "13px", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</strong>
                                <small style={{ color: "#64748b", fontSize: "11px" }}>{att.size}</small>
                            </div>
                        </div>
                    ))
                ) : selected_task.attachment_name ? (
                    <div className="detail_file_item">
                        <span className="file_badge_pdf">PDF</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ display: "block", fontSize: "13px", color: "#1e293b" }}>{selected_task.attachment_name}</strong>
                            <small style={{ color: "#64748b", fontSize: "11px" }}>2.4 MB</small>
                        </div>
                    </div>
                ) : (
                    <span style={{ fontSize: "13px", color: "#9499a5" }}>Sin archivos adjuntos.</span>
                )}
            </div>

            {selected_task.comments && selected_task.comments.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h4 style={{ fontSize: "12px", fontWeight: 800, color: "#797f8c", margin: 0, textTransform: "uppercase" }}>Comentarios</h4>
                    {selected_task.comments.map((comm) => (
                        <div key={comm.id} style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: "8px", fontSize: "12px" }}>
                            <strong style={{ color: "#1e293b" }}>{comm.author_name}: </strong>
                            <span style={{ color: "#475569" }}>{comm.body}</span>
                        </div>
                    ))}
                </div>
            ) : null}

            <form onSubmit={handle_comment_submit} className="detail_comment_input_box">
                <input
                    type="text"
                    value={comment_text}
                    onChange={(e) => set_comment_text(e.target.value)}
                    placeholder="Escribe un comentario..."
                />
                <button type="submit" className="detail_comment_submit_btn" aria-label="Enviar comentario">
                    {render_icon(arrow_up_icon, 14)}
                </button>
            </form>
        </aside>
    );
}

// 6. Modal Editar Tarea (Image 2)
function EditTaskModal(props) {
    const {
        board_columns,
        handle_delete_task,
        handle_save_edit_task,
        selected_task,
        set_active_modal
    } = props;

    // Temporary local state
    const [title, set_title] = use_state(selected_task?.title || "");
    const [project_id, set_project_id] = use_state(selected_task?.project_id || "launch_q4");
    const [section, set_section] = use_state(selected_task?.section || "in_progress");
    const [assignee_id, set_assignee_id] = use_state(selected_task?.assignee_id || "david_urbina");
    const [due_day, set_due_day] = use_state(selected_task?.due_day || 8);
    const [due_month, set_due_month] = use_state(selected_task?.due_month ?? 8);
    const [due_year, set_due_year] = use_state(selected_task?.due_year ?? 2026);
    const [priority, set_priority] = use_state(selected_task?.priority || "Alta");
    const [status, set_status] = use_state(selected_task?.status || "Activa");
    const [description, set_description] = use_state(selected_task?.description || "");

    const [is_calendar_open, set_is_calendar_open] = use_state(false);

    // Subtasks state
    const [subtasks, set_subtasks] = use_state(
        Array.isArray(selected_task?.subtasks) && selected_task.subtasks.length > 0
            ? selected_task.subtasks.map((s) => ({ ...s }))
            : [
                { id: "sub_1", title: "Definir concepto visual y moodboard", completed: true },
                { id: "sub_2", title: "Diseñar key visual principal", completed: true },
                { id: "sub_3", title: "Preparar banners y adaptaciones", completed: false }
            ]
    );
    const [new_subtask_input, set_new_subtask_input] = use_state("");
    const [is_adding_subtask, set_is_adding_subtask] = use_state(false);
    const [active_subtask_menu_id, set_active_subtask_menu_id] = use_state(null);
    const [editing_subtask_id, set_editing_subtask_id] = use_state(null);
    const [editing_subtask_text, set_editing_subtask_text] = use_state("");

    // Attachments state
    const initial_attachments = Array.isArray(selected_task?.attachments) && selected_task.attachments.length > 0
        ? selected_task.attachments
        : [
            { id: "att_1", name: "brief-campaña.pdf", size: "2.4 MB", type: "pdf" },
            { id: "att_2", name: "referencias-visuales.zip", size: "8.1 MB", type: "zip" }
        ];
    const [attachments, set_attachments] = use_state(initial_attachments);

    // Close popovers on window click
    use_effect(() => {
        function handle_click_outside(e) {
            if (active_subtask_menu_id && !e.target.closest(".subtask_menu_container")) {
                set_active_subtask_menu_id(null);
            }
            if (is_calendar_open && !e.target.closest(".bold_date_picker_container")) {
                set_is_calendar_open(false);
            }
        }
        window.addEventListener("click", handle_click_outside);
        return () => window.removeEventListener("click", handle_click_outside);
    }, [active_subtask_menu_id, is_calendar_open]);

    const completed_subtasks_count = subtasks.filter((s) => s.completed).length;
    const current_assignee = get_member(assignee_id);

    function handle_toggle_subtask_item(subtask_id) {
        set_subtasks((curr) => curr.map((s) => (
            s.id === subtask_id ? { ...s, completed: !s.completed } : s
        )));
    }

    function handle_add_subtask_confirm() {
        const trimmed = new_subtask_input.trim();
        if (!trimmed) return;
        set_subtasks((curr) => [
            ...curr,
            { id: `subtask_${Date.now()}`, title: trimmed, completed: false }
        ]);
        set_new_subtask_input("");
        set_is_adding_subtask(false);
    }

    function handle_delete_subtask_item(subtask_id) {
        set_subtasks((curr) => curr.filter((s) => s.id !== subtask_id));
        set_active_subtask_menu_id(null);
    }

    function handle_save_edited_subtask(subtask_id) {
        const trimmed = editing_subtask_text.trim();
        if (!trimmed) return;
        set_subtasks((curr) => curr.map((s) => (
            s.id === subtask_id ? { ...s, title: trimmed } : s
        )));
        set_editing_subtask_id(null);
        set_editing_subtask_text("");
    }

    function handle_files_selected(e) {
        const files = e.target.files;
        if (!files || !files.length) return;
        const new_items = Array.from(files).map((f) => {
            const ext = f.name.split(".").pop().toLowerCase();
            const size_mb = (f.size / (1024 * 1024)).toFixed(1);
            return {
                id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                name: f.name,
                size: `${Number(size_mb) > 0 ? size_mb : "0.1"} MB`,
                type: ext === "zip" || ext === "rar" ? "zip" : ext === "pdf" ? "pdf" : "file"
            };
        });
        set_attachments((curr) => [...curr, ...new_items]);
        e.target.value = "";
    }

    function handle_remove_attachment(att_id) {
        set_attachments((curr) => curr.filter((a) => a.id !== att_id));
    }

    function handle_save_changes() {
        const date_label = due_day ? `${due_day} ${month_abbrev_es[due_month] || "sep"}` : "Sin fecha";
        const is_completed = section === "completed" || status === "Lista";

        const updated_task = {
            ...selected_task,
            title: title.trim() || selected_task.title,
            project_id,
            section,
            assignee_id,
            due_day,
            due_month,
            due_year,
            due_label: date_label,
            priority,
            status,
            description,
            completed: is_completed,
            subtasks,
            attachments,
            attachment_name: attachments.length ? attachments[0].name : null
        };

        handle_save_edit_task(updated_task);
        set_active_modal(null);
    }

    const due_display = due_day
        ? `${due_day} de ${month_names_es[due_month] || "septiembre"}`
        : "Seleccionar fecha";

    return (
        <div className="bold_modal_backdrop" onClick={() => set_active_modal(null)}>
            <div className="bold_modal_window" onClick={(e) => e.stopPropagation()}>
                <header className="bold_modal_header">
                    <div>
                        <span className="bold_modal_eyebrow">EDITAR TAREA</span>
                        <h2 className="bold_modal_title">{selected_task?.title || "Editar tarea"}</h2>
                    </div>
                    <button
                        type="button"
                        className="bold_modal_close_btn"
                        aria-label="Cerrar modal"
                        onClick={() => set_active_modal(null)}
                    >
                        {render_icon(x_icon, 18)}
                    </button>
                </header>

                <div className="bold_modal_body">
                    <div className="bold_field_group">
                        <label>Nombre de la tarea</label>
                        <input
                            type="text"
                            className="bold_input_text"
                            value={title}
                            onChange={(e) => set_title(e.target.value)}
                        />
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Proyecto</label>
                            <select
                                className="bold_select_box"
                                value={project_id}
                                onChange={(e) => set_project_id(e.target.value)}
                            >
                                {project_items.map((p) => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label>Sección</label>
                            <select
                                className="bold_select_box"
                                value={section}
                                onChange={(e) => {
                                    const next_sec = e.target.value;
                                    set_section(next_sec);
                                    if (next_sec === "completed") set_status("Lista");
                                    else if (next_sec === "in_progress") set_status("Activa");
                                    else set_status("Pend.");
                                }}
                            >
                                {board_columns.map((c) => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Responsable</label>
                            <div className="bold_pill_select_wrap">
                                {render_avatar(current_assignee, "avatar_small")}
                                <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: "#1f2937" }}>
                                    {current_assignee?.name || "Sin asignar"}
                                </span>
                                <span className="chevron_icon">{render_icon(chevron_down_icon, 14)}</span>
                                <select
                                    value={assignee_id}
                                    onChange={(e) => set_assignee_id(e.target.value)}
                                >
                                    {team_members.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="bold_field_group bold_date_picker_container" style={{ position: "relative" }}>
                            <label>Fecha límite</label>
                            <button
                                type="button"
                                className="bold_date_trigger_btn"
                                onClick={() => set_is_calendar_open(!is_calendar_open)}
                            >
                                {render_icon(calendar_days_icon, 16)}
                                <span>{due_display}</span>
                                {render_icon(calendar_days_icon, 16)}
                            </button>

                            {is_calendar_open ? (
                                <CustomDatePicker
                                    due_day={due_day}
                                    due_month={due_month}
                                    due_year={due_year}
                                    on_close={() => set_is_calendar_open(false)}
                                    on_save={(d, m, y) => {
                                        set_due_day(d);
                                        set_due_month(m);
                                        set_due_year(y);
                                    }}
                                />
                            ) : null}
                        </div>
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Prioridad</label>
                            <div className="bold_pill_select_wrap">
                                <span className={`priority_pill_badge priority_pill_${priority.toLowerCase()}`}>
                                    {priority.toUpperCase()}
                                </span>
                                <span className="chevron_icon">{render_icon(chevron_down_icon, 14)}</span>
                                <select
                                    value={priority}
                                    onChange={(e) => set_priority(e.target.value)}
                                >
                                    <option value="Alta">Alta</option>
                                    <option value="Media">Media</option>
                                    <option value="Baja">Baja</option>
                                </select>
                            </div>
                        </div>

                        <div className="bold_field_group">
                            <label>Estado</label>
                            <div className="bold_pill_select_wrap">
                                <span className={`status_pill_badge status_pill_${status.toLowerCase().replace(".", "")}`}>
                                    {status.toUpperCase()}
                                </span>
                                <span className="chevron_icon">{render_icon(chevron_down_icon, 14)}</span>
                                <select
                                    value={status}
                                    onChange={(e) => set_status(e.target.value)}
                                >
                                    <option value="Activa">Activa</option>
                                    <option value="Pend.">Pendiente</option>
                                    <option value="Inactiva">Inactiva</option>
                                    <option value="Lista">Lista</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="bold_field_group">
                        <label>Descripción</label>
                        <textarea
                            rows={3}
                            className="bold_textarea"
                            value={description}
                            onChange={(e) => set_description(e.target.value)}
                            placeholder="Instrucciones, detalles o notas importantes..."
                        />
                    </div>

                    <div className="bold_field_group">
                        <div className="subtasks_section_header">
                            <label>Subtareas</label>
                            <span className="subtasks_badge_count">{completed_subtasks_count} de {subtasks.length}</span>
                        </div>

                        <div className="subtasks_list_box">
                            {subtasks.map((st) => (
                                <div key={st.id} className={`subtask_item_card ${st.completed ? "completed" : ""}`}>
                                    <button
                                        type="button"
                                        className={`task_checkbox ${st.completed ? "task_checkbox_checked" : ""}`}
                                        onClick={() => handle_toggle_subtask_item(st.id)}
                                    >
                                        {st.completed ? render_icon(check_icon, 13) : null}
                                    </button>

                                    {editing_subtask_id === st.id ? (
                                        <input
                                            autoFocus
                                            type="text"
                                            className="bold_input_text"
                                            style={{ padding: "4px 8px", fontSize: 13 }}
                                            value={editing_subtask_text}
                                            onChange={(e) => set_editing_subtask_text(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handle_save_edited_subtask(st.id);
                                                if (e.key === "Escape") set_editing_subtask_id(null);
                                            }}
                                            onBlur={() => handle_save_edited_subtask(st.id)}
                                        />
                                    ) : (
                                        <span className="subtask_title" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
                                            {st.title}
                                        </span>
                                    )}

                                    {st.completed ? (
                                        <span className="subtask_check_circle_green">
                                            {render_icon(check_circle_icon, 16)}
                                        </span>
                                    ) : (
                                        <span style={{ marginLeft: "auto", color: "#cbd5e1" }}>
                                            <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "1.5px solid #cbd5e1" }}></span>
                                        </span>
                                    )}

                                    <div className="subtask_menu_container" style={{ position: "relative" }}>
                                        <button
                                            type="button"
                                            className="subtask_menu_dots_btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                set_active_subtask_menu_id(active_subtask_menu_id === st.id ? null : st.id);
                                            }}
                                        >
                                            {render_icon(more_vertical_icon, 16)}
                                        </button>

                                        {active_subtask_menu_id === st.id ? (
                                            <div className="subtask_dots_popover" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        set_editing_subtask_id(st.id);
                                                        set_editing_subtask_text(st.title);
                                                        set_active_subtask_menu_id(null);
                                                    }}
                                                >
                                                    {render_icon(pencil_icon, 13)}
                                                    Editar
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger_item"
                                                    onClick={() => handle_delete_subtask_item(st.id)}
                                                >
                                                    {render_icon(trash_icon, 13)}
                                                    Eliminar
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            ))}

                            {is_adding_subtask ? (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        autoFocus
                                        type="text"
                                        className="bold_input_text"
                                        placeholder="Descripción de la subtarea..."
                                        value={new_subtask_input}
                                        onChange={(e) => set_new_subtask_input(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handle_add_subtask_confirm();
                                            if (e.key === "Escape") set_is_adding_subtask(false);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="bold_btn_submit"
                                        style={{ padding: "8px 14px", fontSize: 12 }}
                                        onClick={handle_add_subtask_confirm}
                                    >
                                        Agregar
                                    </button>
                                    <button
                                        type="button"
                                        className="bold_btn_cancel"
                                        style={{ padding: "8px 12px", fontSize: 12 }}
                                        onClick={() => set_is_adding_subtask(false)}
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        background: "none",
                                        border: "none",
                                        color: "#e22323",
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        padding: "4px 0",
                                        alignSelf: "flex-start"
                                    }}
                                    onClick={() => set_is_adding_subtask(true)}
                                >
                                    {render_icon(plus_icon, 15)}
                                    Agregar subtarea
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="bold_field_group">
                        <label>Archivos adjuntos</label>
                        {attachments.map((att) => (
                            <div key={att.id} className="detail_file_item" style={{ marginBottom: 6 }}>
                                <span className={att.type === "zip" ? "file_badge_zip" : "file_badge_pdf"}>
                                    {(att.type || "pdf").toUpperCase()}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <strong style={{ display: "block", fontSize: 13, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</strong>
                                    <small style={{ color: "#64748b", fontSize: 11 }}>{att.size}</small>
                                </div>
                                <button
                                    type="button"
                                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
                                    onClick={() => handle_remove_attachment(att.id)}
                                >
                                    {render_icon(x_icon, 15)}
                                </button>
                            </div>
                        ))}

                        <label className="attachments_dropzone_box">
                            <input
                                type="file"
                                multiple
                                style={{ display: "none" }}
                                onChange={handle_files_selected}
                            />
                            <span style={{ display: "inline-flex", padding: 8, background: "#fee2e2", color: "#e22323", borderRadius: 8 }}>
                                {render_icon(paperclip_icon, 18)}
                            </span>
                            <div className="attachments_dropzone_text">
                                <strong>Agregar más archivos</strong>
                                <small>Puedes seleccionar varios archivos</small>
                            </div>
                        </label>
                    </div>
                </div>

                <footer className="bold_modal_footer">
                    <button
                        type="button"
                        className="bold_btn_cancel"
                        onClick={() => set_active_modal(null)}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="bold_btn_submit"
                        onClick={handle_save_changes}
                    >
                        Guardar cambios
                    </button>
                </footer>
            </div>
        </div>
    );
}

// 7. Modal Crear Nueva Tarea (Image 4)
function CreateTaskModal(props) {
    const {
        board_columns,
        handle_create_task,
        set_active_modal
    } = props;

    const [title, set_title] = use_state("");
    const [project_id, set_project_id] = use_state("launch_q4");
    const [section, set_section] = use_state(board_columns[0]?.id || "todo");
    const [assignee_id, set_assignee_id] = use_state("david_urbina");
    const [due_day, set_due_day] = use_state(null);
    const [due_month, set_due_month] = use_state(8);
    const [due_year, set_due_year] = use_state(2026);
    const [priority, set_priority] = use_state("Alta");
    const [description, set_description] = use_state("");

    const [is_calendar_open, set_is_calendar_open] = use_state(false);
    const [subtasks, set_subtasks] = use_state([
        { id: `subtask_${Date.now()}`, title: "", completed: false }
    ]);
    const [attachments, set_attachments] = use_state([]);

    const current_assignee = get_member(assignee_id);

    function handle_update_subtask_title(id, text) {
        set_subtasks((curr) => curr.map((s) => (s.id === id ? { ...s, title: text } : s)));
    }

    function handle_remove_subtask_row(id) {
        set_subtasks((curr) => curr.filter((s) => s.id !== id));
    }

    function handle_add_subtask_row() {
        set_subtasks((curr) => [
            ...curr,
            { id: `subtask_${Date.now()}_${Math.random()}`, title: "", completed: false }
        ]);
    }

    function handle_files_selected(e) {
        const files = e.target.files;
        if (!files || !files.length) return;
        const new_items = Array.from(files).map((f) => {
            const ext = f.name.split(".").pop().toLowerCase();
            const size_mb = (f.size / (1024 * 1024)).toFixed(1);
            return {
                id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                name: f.name,
                size: `${Number(size_mb) > 0 ? size_mb : "0.1"} MB`,
                type: ext === "zip" || ext === "rar" ? "zip" : ext === "pdf" ? "pdf" : "file"
            };
        });
        set_attachments((curr) => [...curr, ...new_items]);
        e.target.value = "";
    }

    function handle_submit() {
        const trimmed_title = title.trim();
        if (!trimmed_title) return;

        const date_label = due_day ? `${due_day} ${month_abbrev_es[due_month] || "sep"}` : "Sin fecha";
        const valid_subtasks = subtasks.filter((s) => s.title.trim().length > 0);

        const new_task = {
            id: `task_${Date.now()}`,
            title: trimmed_title,
            project_id,
            section,
            assignee_id,
            due_day,
            due_month,
            due_year,
            due_label: date_label,
            priority,
            status: section === "completed" ? "Lista" : section === "in_progress" ? "Activa" : "Pend.",
            description,
            completed: section === "completed",
            tags: ["General"],
            subtasks: valid_subtasks,
            attachments,
            attachment_name: attachments.length ? attachments[0].name : null,
            comments: []
        };

        handle_create_task(new_task);
        set_active_modal(null);
    }

    const due_display = due_day
        ? `${due_day} de ${month_names_es[due_month] || "septiembre"}`
        : "Seleccionar fecha";

    return (
        <div className="bold_modal_backdrop" onClick={() => set_active_modal(null)}>
            <div className="bold_modal_window" onClick={(e) => e.stopPropagation()}>
                <header className="bold_modal_header">
                    <div>
                        <span className="bold_modal_eyebrow">NUEVA TAREA</span>
                        <h2 className="bold_modal_title">Crear nueva tarea</h2>
                    </div>
                    <button
                        type="button"
                        className="bold_modal_close_btn"
                        aria-label="Cerrar modal"
                        onClick={() => set_active_modal(null)}
                    >
                        {render_icon(x_icon, 18)}
                    </button>
                </header>

                <div className="bold_modal_body">
                    <div className="bold_field_group">
                        <label>Nombre de la tarea</label>
                        <input
                            type="text"
                            className="bold_input_text"
                            placeholder="Ej. Preparar presentación para el cliente"
                            value={title}
                            onChange={(e) => set_title(e.target.value)}
                        />
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Proyecto</label>
                            <select
                                className="bold_select_box"
                                value={project_id}
                                onChange={(e) => set_project_id(e.target.value)}
                            >
                                {project_items.map((p) => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bold_field_group">
                            <label>Sección</label>
                            <select
                                className="bold_select_box"
                                value={section}
                                onChange={(e) => set_section(e.target.value)}
                            >
                                {board_columns.map((c) => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Responsable</label>
                            <div className="bold_pill_select_wrap">
                                {render_avatar(current_assignee, "avatar_small")}
                                <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700, color: "#1f2937" }}>
                                    {current_assignee?.name || "Sin asignar"}
                                </span>
                                <span className="chevron_icon">{render_icon(chevron_down_icon, 14)}</span>
                                <select
                                    value={assignee_id}
                                    onChange={(e) => set_assignee_id(e.target.value)}
                                >
                                    {team_members.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="bold_field_group bold_date_picker_container" style={{ position: "relative" }}>
                            <label>Fecha límite</label>
                            <button
                                type="button"
                                className="bold_date_trigger_btn"
                                onClick={() => set_is_calendar_open(!is_calendar_open)}
                            >
                                {render_icon(calendar_days_icon, 16)}
                                <span>{due_display}</span>
                                {render_icon(calendar_days_icon, 16)}
                            </button>

                            {is_calendar_open ? (
                                <CustomDatePicker
                                    due_day={due_day}
                                    due_month={due_month}
                                    due_year={due_year}
                                    on_close={() => set_is_calendar_open(false)}
                                    on_save={(d, m, y) => {
                                        set_due_day(d);
                                        set_due_month(m);
                                        set_due_year(y);
                                    }}
                                />
                            ) : null}
                        </div>
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label>Prioridad</label>
                            <div className="bold_pill_select_wrap">
                                <span className={`priority_pill_badge priority_pill_${priority.toLowerCase()}`}>
                                    {priority.toUpperCase()}
                                </span>
                                <span className="chevron_icon">{render_icon(chevron_down_icon, 14)}</span>
                                <select
                                    value={priority}
                                    onChange={(e) => set_priority(e.target.value)}
                                >
                                    <option value="Alta">Alta</option>
                                    <option value="Media">Media</option>
                                    <option value="Baja">Baja</option>
                                </select>
                            </div>
                        </div>

                        <div className="bold_field_group">
                            <label>Sección por defecto</label>
                            <span style={{ fontSize: 13, color: "#64748b", padding: "10px 0" }}>
                                Asignada según sección seleccionada
                            </span>
                        </div>
                    </div>

                    <div className="bold_field_group">
                        <label>Descripción</label>
                        <textarea
                            rows={3}
                            className="bold_textarea"
                            value={description}
                            onChange={(e) => set_description(e.target.value)}
                            placeholder="Agrega contexto, instrucciones o enlaces importantes..."
                        />
                    </div>

                    <div className="bold_field_group">
                        <label>Subtareas</label>
                        <div className="subtasks_list_box">
                            {subtasks.map((st) => (
                                <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ width: 18, height: 18, borderRadius: 4, border: "1.5px solid #cbd5e1" }}></span>
                                    <input
                                        type="text"
                                        className="bold_input_text"
                                        placeholder="Descripción de la subtarea"
                                        value={st.title}
                                        onChange={(e) => handle_update_subtask_title(st.id, e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
                                        onClick={() => handle_remove_subtask_row(st.id)}
                                    >
                                        {render_icon(trash_icon, 15)}
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: "none",
                                    border: "none",
                                    color: "#e22323",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    padding: "4px 0",
                                    alignSelf: "flex-start"
                                }}
                                onClick={handle_add_subtask_row}
                            >
                                {render_icon(plus_icon, 15)}
                                Agregar subtarea
                            </button>
                        </div>
                    </div>

                    <div className="bold_field_group">
                        <label>Archivos adjuntos</label>
                        {attachments.map((att) => (
                            <div key={att.id} className="detail_file_item" style={{ marginBottom: 6 }}>
                                <span className={att.type === "zip" ? "file_badge_zip" : "file_badge_pdf"}>
                                    {(att.type || "pdf").toUpperCase()}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <strong style={{ display: "block", fontSize: 13, color: "#1e293b" }}>{att.name}</strong>
                                    <small style={{ color: "#64748b", fontSize: 11 }}>{att.size}</small>
                                </div>
                            </div>
                        ))}

                        <label className="attachments_dropzone_box">
                            <input
                                type="file"
                                multiple
                                style={{ display: "none" }}
                                onChange={handle_files_selected}
                            />
                            <span style={{ display: "inline-flex", padding: 8, background: "#fee2e2", color: "#e22323", borderRadius: 8 }}>
                                {render_icon(paperclip_icon, 18)}
                            </span>
                            <div className="attachments_dropzone_text">
                                <strong>Arrastra archivos aquí o haz clic para seleccionar</strong>
                                <small>Puedes seleccionar varios archivos</small>
                            </div>
                        </label>
                    </div>
                </div>

                <footer className="bold_modal_footer">
                    <button
                        type="button"
                        className="bold_btn_cancel"
                        onClick={() => set_active_modal(null)}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="bold_btn_submit"
                        onClick={handle_submit}
                    >
                        Crear tarea
                    </button>
                </footer>
            </div>
        </div>
    );
}


// Renders the sharing modal based on the desktop reference asset.
function render_share_modal(set_active_modal) {
    return (
        <div className="modal_overlay" onClick={() => set_active_modal(null)}>
            <section
                className="form_modal share_modal"
                role="dialog"
                aria-modal="true"
                aria-label="Compartir proyecto"
                onClick={(event) => event.stopPropagation()}
            >
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


// Renders the create project modal shown from the sidebar add button.
function render_project_modal(props) {
    const {
        action_label = "Crear proyecto",
        handle_project_color_change,
        handle_submit,
        initial_project_name = "",
        modal_title = "Crear nuevo proyecto",
        project_form_color,
        set_active_modal
    } = props;

    return (
        <div className="modal_overlay" onClick={() => set_active_modal(null)}>
            <form
                className="form_modal project_form_modal"
                role="dialog"
                aria-modal="true"
                aria-label="Crear proyecto"
                onSubmit={handle_submit}
                onClick={(event) => event.stopPropagation()}
            >
                <header className="modal_header">
                    <h2>{modal_title}</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="form_grid">
                    <label className="form_field form_field_full">
                        <span>Nombre del proyecto</span>
                        <input
                            name="project_name"
                            type="text"
                            placeholder="Ej. Campana de octubre"
                            defaultValue={initial_project_name}
                            required
                        />
                    </label>
                    <label className="form_field form_field_full">
                        <span>Workspace</span>
                        <select defaultValue="bold_workspace">
                            <option value="bold_workspace">BOLD Workspace</option>
                        </select>
                    </label>
                    <div className="color_picker">
                        <span>Color del proyecto</span>
                        <div>
                            {project_color_options.map((project_color) => (
                                <button
                                    className={project_form_color === project_color ? "color_swatch color_swatch_active" : "color_swatch"}
                                    key={project_color}
                                    style={{ "--project_color": project_color }}
                                    type="button"
                                    aria-label={`Color ${project_color}`}
                                    onClick={() => handle_project_color_change(project_color)}
                                ></button>
                            ))}
                        </div>
                    </div>
                    <div className="privacy_card">
                        <span className="radio_dot"></span>
                        <div>
                            <strong>Visible para el workspace</strong>
                            <p>Todos los miembros pueden encontrarlo</p>
                        </div>
                    </div>
                </div>
                <footer className="modal_footer">
                    <button className="secondary_button" type="button" onClick={() => set_active_modal(null)}>
                        Cancelar
                    </button>
                    <button className="primary_button" type="submit">
                        {action_label}
                    </button>
                </footer>
            </form>
        </div>
    );
}


// Renders the project overflow menu from the desktop reference.
function render_project_menu(props) {
    const {
        handle_archive_project,
        handle_delete_project,
        handle_duplicate_project,
        handle_export_project_csv,
        handle_open_project_edit,
        handle_save_project_template
    } = props;

    return (
        <div className="project_menu_popover">
            <button type="button" onClick={handle_open_project_edit}>Editar detalles del proyecto <span>Ctrl+E</span></button>
            <button type="button" onClick={handle_duplicate_project}>Duplicar proyecto <span>Ctrl+D</span></button>
            <button type="button" onClick={handle_save_project_template}>Guardar como plantilla</button>
            <button type="button" onClick={handle_export_project_csv}>Exportar como CSV <span>CSV</span></button>
            <button type="button" onClick={handle_archive_project}>Archivar proyecto</button>
            <button className="danger_menu_item" type="button" onClick={handle_delete_project}>Eliminar proyecto</button>
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

export default function task_app() {
    const [active_module, set_active_module] = use_state("tasks");
    const [active_view, set_active_view] = use_state("list");
    const [active_modal, set_active_modal] = use_state(null);
    const [is_sidebar_open, set_is_sidebar_open] = use_state(false);
    const [is_tasks_menu_open, set_is_tasks_menu_open] = use_state(true);
    const [search_query, set_search_query] = use_state("");
    const [projects, set_projects] = use_state(project_items);
    const [active_project_id, set_active_project_id] = use_state("launch_q4");
    const [active_task_scope, set_active_task_scope] = use_state("project");
    const [project_form_color, set_project_form_color] = use_state(project_color_options[0]);
    const [tasks, set_tasks] = use_state(starter_tasks);
    const [selected_task_id, set_selected_task_id] = use_state(null);
    const [draft_subtasks, set_draft_subtasks] = use_state([]);
    const [draft_attachments, set_draft_attachments] = use_state([]);
    const [edit_draft, set_edit_draft] = use_state(null);
    const [edit_original, set_edit_original] = use_state(null);
    const [edit_attachments, set_edit_attachments] = use_state([]);
    const [active_task_tool, set_active_task_tool] = use_state(null);
    const [is_compact_view, set_is_compact_view] = use_state(false);
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
    const [is_notifications_open, set_is_notifications_open] = use_state(false);
    const [board_columns, set_board_columns] = use_state(default_board_columns);
    const [dragged_task_id, set_dragged_task_id] = use_state(null);
    const [is_adding_column, set_is_adding_column] = use_state(false);
    const [new_column_name, set_new_column_name] = use_state("");
    const [schedule_view, set_schedule_view] = use_state("timeline");

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
    const [notifications, set_notifications] = use_state(notification_items);

    const current_user = use_memo(() => get_member(current_user_id), []);
    const active_projects = use_memo(() => projects.filter((project_item) => !project_item.archived), [
        projects
    ]);
    const selected_project = use_memo(() => get_project(active_project_id, projects), [
        active_project_id,
        projects
    ]);
    const scoped_tasks = use_memo(() => {
        if (active_task_scope === "my_tasks") {
            return tasks.filter((task_item) => task_item.assignee_id === current_user_id);
        }

        return tasks.filter((task_item) => task_item.project_id === active_project_id);
    }, [
        active_project_id,
        active_task_scope,
        tasks
    ]);

    const filtered_tasks = use_memo(() => {
        const by_search = get_filtered_tasks(scoped_tasks, search_query, projects);
        const by_filters = get_tasks_matching_active_filters(by_search, active_filters);

        return get_sorted_tasks(by_filters, sort_field, sort_direction);
    }, [
        active_filters,
        projects,
        search_query,
        scoped_tasks,
        sort_direction,
        sort_field
    ]);

    const selected_task = use_memo(() => {
        if (active_modal !== "detail") {
            return null;
        }

        return tasks.find((task_item) => task_item.id === selected_task_id) || null;
    }, [
        active_modal,
        selected_task_id,
        tasks
    ]);
    const default_task_project_id = active_projects.some((project_item) => project_item.id === active_project_id)
        ? active_project_id
        : active_projects[0]?.id || active_project_id;


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
                        set_tasks(backend_tasks);
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


    // Clears the create-task draft (subtasks/attachments) each time the
    // "Crear nueva tarea" modal is opened, so leftover rows from a previous
    // open don't reappear.
    use_effect(() => {
        if (active_modal === "task") {
            set_draft_subtasks([]);
            set_draft_attachments([]);
        }

        if (active_modal === "project") {
            set_project_form_color(project_color_options[0]);
        }
    }, [active_modal]);


    // Closes floating panels when the user clicks outside their trigger/content.
    use_effect(() => {
        const has_open_floating_panel = active_task_tool || is_notifications_open || active_modal === "project_menu";

        if (!has_open_floating_panel) {
            return undefined;
        }

        function handle_document_pointer_down(event) {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            if (active_task_tool && !target.closest(".task_tool_anchor")) {
                set_active_task_tool(null);
            }

            if (is_notifications_open && !target.closest(".notifications_panel") && !target.closest(".bell_button")) {
                set_is_notifications_open(false);
            }

            if (
                active_modal === "project_menu"
                && !target.closest(".project_menu_popover")
                && !target.closest("[data-project-menu-trigger='true']")
            ) {
                set_active_modal(null);
            }
        }

        document.addEventListener("pointerdown", handle_document_pointer_down);

        return () => {
            document.removeEventListener("pointerdown", handle_document_pointer_down);
        };
    }, [
        active_modal,
        active_task_tool,
        is_notifications_open
    ]);


    // Opens/closes one of the Ordenar/Filtrar/Personalizar dropdown panels,
    // closing the others if one is already open.
    function handle_toggle_task_tool(tool_id) {
        set_is_notifications_open(false);
        set_active_task_tool((current_tool) => (current_tool === tool_id ? null : tool_id));
    }

    function handle_close_task_tool() {
        set_active_task_tool(null);
    }


    // Opens/closes the notifications dropdown panel from the top bar bell.
    function handle_toggle_notifications() {
        set_active_task_tool(null);
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


    // Toggles the denser row spacing used by "Vista compacta".
    function handle_toggle_compact_view() {
        set_is_compact_view((current_value) => !current_value);
    }


    // Changes the active shell module and closes mobile navigation.
    function handle_module_change(module_id) {
        set_active_module(module_id);
        set_is_sidebar_open(false);
        set_selected_task_id(null);
        set_active_modal(null);
    }

    function handle_tasks_menu_toggle() {
        set_active_module("tasks");
        set_selected_task_id(null);
        set_active_modal(null);
        set_is_tasks_menu_open((current_value) => !current_value);
    }

    function handle_project_select(project_id) {
        set_active_module("tasks");
        set_active_task_scope("project");
        set_active_project_id(project_id);
        set_is_sidebar_open(false);
        set_selected_task_id(null);
        set_active_modal(null);
    }

    function handle_my_tasks_select() {
        set_active_module("tasks");
        set_active_task_scope("my_tasks");
        set_is_sidebar_open(false);
        set_selected_task_id(null);
        set_active_modal(null);
    }

    function handle_open_project_modal() {
        set_project_form_color(project_color_options[0]);
        set_active_modal("project");
    }


    // Opens the "Editar tarea" modal from any project view, seeding the
    // edit draft (and its original snapshot, used for dirty-field
    // highlighting) from the selected task's current values.
    function handle_task_select(task_id) {
        const task_item = tasks.find((current_task) => current_task.id === task_id);
        const draft_snapshot = {
            title: task_item.title,
            description: task_item.description,
            project_id: task_item.project_id,
            section: task_item.section,
            assignee_id: task_item.assignee_id,
            due_day: task_item.due_day,
            priority: task_item.priority,
            status: task_item.status
        };

        set_selected_task_id(task_id);
        set_edit_draft(draft_snapshot);
        set_edit_original(draft_snapshot);
        set_edit_attachments(task_item.attachment_name ? [{ id: "existing_attachment", name: task_item.attachment_name }] : []);
        set_active_modal("detail");
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


    // Adds/updates/removes a draft subtask row in the "Crear nueva tarea" modal.
    function handle_add_draft_subtask() {
        set_draft_subtasks((current_subtasks) => [
            ...current_subtasks,
            { id: `draft_sub_${Date.now()}`, title: "" }
        ]);
    }

    function handle_update_draft_subtask(subtask_id, title) {
        set_draft_subtasks((current_subtasks) => current_subtasks.map((subtask_item) => (
            subtask_item.id === subtask_id ? { ...subtask_item, title } : subtask_item
        )));
    }

    function handle_remove_draft_subtask(subtask_id) {
        set_draft_subtasks((current_subtasks) => current_subtasks.filter((subtask_item) => subtask_item.id !== subtask_id));
    }


    // Simulates picking a file from the "Archivos adjuntos" dropzone in the
    // "Crear nueva tarea" modal — there is no real upload backend yet, so this
    // just appends a mock file entry the user can remove again.
    function handle_add_draft_attachment() {
        set_draft_attachments((current_attachments) => [
            ...current_attachments,
            { id: `draft_file_${Date.now()}`, name: `archivo_${current_attachments.length + 1}.pdf` }
        ]);
    }

    function handle_remove_draft_attachment(attachment_id) {
        set_draft_attachments((current_attachments) => current_attachments.filter((attachment_item) => attachment_item.id !== attachment_id));
    }


    // Creates a task optimistically, then swaps its temporary id for the
    // real backend id once create_task_request resolves.
    function handle_create_task_submit(event) {
        event.preventDefault();

        const form_data = new FormData(event.currentTarget);
        const new_task = {
            ...build_new_task(form_data),
            subtasks: draft_subtasks
                .filter((subtask_item) => subtask_item.title.trim())
                .map((subtask_item) => ({ ...subtask_item, completed: false })),
            attachment_name: draft_attachments.length ? draft_attachments[draft_attachments.length - 1].name : "documento.pdf"
        };
        const temporary_id = new_task.id;

        set_tasks((current_tasks) => [
            ...current_tasks,
            new_task
        ]);
        publish_task_event(create_task_event(task_event_types.task_created, new_task.id, new_task));
        set_active_modal(null);
        set_active_view("list");

        create_task_request(new_task)
            .then((created_task) => {
                set_tasks((current_tasks) => current_tasks.map((task_item) => (
                    task_item.id === temporary_id ? created_task : task_item
                )));
            })
            .catch((error) => {
                console.warn("No se pudo crear la tarea en el backend.", error);
            });
    }


    // Creates a project locally and switches the workspace view to it.
    function handle_create_project_submit(event) {
        event.preventDefault();

        const form_data = new FormData(event.currentTarget);
        const project_name = (form_data.get("project_name") || "").toString().trim();

        if (!project_name) {
            return;
        }

        const new_project = {
            id: build_project_id(project_name, projects),
            label: project_name,
            color: project_form_color
        };

        set_projects((current_projects) => [
            ...current_projects,
            new_project
        ]);
        set_active_project_id(new_project.id);
        set_active_task_scope("project");
        set_is_tasks_menu_open(true);
        set_active_view("list");
        set_active_modal(null);
    }

    function handle_open_project_edit() {
        set_project_form_color(selected_project.color);
        set_active_modal("project_edit");
    }

    function handle_save_project_edits(event) {
        event.preventDefault();

        const form_data = new FormData(event.currentTarget);
        const project_name = (form_data.get("project_name") || "").toString().trim();

        if (!project_name) {
            return;
        }

        set_projects((current_projects) => current_projects.map((project_item) => (
            project_item.id === selected_project.id
                ? { ...project_item, label: project_name, color: project_form_color }
                : project_item
        )));
        set_active_modal(null);
    }

    function handle_duplicate_project() {
        const duplicated_project = {
            ...selected_project,
            id: build_project_id(`${selected_project.label} copia`, projects),
            label: `${selected_project.label} copia`,
            archived: false
        };
        const created_at = Date.now();
        const copied_tasks = tasks
            .filter((task_item) => task_item.project_id === selected_project.id)
            .map((task_item, index) => ({
                ...task_item,
                id: `task_${created_at}_${index}`,
                project_id: duplicated_project.id,
                completed: false,
                section: task_item.section === "completed" ? "todo" : task_item.section,
                status: task_item.section === "completed" ? "Pend." : task_item.status
            }));

        set_projects((current_projects) => [
            ...current_projects,
            duplicated_project
        ]);
        set_tasks((current_tasks) => [
            ...current_tasks,
            ...copied_tasks
        ]);
        set_active_project_id(duplicated_project.id);
        set_active_task_scope("project");
        set_active_view("list");
        set_active_modal(null);
    }

    function handle_save_project_template() {
        set_notifications((current_notifications) => [
            {
                id: `notif_template_${Date.now()}`,
                type: "status_changed",
                actor_id: current_user_id,
                title: "Proyecto guardado como plantilla",
                body: `${selected_project.label} ya esta disponible como plantilla local.`,
                time_label: "Ahora",
                is_read: false
            },
            ...current_notifications
        ]);
        set_active_modal(null);
    }

    function handle_export_project_csv() {
        const project_tasks = tasks.filter((task_item) => task_item.project_id === selected_project.id);
        const csv_body = build_tasks_csv(project_tasks, projects);
        const filename = `${get_file_safe_name(selected_project.label)}-tareas.csv`;

        download_text_file(filename, csv_body, "text/csv;charset=utf-8");
        set_active_modal(null);
    }

    function handle_archive_project() {
        const next_project = active_projects.find((project_item) => project_item.id !== selected_project.id);

        set_projects((current_projects) => current_projects.map((project_item) => (
            project_item.id === selected_project.id ? { ...project_item, archived: true } : project_item
        )));

        if (next_project) {
            set_active_project_id(next_project.id);
            set_active_task_scope("project");
        } else {
            set_active_task_scope("my_tasks");
        }

        set_active_view("list");
        set_active_modal(null);
    }

    function handle_delete_project() {
        const next_project = active_projects.find((project_item) => project_item.id !== selected_project.id);

        set_projects((current_projects) => current_projects.filter((project_item) => project_item.id !== selected_project.id));
        set_tasks((current_tasks) => current_tasks.filter((task_item) => task_item.project_id !== selected_project.id));

        if (next_project) {
            set_active_project_id(next_project.id);
            set_active_task_scope("project");
        } else {
            set_active_task_scope("my_tasks");
        }

        set_active_view("list");
        set_active_modal(null);
    }


    // Deletes a task through the backend and removes it from local state.
    function handle_delete_task(task_id) {
        delete_task_request(task_id)
            .then(() => {
                set_tasks((current_tasks) => current_tasks.filter((task_item) => task_item.id !== task_id));
                set_active_modal(null);
                set_selected_task_id(null);
            })
            .catch((error) => {
                console.warn("No se pudo eliminar la tarea en el backend.", error);
            });
    }


    // Toggles one subtask's completed state, optimistically and through the backend.
    function handle_toggle_subtask(task_id, subtask_id) {
        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) {
                return task_item;
            }

            return {
                ...task_item,
                subtasks: task_item.subtasks.map((subtask_item) => (
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


    // Adds a comment to the selected task, optimistically and through the backend.
    function handle_add_comment_submit(event, task_id) {
        event.preventDefault();

        const form_data = new FormData(event.currentTarget);
        const comment_body = (form_data.get("comment_body") || "").toString().trim();

        if (!comment_body) {
            return;
        }

        event.currentTarget.reset();

        add_comment_request(task_id, comment_body, current_user?.name || "Joaquin Sierra")
            .then((new_comment) => {
                set_tasks((current_tasks) => current_tasks.map((task_item) => (
                    task_item.id === task_id
                        ? { ...task_item, comments: [...(task_item.comments || []), new_comment] }
                        : task_item
                )));
            })
            .catch((error) => {
                console.warn("No se pudo agregar el comentario en el backend.", error);
            });
    }


    // Updates one field of the "Editar tarea" draft as the user types/selects,
    // used both to control the inputs and to compute dirty-field highlighting
    // against edit_original.
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

        const due_label = `${edit_draft.due_day} sep`;
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
        if (active_modal === "task") {
            return render_task_form_modal({
                draft_attachments,
                draft_subtasks,
                handle_add_draft_attachment,
                handle_add_draft_subtask,
                handle_remove_draft_attachment,
                handle_remove_draft_subtask,
                handle_submit: handle_create_task_submit,
                handle_update_draft_subtask,
                mode: "create",
                projects: active_projects,
                default_project_id: default_task_project_id,
                set_active_modal
            });
        }

        if (active_modal === "share") {
            return render_share_modal(set_active_modal);
        }

        if (active_modal === "project") {
            return render_project_modal({
                handle_project_color_change: set_project_form_color,
                handle_submit: handle_create_project_submit,
                project_form_color,
                set_active_modal
            });
        }

        if (active_modal === "project_edit") {
            return render_project_modal({
                action_label: "Guardar cambios",
                handle_project_color_change: set_project_form_color,
                handle_submit: handle_save_project_edits,
                initial_project_name: selected_project.label,
                modal_title: "Editar detalles del proyecto",
                project_form_color,
                set_active_modal
            });
        }

        if (active_modal === "project_menu") {
            return render_project_menu({
                handle_archive_project,
                handle_delete_project,
                handle_duplicate_project,
                handle_export_project_csv,
                handle_open_project_edit,
                handle_save_project_template
            });
        }

        if (selected_task && edit_draft) {
            return render_task_form_modal({
                edit_attachments,
                edit_draft,
                edit_original,
                handle_add_comment_submit,
                handle_add_edit_attachment,
                handle_delete_task,
                handle_edit_field_change,
                handle_remove_edit_attachment,
                handle_submit: (event) => handle_save_task_edits(event, selected_task.id),
                handle_toggle_subtask,
                handle_toggle_task,
                mode: "edit",
                projects: active_projects,
                default_project_id: default_task_project_id,
                selected_task,
                set_active_modal
            });
        }

        return null;
    }


    // Returns the full shell with the focused tasks module.
    return (
        <div className={`app_shell ${is_sidebar_open ? "app_shell_with_mobile_sidebar" : ""}`}>
            {render_sidebar({
                active_project_id,
                active_module,
                active_task_scope,
                handle_module_change,
                handle_my_tasks_select,
                handle_open_project_modal,
                handle_project_select,
                handle_tasks_menu_toggle,
                is_sidebar_open,
                is_tasks_menu_open,
                current_user,
                projects: active_projects,
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
                    active_task_scope,
                    active_task_tool,
                    active_view,
                    board_columns,
                    dragged_task_id,
                    filtered_tasks,
                    handle_add_column,
                    handle_clear_filters,
                    handle_close_task_tool,
                    handle_column_drop,
                    handle_drag_start,
                    handle_task_select,
                    handle_toggle_compact_view,
                    handle_toggle_filter_value,
                    handle_toggle_task,
                    handle_toggle_task_tool,
                    handle_toggle_visible_field,
                    is_adding_column,
                    is_compact_view,
                    new_column_name,
                    search_query,
                    scoped_tasks,
                    selected_project,
                    set_active_modal,
                    set_active_view,
                    set_is_adding_column,
                    set_new_column_name,
                    set_search_query,
                    set_sort_direction,
                    set_sort_field,
                    sort_direction,
                    sort_field,
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
