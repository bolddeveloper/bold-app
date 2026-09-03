import { createElement as create_element, useEffect as use_effect, useMemo as use_memo, useState as use_state } from "react";
import {
    ArrowLeft as arrow_left_icon,
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
<<<<<<< Updated upstream
=======
    Pencil as pencil_icon,
>>>>>>> Stashed changes
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
    const primary_navigation_items = navigation_items.slice(0, 2);

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
                    {navigation_items.slice(2).map((item) => render_navigation_item(item, active_module, handle_module_change))}
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
        active_task_scope,
        active_task_tool,
        active_view,
        current_user,
        filtered_tasks,
        handle_clear_filters,
        handle_close_task_tool,
        handle_task_select,
        handle_toggle_compact_view,
        handle_toggle_filter_value,
        handle_toggle_task,
        handle_toggle_task_tool,
        handle_toggle_visible_field,
        is_compact_view,
        projects,
        search_query,
        scoped_tasks,
        selected_project,
        set_active_modal,
        set_active_view,
        set_search_query,
        set_sort_direction,
        set_sort_field,
        sort_direction,
        sort_field,
        visible_fields
    } = props;

    const completed_count = scoped_tasks.filter((task_item) => task_item.completed).length;
    const completion_percent = scoped_tasks.length ? Math.round((completed_count / scoped_tasks.length) * 100) : 0;
    const is_my_tasks_scope = active_task_scope === "my_tasks";
    const project_title = is_my_tasks_scope ? "Mis tareas" : selected_project.label;
    const project_subtitle = is_my_tasks_scope
        ? `Tareas asignadas a ${current_user?.name || "mi usuario"}`
        : `Proyecto de BOLD Workspace`;
    const breadcrumb_tail = is_my_tasks_scope ? " / MIS TAREAS" : ` / PROYECTOS / ${selected_project.label.toUpperCase()}`;
    const empty_state = scoped_tasks.length ? {
        title: "No encontramos tareas",
        body: "Prueba cambiando o eliminando los filtros activos.",
        action_label: "Limpiar filtros",
        on_action: () => {
            handle_clear_filters();
            set_search_query("");
        }
    } : {
        title: "No hay tareas en esta vista",
        body: is_my_tasks_scope ? "Cuando tengas tareas asignadas apareceran aqui." : "Agrega una tarea para comenzar este proyecto.",
        action_label: is_my_tasks_scope ? "" : "Agregar tarea",
        on_action: is_my_tasks_scope ? null : () => set_active_modal("task")
    };

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
                    <button className="icon_button" type="button" aria-label="Mas opciones" onClick={() => set_active_modal("project_menu")}>
                        {render_icon(more_horizontal_icon, 22)}
                    </button>
                </div>
            </div>

            <div className="task_tabs_row">
                <div className="view_tabs" role="tablist" aria-label="Vistas del proyecto">
                    {view_items.map((view_item) => (
                        <button
                            className={`view_tab ${active_view === view_item.id ? "view_tab_active" : ""}`}
                            key={view_item.id}
                            type="button"
                            role="tab"
                            aria-selected={active_view === view_item.id}
                            onClick={() => set_active_view(view_item.id)}
                        >
                            <span className="desktop_tab_icon">{render_icon(view_item.icon, 16)}</span>
                            {view_item.label}
                        </button>
                    ))}
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
                    <button
                        className={`compact_button ${is_compact_view ? "compact_button_active" : ""}`}
                        type="button"
                        onClick={handle_toggle_compact_view}
                    >
                        Vista compacta
                    </button>
                </div>
                <button className="mobile_filter_button" type="button" onClick={() => set_search_query(search_query ? "" : "zzz")}>
                    {render_icon(sliders_icon, 15)}
                    Filtrar
                </button>
                <button className="mobile_floating_add" type="button" aria-label="Agregar tarea" onClick={() => set_active_modal("task")}>
                    {render_icon(plus_icon, 28)}
                </button>
            </div>

            {active_view === "list" ? render_list_view({
                completed_count,
                completion_percent,
                empty_state,
                filtered_tasks,
                handle_task_select,
                handle_toggle_task,
                is_compact_view,
                projects,
                set_active_modal,
                tasks: scoped_tasks,
                visible_fields
            }) : null}

            {active_view === "board" ? render_board_view({
                empty_state,
                filtered_tasks,
                handle_task_select,
                handle_toggle_task,
                projects
            }) : null}

            {active_view === "timeline" ? render_timeline_view() : null}

            {active_view === "calendar" ? render_calendar_view({
                empty_state,
                filtered_tasks,
                handle_task_select,
                set_active_modal
            }) : null}
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
        completed_count,
        completion_percent,
        empty_state,
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
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
        <div className={`list_view ${is_compact_view ? "list_view_compact" : ""}`}>
            <div className="mobile_only">
                {render_progress_card(tasks, completed_count, completion_percent)}
            </div>

            <div className="task_table_card desktop_only">
                <div className="table_actions">
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

                {task_sections.map((section_item) => render_task_group({
                    filtered_tasks,
                    handle_task_select,
                    handle_toggle_task,
                    projects,
                    section_item,
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
                {task_sections.map((section_item) => render_mobile_section({
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
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
        projects,
        section_item,
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
                <strong>{section_item.label}</strong>
                <span>{section_tasks.length}</span>
            </div>
            {section_tasks.map((task_item) => render_task_row({
                handle_task_select,
                handle_toggle_task,
                projects,
                task_item,
                visible_fields
            }))}
        </div>
    );
}


// Renders one task row in desktop list view.
function render_task_row(props) {
    const {
        handle_task_select,
        handle_toggle_task,
        projects,
        task_item,
        visible_fields
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id, projects);

    return (
        <div
            className={`task_row ${task_item.completed ? "task_row_completed" : ""}`}
            key={task_item.id}
            style={get_task_table_columns_style(visible_fields, true)}
        >
            <button
                className={`task_checkbox ${task_item.completed ? "task_checkbox_checked" : ""}`}
                type="button"
                aria-label="Completar tarea"
                onClick={() => handle_toggle_task(task_item.id)}
            >
                {task_item.completed ? render_icon(check_icon, 13) : null}
            </button>
            <button className="task_name_button" type="button" onClick={() => handle_task_select(task_item.id)}>
                {task_item.title}
            </button>
            {visible_fields.assignee ? (
                <span className="task_assignee">
                    {render_avatar(member_item, "avatar_small")}
                </span>
            ) : null}
            {visible_fields.date ? <span className="task_date">{task_item.due_label}</span> : null}
            {visible_fields.priority ? (
                <span className={`task_badge priority_badge ${get_priority_class(task_item.priority)}`}>
                    {task_item.priority}
                </span>
            ) : null}
            {visible_fields.status ? (
                <span className={`task_badge status_badge ${get_status_class(task_item.status)}`}>
                    {task_item.status}
                </span>
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
        empty_state,
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
        projects
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(empty_state);
    }

    return (
        <div className="board_view">
            {task_sections.map((section_item) => {
                const section_tasks = get_tasks_by_section(filtered_tasks, section_item.id);

                return (
                    <section className="board_column" key={section_item.id}>
                        <header>
                            <h2>{section_item.label}</h2>
                            <span>{section_tasks.length}</span>
                        </header>
                        <div className="board_card_stack">
                            {section_tasks.map((task_item) => render_board_card({
                                handle_task_select,
                                handle_toggle_task,
                                projects,
                                task_item
                            }))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}


// Renders a task card inside the board view.
function render_board_card(props) {
    const {
        handle_task_select,
        handle_toggle_task,
        projects,
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id, projects);

    return (
        <article className="board_card" key={task_item.id}>
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


<<<<<<< Updated upstream
// Renders one editable subtask row inside the create-mode draft list
// (free-text title + remove button).
function render_draft_subtask_row(subtask_item, handle_update_draft_subtask, handle_remove_draft_subtask) {
    return (
        <div className="subtask_draft_row" key={subtask_item.id}>
            <input
                type="text"
                value={subtask_item.title}
                placeholder="Nombre de la subtarea"
                onChange={(event) => handle_update_draft_subtask(subtask_item.id, event.target.value)}
            />
            <button
                type="button"
                aria-label="Quitar subtarea"
                onClick={() => handle_remove_draft_subtask(subtask_item.id)}
            >
                {render_icon(trash_icon, 15)}
            </button>
=======
// Renders the task detail sheet for desktop and mobile.
function render_task_detail_panel(props) {
    const {
        handle_delete_task,
        handle_open_edit_task,
        handle_toggle_task,
        selected_task,
        set_active_modal
    } = props;
    const member_item = get_member(selected_task.assignee_id);
    const project_item = get_project(selected_task.project_id);
    const completed_subtasks = selected_task.subtasks.filter((subtask_item) => subtask_item.completed).length;

    return (
        <div className="modal_overlay detail_overlay">
            <section className="task_detail_sheet" role="dialog" aria-modal="true" aria-label="Detalle de tarea">
                <div className="detail_mobile_title">
                    <button className="mobile_menu_button" type="button" aria-label="Volver" onClick={() => set_active_modal(null)}>
                        {render_icon(arrow_left_icon, 24)}
                    </button>
                    <h2>Detalle de tarea</h2>
                    <button
                        className="mobile_more_button"
                        type="button"
                        aria-label="Editar tarea"
                        onClick={() => handle_open_edit_task(selected_task.id)}
                    >
                        {render_icon(pencil_icon, 18)}
                    </button>
                </div>

                <div className="detail_header">
                    <div className="detail_header_top_actions">
                        <button
                            className="detail_edit_action_btn"
                            type="button"
                            onClick={() => handle_open_edit_task(selected_task.id)}
                        >
                            {render_icon(pencil_icon, 14)}
                            <span>Editar</span>
                        </button>
                        <button className="detail_close_button" type="button" aria-label="Cerrar detalle" onClick={() => set_active_modal(null)}>
                            {render_icon(x_icon, 22)}
                        </button>
                    </div>
                    <p className="breadcrumb_text">{project_item.label.toUpperCase()}</p>
                    <button
                        className={`detail_checkbox ${selected_task.completed ? "task_checkbox_checked" : ""}`}
                        type="button"
                        aria-label="Completar tarea"
                        onClick={() => handle_toggle_task(selected_task.id)}
                    >
                        {selected_task.completed ? render_icon(check_icon, 18) : null}
                    </button>
                    <h1>{selected_task.title}</h1>
                    <div className="detail_badges">
                        <span className={`task_badge status_badge ${get_status_class(selected_task.status)}`}>
                            {selected_task.status}
                        </span>
                        <span className="project_chip">
                            {render_project_dot(project_item.color)}
                            {project_item.label}
                        </span>
                    </div>
                </div>

                <div className="detail_info_card">
                    <div className="detail_info_row">
                        {render_avatar(member_item, "avatar_medium")}
                        <div>
                            <span>Responsable</span>
                            <strong>{member_item?.name || "Sin responsable"}</strong>
                        </div>
                        {render_icon(chevron_down_icon, 18)}
                    </div>
                    <div className="detail_info_row">
                        <span className="date_tile">{String(selected_task.due_day).padStart(2, "0")}</span>
                        <div>
                            <span>Fecha limite</span>
                            <strong>{selected_task.due_day} de septiembre - Hoy</strong>
                        </div>
                        <span className="danger_pill">Vence hoy</span>
                    </div>
                    <div className="detail_info_row">
                        {render_icon(archive_icon, 24)}
                        <div>
                            <span>Prioridad</span>
                            <strong>{selected_task.priority}</strong>
                        </div>
                        <span className={`task_badge priority_badge ${get_priority_class(selected_task.priority)}`}>
                            {selected_task.priority}
                        </span>
                    </div>
                </div>

                <section className="detail_section">
                    <div className="section_title_row">
                        <h2>Descripcion</h2>
                        <button type="button" onClick={() => handle_open_edit_task(selected_task.id)}>Editar</button>
                    </div>
                    <p>{selected_task.description}</p>
                </section>

                <section className="detail_section">
                    <div className="section_title_row">
                        <h2>Subtareas</h2>
                        <span>{completed_subtasks} de {selected_task.subtasks.length || 0}</span>
                        <button type="button" onClick={() => handle_open_edit_task(selected_task.id)}>+ Gestionar</button>
                    </div>
                    <span className="subtask_progress">
                        <span style={{ width: selected_task.subtasks.length ? `${(completed_subtasks / selected_task.subtasks.length) * 100}%` : "0%" }}></span>
                    </span>
                    <div className="subtask_list">
                        {selected_task.subtasks.length ? selected_task.subtasks.map((subtask_item) => (
                            <div className="subtask_item" key={subtask_item.id}>
                                <span className={`task_checkbox ${subtask_item.completed ? "task_checkbox_checked" : ""}`}>
                                    {subtask_item.completed ? render_icon(check_icon, 13) : null}
                                </span>
                                <span className={subtask_item.completed ? "completed_text" : ""}>{subtask_item.title}</span>
                            </div>
                        )) : (
                            <div className="subtask_item">
                                <span className="task_checkbox"></span>
                                <span>Sin subtareas creadas</span>
                            </div>
                        )}
                    </div>
                </section>

                <section className="detail_section">
                    <div className="section_title_row">
                        <h2>Archivo adjunto</h2>
                        <button type="button" onClick={() => handle_open_edit_task(selected_task.id)}>+ Agregar</button>
                    </div>
                    {selected_task.attachments && selected_task.attachments.length > 0 ? (
                        selected_task.attachments.map((att) => (
                            <div className="attachment_card" key={att.id} style={{ marginBottom: 8 }}>
                                <span>{(att.type || "pdf").toUpperCase()}</span>
                                <div>
                                    <strong>{att.name}</strong>
                                    <small>{att.size} - Actualizado hoy</small>
                                </div>
                                {render_icon(download_icon, 17)}
                            </div>
                        ))
                    ) : selected_task.attachment_name ? (
                        <div className="attachment_card">
                            <span>PDF</span>
                            <div>
                                <strong>{selected_task.attachment_name}</strong>
                                <small>2.4 MB - Actualizado hoy</small>
                            </div>
                            {render_icon(download_icon, 17)}
                        </div>
                    ) : (
                        <p style={{ color: "#7a808a", fontSize: "13px" }}>No hay archivos adjuntos.</p>
                    )}
                </section>

                <section className="detail_section">
                    <button
                        className="danger_menu_item"
                        type="button"
                        onClick={() => handle_delete_task(selected_task.id)}
                    >
                        Eliminar tarea
                    </button>
                </section>

                <div className="comment_bar">
                    <span className="profile_avatar">JS</span>
                    <input type="text" placeholder="Escribe un comentario..." />
                    <button type="button" aria-label="Enviar comentario">
                        {render_icon(send_icon, 20)}
                    </button>
                </div>
            </section>
>>>>>>> Stashed changes
        </div>
    );
}


<<<<<<< Updated upstream
// Renders one read-only subtask row inside the edit-mode list (checkbox +
// title + overflow menu placeholder, matching the reference design).
function render_edit_subtask_row(subtask_item, task_id, handle_toggle_subtask) {
    return (
        <div className="subtask_item" key={subtask_item.id}>
            <button
                className={`task_checkbox ${subtask_item.completed ? "task_checkbox_checked" : ""}`}
                type="button"
                aria-label="Completar subtarea"
                onClick={() => handle_toggle_subtask(task_id, subtask_item.id)}
            >
                {subtask_item.completed ? render_icon(check_icon, 13) : null}
            </button>
            <span className={subtask_item.completed ? "completed_text" : ""}>{subtask_item.title}</span>
            <button className="subtask_menu_button" type="button" aria-label="Mas opciones de la subtarea">
                {render_icon(more_vertical_icon, 15)}
            </button>
=======
// Renders the Edit Task modal replicating the reference design with full subtask management.
function EditTaskModal(props) {
    const {
        handle_save_edit_task,
        selected_task,
        set_active_modal
    } = props;

    const [title, set_title] = use_state(selected_task?.title || "");
    const [project_id, set_project_id] = use_state(selected_task?.project_id || "launch_q4");
    const [section, set_section] = use_state(selected_task?.section || "in_progress");
    const [assignee_id, set_assignee_id] = use_state(selected_task?.assignee_id || "david_urbina");
    const [due_day, set_due_day] = use_state(selected_task?.due_day || 8);
    const [priority, set_priority] = use_state(selected_task?.priority || "Alta");
    const [status, set_status] = use_state(selected_task?.status || "Activa");
    const [description, set_description] = use_state(selected_task?.description || "");

    // Subtasks state
    const [subtasks, set_subtasks] = use_state(selected_task?.subtasks || []);
    const [is_adding_subtask, set_is_adding_subtask] = use_state(false);
    const [new_subtask_text, set_new_subtask_text] = use_state("");
    const [editing_subtask_id, set_editing_subtask_id] = use_state(null);
    const [editing_subtask_text, set_editing_subtask_text] = use_state("");
    const [active_subtask_menu_id, set_active_subtask_menu_id] = use_state(null);

    // Attachments state
    const initial_attachments = Array.isArray(selected_task?.attachments) && selected_task.attachments.length > 0
        ? selected_task.attachments
        : selected_task?.attachment_name
            ? [
                {
                    id: "att_001",
                    name: selected_task.attachment_name,
                    size: "2.4 MB",
                    type: selected_task.attachment_name.endsWith(".zip") ? "zip" : "pdf"
                }
            ]
            : [];
    const [attachments, set_attachments] = use_state(initial_attachments);

    // Close 3-dots popover on outside click
    use_effect(() => {
        function handle_click_outside(e) {
            if (active_subtask_menu_id && !e.target.closest(".edit_subtask_menu_container")) {
                set_active_subtask_menu_id(null);
            }
        }
        window.addEventListener("click", handle_click_outside);
        return () => window.removeEventListener("click", handle_click_outside);
    }, [active_subtask_menu_id]);

    const completed_count = subtasks.filter((item) => item.completed).length;
    const current_assignee = get_member(assignee_id);

    function handle_toggle_subtask(subtask_id) {
        set_subtasks((current) => current.map((item) => (
            item.id === subtask_id ? { ...item, completed: !item.completed } : item
        )));
    }

    function handle_add_subtask() {
        const trimmed = new_subtask_text.trim();
        if (!trimmed) return;
        const new_item = {
            id: `subtask_${Date.now()}`,
            title: trimmed,
            completed: false
        };
        set_subtasks((current) => [...current, new_item]);
        set_new_subtask_text("");
        set_is_adding_subtask(false);
    }

    function handle_save_edited_subtask(subtask_id) {
        const trimmed = editing_subtask_text.trim();
        if (!trimmed) return;
        set_subtasks((current) => current.map((item) => (
            item.id === subtask_id ? { ...item, title: trimmed } : item
        )));
        set_editing_subtask_id(null);
        set_editing_subtask_text("");
    }

    function handle_delete_subtask(subtask_id) {
        set_subtasks((current) => current.filter((item) => item.id !== subtask_id));
        if (active_subtask_menu_id === subtask_id) {
            set_active_subtask_menu_id(null);
        }
    }

    function handle_file_upload(e) {
        const files = e.target.files;
        if (!files || !files.length) return;
        const new_items = Array.from(files).map((file) => {
            const ext = file.name.split(".").pop().toLowerCase();
            const size_mb = (file.size / (1024 * 1024)).toFixed(1);
            return {
                id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                name: file.name,
                size: `${size_mb > 0 ? size_mb : "0.1"} MB`,
                type: ext === "zip" || ext === "rar" ? "zip" : ext === "pdf" ? "pdf" : "file"
            };
        });
        set_attachments((current) => [...current, ...new_items]);
        e.target.value = "";
    }

    function handle_delete_attachment(att_id) {
        set_attachments((current) => current.filter((item) => item.id !== att_id));
    }

    function handle_submit(e) {
        if (e) e.preventDefault();
        const updated_task = {
            ...selected_task,
            title: title.trim() || selected_task.title,
            project_id,
            section,
            assignee_id,
            due_day,
            due_label: `${due_day} sep`,
            priority,
            status,
            description,
            completed: section === "completed" || status === "Lista",
            subtasks,
            attachments,
            attachment_name: attachments.length ? attachments[0].name : null
        };
        handle_save_edit_task(updated_task);
    }

    return (
        <div className="modal_overlay edit_modal_overlay">
            <div className="form_modal edit_task_modal" role="dialog" aria-modal="true" aria-label="Editar tarea">
                <header className="edit_task_header">
                    <div className="edit_task_title_wrap">
                        <span className="edit_task_eyebrow">EDITAR TAREA</span>
                        <h2 className="edit_task_title">{title || "Editar tarea"}</h2>
                    </div>
                    <button
                        className="edit_modal_close_btn"
                        type="button"
                        aria-label="Cerrar"
                        onClick={() => set_active_modal("detail")}
                    >
                        {render_icon(x_icon, 18)}
                    </button>
                </header>

                <div className="edit_task_body">
                    {/* Nombre de la tarea */}
                    <div className="edit_form_field edit_form_field_full">
                        <label htmlFor="edit_task_title">Nombre de la tarea</label>
                        <input
                            id="edit_task_title"
                            type="text"
                            value={title}
                            onChange={(e) => set_title(e.target.value)}
                            placeholder="Nombre de la tarea"
                        />
                    </div>

                    {/* Proyecto & Sección */}
                    <div className="edit_form_row">
                        <div className="edit_form_field">
                            <label htmlFor="edit_task_project">Proyecto</label>
                            <div className="edit_select_wrap">
                                <select
                                    id="edit_task_project"
                                    value={project_id}
                                    onChange={(e) => set_project_id(e.target.value)}
                                >
                                    {project_items.map((p) => (
                                        <option key={p.id} value={p.id}>{p.label}</option>
                                    ))}
                                </select>
                                <span className="edit_select_chevron">{render_icon(chevron_down_icon, 18)}</span>
                            </div>
                        </div>

                        <div className="edit_form_field">
                            <label htmlFor="edit_task_section">Sección</label>
                            <div className="edit_select_wrap">
                                <select
                                    id="edit_task_section"
                                    value={section}
                                    onChange={(e) => {
                                        const new_sec = e.target.value;
                                        set_section(new_sec);
                                        if (new_sec === "completed") set_status("Lista");
                                        else if (new_sec === "in_progress") set_status("Activa");
                                        else set_status("Pend.");
                                    }}
                                >
                                    <option value="todo">Por hacer</option>
                                    <option value="in_progress">En curso</option>
                                    <option value="completed">Completadas</option>
                                </select>
                                <span className="edit_select_chevron">{render_icon(chevron_down_icon, 18)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Responsable & Fecha límite */}
                    <div className="edit_form_row">
                        <div className="edit_form_field">
                            <label htmlFor="edit_task_assignee">Responsable</label>
                            <div className="edit_select_wrap edit_assignee_select">
                                <div className="edit_assignee_avatar">
                                    {render_avatar(current_assignee, "avatar_small")}
                                </div>
                                <select
                                    id="edit_task_assignee"
                                    value={assignee_id}
                                    onChange={(e) => set_assignee_id(e.target.value)}
                                >
                                    {team_members.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                <span className="edit_select_chevron">{render_icon(chevron_down_icon, 18)}</span>
                            </div>
                        </div>

                        <div className="edit_form_field">
                            <label htmlFor="edit_task_due_day">Fecha límite</label>
                            <div className="edit_date_field_highlight">
                                <span className="edit_date_icon_left">{render_icon(calendar_days_icon, 18)}</span>
                                <select
                                    id="edit_task_due_day"
                                    value={due_day}
                                    onChange={(e) => set_due_day(Number(e.target.value))}
                                    className="edit_date_select"
                                >
                                    {calendar_days.map((day) => (
                                        <option key={day} value={day}>{day} de septiembre</option>
                                    ))}
                                </select>
                                <span className="edit_date_icon_right">{render_icon(calendar_days_icon, 18)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Prioridad & Estado */}
                    <div className="edit_form_row">
                        <div className="edit_form_field">
                            <label htmlFor="edit_task_priority">Prioridad</label>
                            <div className="edit_badge_select_box">
                                <span className={`edit_badge_pill priority_pill_${priority.toLowerCase()}`}>
                                    {priority.toUpperCase()}
                                </span>
                                <select
                                    id="edit_task_priority"
                                    value={priority}
                                    onChange={(e) => set_priority(e.target.value)}
                                    className="edit_badge_native_select"
                                >
                                    <option value="Alta">Alta</option>
                                    <option value="Media">Media</option>
                                    <option value="Baja">Baja</option>
                                </select>
                                <span className="edit_select_chevron">{render_icon(chevron_down_icon, 18)}</span>
                            </div>
                        </div>

                        <div className="edit_form_field">
                            <label htmlFor="edit_task_status">Estado</label>
                            <div className="edit_badge_select_box">
                                <span className={`edit_badge_pill status_pill_${status.toLowerCase().replace(/[^a-z]/g, "")}`}>
                                    {status.toUpperCase()}
                                </span>
                                <select
                                    id="edit_task_status"
                                    value={status}
                                    onChange={(e) => {
                                        const new_st = e.target.value;
                                        set_status(new_st);
                                        if (new_st === "Lista") set_section("completed");
                                        else if (new_st === "Activa") set_section("in_progress");
                                        else set_section("todo");
                                    }}
                                    className="edit_badge_native_select"
                                >
                                    <option value="Activa">Activa</option>
                                    <option value="Pend.">Pendiente</option>
                                    <option value="Lista">Lista</option>
                                </select>
                                <span className="edit_select_chevron">{render_icon(chevron_down_icon, 18)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Descripción */}
                    <div className="edit_form_field edit_form_field_full">
                        <label htmlFor="edit_task_description">Descripción</label>
                        <textarea
                            id="edit_task_description"
                            rows={3}
                            value={description}
                            onChange={(e) => set_description(e.target.value)}
                            placeholder="Descripción de la tarea..."
                        />
                    </div>

                    {/* Subtareas */}
                    <div className="edit_subtasks_section">
                        <div className="edit_subtasks_header">
                            <div className="edit_subtasks_title_area">
                                <h3>Subtareas</h3>
                                <span className="edit_subtasks_count">
                                    {completed_count} de {subtasks.length}
                                </span>
                                <button
                                    type="button"
                                    className="edit_add_subtask_btn"
                                    title="Agregar subtarea"
                                    aria-label="Agregar subtarea"
                                    onClick={() => {
                                        set_is_adding_subtask(true);
                                        set_editing_subtask_id(null);
                                    }}
                                >
                                    {render_icon(plus_icon, 16)}
                                </button>
                            </div>
                        </div>

                        {/* Input inline para nueva subtarea */}
                        {is_adding_subtask && (
                            <div className="edit_subtask_add_form">
                                <input
                                    type="text"
                                    autoFocus
                                    placeholder="Nombre de la nueva subtarea..."
                                    value={new_subtask_text}
                                    onChange={(e) => set_new_subtask_text(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handle_add_subtask();
                                        } else if (e.key === "Escape") {
                                            set_is_adding_subtask(false);
                                            set_new_subtask_text("");
                                        }
                                    }}
                                />
                                <div className="edit_subtask_add_actions">
                                    <button
                                        type="button"
                                        className="subtask_add_confirm_btn"
                                        onClick={handle_add_subtask}
                                    >
                                        Agregar
                                    </button>
                                    <button
                                        type="button"
                                        className="subtask_add_cancel_btn"
                                        onClick={() => {
                                            set_is_adding_subtask(false);
                                            set_new_subtask_text("");
                                        }}
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="edit_subtasks_list">
                            {subtasks.map((subtask) => (
                                <div
                                    key={subtask.id}
                                    className={`edit_subtask_item ${subtask.completed ? "edit_subtask_completed" : ""}`}
                                >
                                    {/* Checkbox: rojo con check blanco cuando está marcado */}
                                    <button
                                        type="button"
                                        className={`edit_subtask_checkbox ${subtask.completed ? "edit_subtask_checkbox_checked" : ""}`}
                                        onClick={() => handle_toggle_subtask(subtask.id)}
                                        aria-label={subtask.completed ? "Desmarcar subtarea" : "Completar subtarea"}
                                    >
                                        {subtask.completed ? render_icon(check_icon, 13) : null}
                                    </button>

                                    {/* Texto o editor inline */}
                                    {editing_subtask_id === subtask.id ? (
                                        <div className="edit_subtask_inline_edit">
                                            <input
                                                type="text"
                                                autoFocus
                                                value={editing_subtask_text}
                                                onChange={(e) => set_editing_subtask_text(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        handle_save_edited_subtask(subtask.id);
                                                    } else if (e.key === "Escape") {
                                                        set_editing_subtask_id(null);
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="subtask_inline_save_btn"
                                                title="Guardar"
                                                onClick={() => handle_save_edited_subtask(subtask.id)}
                                            >
                                                {render_icon(check_icon, 14)}
                                            </button>
                                            <button
                                                type="button"
                                                className="subtask_inline_cancel_btn"
                                                title="Cancelar"
                                                onClick={() => set_editing_subtask_id(null)}
                                            >
                                                {render_icon(x_icon, 14)}
                                            </button>
                                        </div>
                                    ) : (
                                        <span
                                            className="edit_subtask_title"
                                            onClick={() => handle_toggle_subtask(subtask.id)}
                                        >
                                            {subtask.title}
                                        </span>
                                    )}

                                    {/* Indicador circular de estado (verde check / gris círculo) */}
                                    <span className="edit_subtask_status_indicator">
                                        {subtask.completed ? (
                                            <span className="subtask_icon_completed" title="Completada">
                                                {render_icon(check_circle_icon, 18)}
                                            </span>
                                        ) : (
                                            <span className="subtask_icon_pending" title="Pendiente">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b8b4ae" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="9" />
                                                </svg>
                                            </span>
                                        )}
                                    </span>

                                    {/* 3 puntos para editar o eliminar */}
                                    <div className="edit_subtask_menu_container">
                                        <button
                                            type="button"
                                            className="edit_subtask_more_btn"
                                            aria-label="Opciones de subtarea"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                set_active_subtask_menu_id(active_subtask_menu_id === subtask.id ? null : subtask.id);
                                            }}
                                        >
                                            {render_icon(more_vertical_icon, 18)}
                                        </button>

                                        {active_subtask_menu_id === subtask.id && (
                                            <div className="edit_subtask_popover_menu" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        set_editing_subtask_id(subtask.id);
                                                        set_editing_subtask_text(subtask.title);
                                                        set_active_subtask_menu_id(null);
                                                        set_is_adding_subtask(false);
                                                    }}
                                                >
                                                    {render_icon(pencil_icon, 14)}
                                                    <span>Editar subtarea</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger_popover_item"
                                                    onClick={() => {
                                                        handle_delete_subtask(subtask.id);
                                                        set_active_subtask_menu_id(null);
                                                    }}
                                                >
                                                    {render_icon(trash_icon, 14)}
                                                    <span>Eliminar subtarea</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Archivos adjuntos */}
                    <div className="edit_attachments_section">
                        <label className="edit_section_label">Archivos adjuntos</label>
                        <div className="edit_attachments_list">
                            {attachments.map((att) => (
                                <div key={att.id} className="edit_attachment_item">
                                    <span className={`edit_attachment_badge edit_attachment_${att.type || "pdf"}`}>
                                        {(att.type || "pdf").toUpperCase()}
                                    </span>
                                    <div className="edit_attachment_info">
                                        <strong className="edit_attachment_name">{att.name}</strong>
                                        <span className="edit_attachment_size">{att.size}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="edit_attachment_remove_btn"
                                        title="Eliminar archivo"
                                        aria-label={`Eliminar ${att.name}`}
                                        onClick={() => handle_delete_attachment(att.id)}
                                    >
                                        {render_icon(x_icon, 16)}
                                    </button>
                                </div>
                            ))}
                        </div>

                        <label className="edit_upload_dropzone">
                            <input
                                type="file"
                                multiple
                                className="edit_hidden_file_input"
                                onChange={handle_file_upload}
                            />
                            <div className="edit_upload_icon_wrap">
                                {render_icon(paperclip_icon, 22)}
                                <span className="edit_upload_plus_badge">+</span>
                            </div>
                            <div className="edit_upload_text_wrap">
                                <strong>Agregar más archivos</strong>
                                <small>Puedes seleccionar varios archivos</small>
                            </div>
                        </label>
                    </div>
                </div>

                <footer className="edit_modal_footer">
                    <button
                        type="button"
                        className="edit_cancel_btn"
                        onClick={() => set_active_modal("detail")}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        className="edit_submit_btn"
                        onClick={handle_submit}
                    >
                        Guardar cambios
                    </button>
                </footer>
            </div>
>>>>>>> Stashed changes
        </div>
    );
}


<<<<<<< Updated upstream
// Renders one removable attachment chip (used in both create and edit mode).
function render_attachment_chip(attachment_item, handle_remove_attachment) {
    return (
        <div className="attachment_chip" key={attachment_item.id}>
            {render_icon(paperclip_icon, 15)}
            <span>{attachment_item.name}</span>
            <button
                type="button"
                aria-label="Quitar archivo"
                onClick={() => handle_remove_attachment(attachment_item.id)}
            >
                {render_icon(x_icon, 14)}
            </button>
        </div>
    );
}


// Renders the unified two-column "Crear nueva tarea"/"Editar tarea" modal.
// mode === "create": blank form backed by native FormData + the
// draft_subtasks/draft_attachments state (add/remove rows).
// mode === "edit": form controlled by edit_draft, prefilled from the
// selected task, highlighting fields that differ from edit_original, plus
// the comments thread and delete-task action already tested in this app.
function render_task_form_modal(props) {
=======
// Renders the modal used to create new tasks in the MVP.
function render_create_task_modal(props) {
>>>>>>> Stashed changes
    const {
        draft_attachments,
        draft_subtasks,
        edit_attachments,
        edit_draft,
        edit_original,
        handle_add_comment_submit,
        handle_add_draft_attachment,
        handle_add_draft_subtask,
        handle_add_edit_attachment,
        handle_delete_task,
        handle_edit_field_change,
        handle_remove_draft_attachment,
        handle_remove_draft_subtask,
        handle_remove_edit_attachment,
        handle_submit,
        handle_toggle_subtask,
        handle_update_draft_subtask,
        mode,
        projects,
        default_project_id,
        selected_task,
        set_active_modal
    } = props;
    const is_edit_mode = mode === "edit";

    function field_class(field_name) {
        if (!is_edit_mode || !edit_original) {
            return "form_field";
        }

        return `form_field ${edit_draft[field_name] !== edit_original[field_name] ? "field_dirty" : ""}`;
    }

    function handle_close() {
        set_active_modal(null);
    }

    return (
        <div className="modal_overlay">
            <div className="form_modal task_form_modal">
                <header className="modal_header">
                    <h2>{is_edit_mode ? "Editar tarea" : "Crear nueva tarea"}</h2>
                    <button type="button" aria-label="Cerrar" onClick={handle_close}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="task_form_body">
                    <form id="task_form_fields" onSubmit={handle_submit}>
                    <div className="form_grid">
                        <label className={`form_field_full ${field_class("title")}`}>
                            <span>Nombre de la tarea</span>
                            {is_edit_mode ? (
                                <input
                                    name="task_name"
                                    type="text"
                                    value={edit_draft.title}
                                    onChange={(event) => handle_edit_field_change("title", event.target.value)}
                                />
                            ) : (
                                <input name="task_name" type="text" placeholder="Ej. Preparar presentacion para el cliente" />
                            )}
                        </label>
                        <label className={field_class("project_id")}>
                            <span>Proyecto</span>
                            {is_edit_mode ? (
                                <select
                                    name="project_id"
                                    value={edit_draft.project_id}
                                    onChange={(event) => handle_edit_field_change("project_id", event.target.value)}
                                >
                                    {projects.map((project_item) => (
                                        <option key={project_item.id} value={project_item.id}>{project_item.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <select name="project_id" defaultValue={default_project_id}>
                                    {projects.map((project_item) => (
                                        <option key={project_item.id} value={project_item.id}>{project_item.label}</option>
                                    ))}
                                </select>
                            )}
                        </label>
                        <label className={field_class("section")}>
                            <span>Seccion</span>
                            {is_edit_mode ? (
                                <select
                                    name="section"
                                    value={edit_draft.section}
                                    onChange={(event) => handle_edit_field_change("section", event.target.value)}
                                >
                                    <option value="todo">Por hacer</option>
                                    <option value="in_progress">En curso</option>
                                    <option value="completed">Completadas</option>
                                </select>
                            ) : (
                                <select name="section" defaultValue="todo">
                                    <option value="todo">Por hacer</option>
                                    <option value="in_progress">En curso</option>
                                    <option value="completed">Completadas</option>
                                </select>
                            )}
                        </label>
                        <label className={field_class("assignee_id")}>
                            <span>Responsable</span>
                            {is_edit_mode ? (
                                <select
                                    name="assignee_id"
                                    value={edit_draft.assignee_id}
                                    onChange={(event) => handle_edit_field_change("assignee_id", event.target.value)}
                                >
                                    {team_members.map((member_item) => (
                                        <option key={member_item.id} value={member_item.id}>{member_item.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <select name="assignee_id" defaultValue={current_user_id}>
                                    {team_members.map((member_item) => (
                                        <option key={member_item.id} value={member_item.id}>{member_item.name}</option>
                                    ))}
                                </select>
                            )}
                        </label>
                        <label className={field_class("due_day")}>
                            <span>Fecha limite</span>
                            <div className="date_input_wrapper">
                                {render_icon(calendar_days_icon, 16)}
                                {is_edit_mode ? (
                                    <input
                                        name="due_day"
                                        type="number"
                                        min="1"
                                        max="30"
                                        value={edit_draft.due_day}
                                        onChange={(event) => handle_edit_field_change("due_day", Number(event.target.value))}
                                    />
                                ) : (
                                    <input name="due_day" type="number" min="1" max="30" defaultValue="8" />
                                )}
                            </div>
                        </label>
                        <label className={field_class("priority")}>
                            <span>Prioridad</span>
                            {is_edit_mode ? (
                                <select
                                    className={`priority_select ${get_priority_class(edit_draft.priority)}`}
                                    name="priority"
                                    value={edit_draft.priority}
                                    onChange={(event) => handle_edit_field_change("priority", event.target.value)}
                                >
                                    {priority_items.map((priority_item) => (
                                        <option key={priority_item} value={priority_item}>{priority_item}</option>
                                    ))}
                                </select>
                            ) : (
                                <select name="priority" defaultValue="Alta">
                                    {priority_items.map((priority_item) => (
                                        <option key={priority_item} value={priority_item}>{priority_item}</option>
                                    ))}
                                </select>
                            )}
                        </label>
                        {is_edit_mode ? (
                            <label className={field_class("status")}>
                                <span>Estado</span>
                                <select
                                    className={`status_select ${get_status_class(edit_draft.status)}`}
                                    name="status"
                                    value={edit_draft.status}
                                    onChange={(event) => handle_edit_field_change("status", event.target.value)}
                                >
                                    <option value="Pend.">Pend.</option>
                                    <option value="Activa">Activa</option>
                                    <option value="Lista">Lista</option>
                                </select>
                            </label>
                        ) : null}
                        <label className={`form_field_full ${field_class("description")}`}>
                            <span>Descripcion</span>
                            {is_edit_mode ? (
                                <textarea
                                    name="description"
                                    value={edit_draft.description}
                                    onChange={(event) => handle_edit_field_change("description", event.target.value)}
                                ></textarea>
                            ) : (
                                <textarea name="description" placeholder="Lorem ipsum dolor sit amet, consectetur adipiscing elit."></textarea>
                            )}
                        </label>
                    </div>

                    <section className="detail_section">
                        <div className="section_title_row">
                            <h2>Subtareas</h2>
                        </div>
                        <div className="subtask_list">
                            {is_edit_mode
                                ? (selected_task.subtasks.length
                                    ? selected_task.subtasks.map((subtask_item) => render_edit_subtask_row(subtask_item, selected_task.id, handle_toggle_subtask))
                                    : <p className="muted_meta">Esta tarea no tiene subtareas.</p>)
                                : draft_subtasks.map((subtask_item) => render_draft_subtask_row(subtask_item, handle_update_draft_subtask, handle_remove_draft_subtask))}
                        </div>
                        {is_edit_mode ? null : (
                            <button className="add_subtask_button" type="button" onClick={handle_add_draft_subtask}>
                                {render_icon(plus_icon, 15)} Agregar subtarea
                            </button>
                        )}
                    </section>

                    <section className="detail_section">
                        <div className="section_title_row">
                            <h2>Archivos adjuntos</h2>
                        </div>
                        {is_edit_mode ? (
                            <div className="attachment_chip_list">
                                {edit_attachments.map((attachment_item) => render_attachment_chip(attachment_item, handle_remove_edit_attachment))}
                                <button className="attachment_dropzone" type="button" onClick={handle_add_edit_attachment}>
                                    {render_icon(paperclip_icon, 16)} Agregar mas
                                </button>
                            </div>
                        ) : (
                            <div className="attachment_chip_list">
                                {draft_attachments.map((attachment_item) => render_attachment_chip(attachment_item, handle_remove_draft_attachment))}
                                <button className="attachment_dropzone" type="button" onClick={handle_add_draft_attachment}>
                                    {render_icon(paperclip_icon, 16)} Arrastra un archivo o haz clic para adjuntar
                                </button>
                            </div>
                        )}
                    </section>
                    </form>

                    {is_edit_mode ? (
                        <section className="detail_section">
                            <div className="section_title_row">
                                <h2>Comentarios</h2>
                                <span>{selected_task.comments?.length || 0}</span>
                            </div>
                            <div className="comment_list">
                                {selected_task.comments?.length ? selected_task.comments.map((comment_item) => (
                                    <div className="comment_item" key={comment_item.id}>
                                        <span className="profile_avatar">
                                            {comment_item.author_name.split(" ").map((name_part) => name_part[0]).join("").slice(0, 2).toUpperCase()}
                                        </span>
                                        <div>
                                            <strong>{comment_item.author_name}</strong>
                                            <p>{comment_item.body}</p>
                                        </div>
                                    </div>
                                )) : (
                                    <p className="muted_meta">Aun no hay comentarios en esta tarea.</p>
                                )}
                            </div>
                            <form className="comment_bar" onSubmit={(event) => handle_add_comment_submit(event, selected_task.id)}>
                                <span className="profile_avatar">JS</span>
                                <input name="comment_body" type="text" placeholder="Escribe un comentario..." autoComplete="off" />
                                <button type="submit" aria-label="Enviar comentario">
                                    {render_icon(send_icon, 20)}
                                </button>
                            </form>
                        </section>
                    ) : null}
                </div>
                <footer className="modal_footer task_form_footer">
                    {is_edit_mode ? (
                        <button
                            className="danger_button"
                            type="button"
                            onClick={() => handle_delete_task(selected_task.id)}
                        >
                            Eliminar tarea
                        </button>
                    ) : <span></span>}
                    <div className="task_form_footer_actions">
                        <button className="secondary_button" type="button" onClick={handle_close}>
                            Cancelar
                        </button>
                        <button className="primary_button" type="submit" form="task_form_fields">
                            {is_edit_mode ? "Guardar cambios" : "Crear tarea"}
                        </button>
                    </div>
                </footer>
            </div>
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


// Renders the create project modal shown from the sidebar add button.
function render_project_modal(props) {
    const {
        handle_project_color_change,
        handle_submit,
        project_form_color,
        set_active_modal
    } = props;

    return (
        <div className="modal_overlay">
            <form className="form_modal project_form_modal" role="dialog" aria-modal="true" aria-label="Crear proyecto" onSubmit={handle_submit}>
                <header className="modal_header">
                    <h2>Crear nuevo proyecto</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="form_grid">
                    <label className="form_field form_field_full">
                        <span>Nombre del proyecto</span>
                        <input name="project_name" type="text" placeholder="Ej. Campana de octubre" required />
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
                        Crear proyecto
                    </button>
                </footer>
            </form>
        </div>
    );
}


// Renders the project overflow menu from the desktop reference.
function render_project_menu(set_active_modal) {
    return (
        <div className="project_menu_popover">
            <button type="button">Editar detalles del proyecto <span>Ctrl+E</span></button>
            <button type="button">Duplicar proyecto <span>Ctrl+D</span></button>
            <button type="button">Guardar como plantilla</button>
            <button type="button">Exportar como CSV <span>CSV</span></button>
            <button type="button">Archivar proyecto</button>
            <button className="danger_menu_item" type="button" onClick={() => set_active_modal(null)}>Eliminar proyecto</button>
        </div>
    );
}


// Renders the complete Bold tasks application.
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
    const [notifications, set_notifications] = use_state(notification_items);

    const current_user = use_memo(() => get_member(current_user_id), []);
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
        if (active_modal !== "detail" && active_modal !== "edit_task") {
            return null;
        }

        return tasks.find((task_item) => task_item.id === selected_task_id) || null;
    }, [
        active_modal,
        selected_task_id,
        tasks
    ]);


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


    // Opens the edit task modal for a specific task.
    function handle_open_edit_task(task_id) {
        set_selected_task_id(task_id);
        set_active_modal("edit_task");
    }


    // Saves edited task changes to local state and emits update requests.
    function handle_save_edit_task(updated_task) {
        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.id === updated_task.id ? updated_task : task_item
        )));
        publish_task_event(create_task_event(task_event_types.task_status_changed, updated_task.id, updated_task));
        update_task_request(updated_task.id, updated_task)
            .catch((error) => {
                console.warn("No se pudo actualizar la tarea en el backend.", error);
            });
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
                projects,
                default_project_id: active_project_id,
                set_active_modal
            });
        }

        if (active_modal === "edit_task" && selected_task) {
            return (
                <EditTaskModal
                    handle_save_edit_task={handle_save_edit_task}
                    selected_task={selected_task}
                    set_active_modal={set_active_modal}
                />
            );
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

        if (active_modal === "project_menu") {
            return render_project_menu(set_active_modal);
        }

        if (selected_task && edit_draft) {
            return render_task_form_modal({
                edit_attachments,
                edit_draft,
                edit_original,
                handle_add_comment_submit,
                handle_add_edit_attachment,
                handle_delete_task,
<<<<<<< Updated upstream
                handle_edit_field_change,
                handle_remove_edit_attachment,
                handle_submit: (event) => handle_save_task_edits(event, selected_task.id),
                handle_toggle_subtask,
=======
                handle_open_edit_task,
>>>>>>> Stashed changes
                handle_toggle_task,
                mode: "edit",
                projects,
                default_project_id: active_project_id,
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
                projects,
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
                    current_user,
                    filtered_tasks,
                    handle_clear_filters,
                    handle_close_task_tool,
                    handle_task_select,
                    handle_toggle_compact_view,
                    handle_toggle_filter_value,
                    handle_toggle_task,
                    handle_toggle_task_tool,
                    handle_toggle_visible_field,
                    is_compact_view,
                    projects,
                    search_query,
                    scoped_tasks,
                    selected_project,
                    set_active_modal,
                    set_active_view,
                    set_search_query,
                    set_sort_direction,
                    set_sort_field,
                    sort_direction,
                    sort_field,
                    visible_fields
                }) : render_placeholder_module(active_module)}
            </main>

            {render_active_modal()}
        </div>
    );
}
