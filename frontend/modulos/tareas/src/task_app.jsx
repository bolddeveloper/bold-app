import { createElement as create_element, useEffect as use_effect, useMemo as use_memo, useState as use_state } from "react";
import {
    Archive as archive_icon,
    ArrowLeft as arrow_left_icon,
    BarChart3 as bar_chart_icon,
    Bell as bell_icon,
    CalendarDays as calendar_days_icon,
    Check as check_icon,
    CheckCircle2 as check_circle_icon,
    ChevronDown as chevron_down_icon,
    Columns3 as columns_icon,
    Download as download_icon,
    FileText as file_text_icon,
    Home as home_icon,
    Inbox as inbox_icon,
    LayoutList as layout_list_icon,
    Link as link_icon,
    Menu as menu_icon,
    MoreHorizontal as more_horizontal_icon,
    Plus as plus_icon,
    Search as search_icon,
    Send as send_icon,
    SlidersHorizontal as sliders_icon,
    UserPlus as user_plus_icon,
    X as x_icon
} from "lucide-react";
import { navigation_items, project_items, starter_tasks, team_members } from "./data/task_data.js";
import {
    create_task as create_task_request,
    delete_task as delete_task_request,
    get_demo_workspace_id,
    list_tasks as list_tasks_request,
    move_task as move_task_request,
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


// Finds a team member by id for avatar and detail rendering.
function get_member(member_id) {
    return team_members.find((member_item) => member_item.id === member_id) || null;
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
            ...task_item.tags
        ].join(" ").toLowerCase();

        return searchable_text.includes(normalized_query);
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
    const assignee_id = form_data.get("assignee_id") || "david_urbina";
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
function render_navigation_item(item, active_module, handle_module_change) {
    const is_active = active_module === item.id;
    const item_icon = icon_map[item.icon] || home_icon;

    return (
        <button
            className={`navigation_item ${is_active ? "navigation_item_active" : ""}`}
            key={item.id}
            type="button"
            onClick={() => handle_module_change(item.id)}
        >
            <span className="navigation_icon">
                {item.id === "tasks" && is_active ? render_icon(check_icon, 16) : render_icon(item_icon, 17)}
            </span>
            <span>{item.label}</span>
            {item.id === "tasks" ? (
                <span className="navigation_chevron">
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


// Renders the desktop and mobile sidebar navigation.
function render_sidebar(props) {
    const {
        active_module,
        handle_module_change,
        is_sidebar_open,
        set_active_modal,
        set_is_sidebar_open
    } = props;

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
                    {navigation_items.slice(0, 2).map((item) => render_navigation_item(item, active_module, handle_module_change))}
                </nav>
            </div>

            <div className="workspace_panel">
                <p className="sidebar_label">WORKSPACE</p>
                <button className="workspace_selector" type="button">
                    <span className="workspace_badge">B</span>
                    <span>BOLD Workspace</span>
                    {render_icon(chevron_down_icon, 16)}
                </button>

                <button className="my_tasks_button" type="button">
                    {render_project_dot("#ef3c3c")}
                    <span>Mis tareas</span>
                </button>

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
                    {project_items.map((project_item) => render_project_item(project_item, "launch_q4"))}
                </div>
            </div>

            <div className="sidebar_section sidebar_secondary">
                <nav className="navigation_list" aria-label="Secundaria">
                    {navigation_items.slice(2).map((item) => render_navigation_item(item, active_module, handle_module_change))}
                </nav>
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


// Renders the desktop top bar with search and user state.
function render_top_bar(props) {
    const {
        search_query,
        set_search_query
    } = props;

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
                <button className="help_button" type="button">?</button>
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


// Renders the task project header and active project view.
function render_tasks_module(props) {
    const {
        active_view,
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
        search_query,
        set_active_modal,
        set_active_view,
        set_search_query,
        tasks
    } = props;

    const completed_count = tasks.filter((task_item) => task_item.completed).length;
    const completion_percent = Math.round((completed_count / tasks.length) * 100);

    return (
        <section className="tasks_module">
            <div className="task_project_header">
                <div className="project_title_group">
                    <p className="breadcrumb_text">
                        TAREAS / BOLD WORKSPACE
                        <span className="desktop_breadcrumb_tail"> / PROYECTOS / MARKETING</span>
                    </p>
                    <h1>Lanzamiento Q4</h1>
                    <p className="project_subtitle">Campana y entregables del ultimo trimestre</p>
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
                    <button className="text_tool_button" type="button">Ordenar</button>
                    <button className="text_tool_button" type="button">Filtrar</button>
                    <button className="text_tool_button" type="button">Personalizar</button>
                    <button className="compact_button" type="button">Vista compacta</button>
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
                filtered_tasks,
                handle_task_select,
                handle_toggle_task,
                set_active_modal,
                tasks
            }) : null}

            {active_view === "board" ? render_board_view({
                filtered_tasks,
                handle_task_select,
                handle_toggle_task
            }) : null}

            {active_view === "calendar" ? render_calendar_view({
                filtered_tasks,
                handle_task_select
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
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
        set_active_modal,
        tasks
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="list_view">
            <div className="mobile_only">
                {render_progress_card(tasks, completed_count, completion_percent)}
            </div>

            <div className="task_table_card desktop_only">
                <div className="table_actions">
                    <button className="primary_button" type="button" onClick={() => set_active_modal("task")}>
                        {render_icon(plus_icon, 16)}
                        Nueva tarea
                    </button>
                    <div className="table_action_group">
                        <button className="outline_button" type="button">Orden</button>
                        <button className="outline_button" type="button">Campos</button>
                    </div>
                </div>

                <div className="task_table_header">
                    <span>TAREA</span>
                    <span>RESPONSABLE</span>
                    <span>FECHA</span>
                    <span>PRIORIDAD</span>
                    <span>ESTADO</span>
                </div>

                {task_sections.map((section_item) => render_task_group({
                    filtered_tasks,
                    handle_task_select,
                    handle_toggle_task,
                    section_item
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
        section_item
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
                task_item
            }))}
        </div>
    );
}


// Renders one task row in desktop list view.
function render_task_row(props) {
    const {
        handle_task_select,
        handle_toggle_task,
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);

    return (
        <div className={`task_row ${task_item.completed ? "task_row_completed" : ""}`} key={task_item.id}>
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
            <span className="task_assignee">
                {render_avatar(member_item, "avatar_small")}
            </span>
            <span className="task_date">{task_item.due_label}</span>
            <span className={`task_badge priority_badge ${get_priority_class(task_item.priority)}`}>
                {task_item.priority}
            </span>
            <span className={`task_badge status_badge ${get_status_class(task_item.status)}`}>
                {task_item.status}
            </span>
        </div>
    );
}


// Renders one task section in the mobile list.
function render_mobile_section(props) {
    const {
        filtered_tasks,
        handle_task_select,
        handle_toggle_task,
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
        filtered_tasks,
        handle_task_select,
        handle_toggle_task
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
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
        task_item
    } = props;
    const member_item = get_member(task_item.assignee_id);
    const project_item = get_project(task_item.project_id);

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


// Renders the static calendar view with tasks placed on due dates.
function render_calendar_view(props) {
    const {
        filtered_tasks,
        handle_task_select
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

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="calendar_view">
            <div className="calendar_header">
                <div>
                    <p className="eyebrow_text">CALENDARIO</p>
                    <h2>Septiembre 2026</h2>
                </div>
                <button className="outline_button" type="button">Hoy</button>
            </div>
            <div className="calendar_grid">
                {weekday_items.map((weekday_item) => (
                    <span className="weekday_cell" key={weekday_item}>{weekday_item}</span>
                ))}
                {calendar_days.map((day_item) => {
                    const day_tasks = filtered_tasks.filter((task_item) => task_item.due_day === day_item);

                    return (
                        <div className="calendar_day" key={day_item}>
                            <strong>{day_item}</strong>
                            {day_tasks.slice(0, 2).map((task_item) => (
                                <button
                                    className="calendar_task"
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


// Renders the task detail sheet for desktop and mobile.
function render_task_detail_panel(props) {
    const {
        handle_delete_task,
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
                    <button className="mobile_more_button" type="button" aria-label="Mas opciones">
                        {render_icon(more_horizontal_icon, 20)}
                    </button>
                </div>

                <div className="detail_header">
                    <button className="detail_close_button" type="button" aria-label="Cerrar detalle" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
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
                        <button type="button">Editar</button>
                    </div>
                    <p>{selected_task.description}</p>
                </section>

                <section className="detail_section">
                    <div className="section_title_row">
                        <h2>Subtareas</h2>
                        <span>{completed_subtasks} de {selected_task.subtasks.length || 0}</span>
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
                                <span>Lorem ipsum dolor sit amet</span>
                            </div>
                        )}
                    </div>
                </section>

                <section className="detail_section">
                    <div className="section_title_row">
                        <h2>Archivo adjunto</h2>
                        <button type="button">+ Agregar</button>
                    </div>
                    <div className="attachment_card">
                        <span>PDF</span>
                        <div>
                            <strong>{selected_task.attachment_name}</strong>
                            <small>2.4 MB - Actualizado hoy</small>
                        </div>
                        {render_icon(download_icon, 17)}
                    </div>
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
        </div>
    );
}


// Renders the modal used to create new tasks in the MVP.
function render_create_task_modal(props) {
    const {
        handle_create_task_submit,
        set_active_modal
    } = props;

    return (
        <div className="modal_overlay">
            <form className="form_modal task_form_modal" onSubmit={handle_create_task_submit}>
                <header className="modal_header">
                    <h2>Crear nueva tarea</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="form_grid">
                    <label className="form_field form_field_full">
                        <span>Nombre de la tarea</span>
                        <input name="task_name" type="text" placeholder="Ej. Preparar presentacion para el cliente" />
                    </label>
                    <label className="form_field">
                        <span>Proyecto</span>
                        <select name="project_id" defaultValue="launch_q4">
                            {project_items.map((project_item) => (
                                <option key={project_item.id} value={project_item.id}>{project_item.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className="form_field">
                        <span>Seccion</span>
                        <select name="section" defaultValue="todo">
                            <option value="todo">Por hacer</option>
                            <option value="in_progress">En curso</option>
                            <option value="completed">Completadas</option>
                        </select>
                    </label>
                    <label className="form_field">
                        <span>Responsable</span>
                        <select name="assignee_id" defaultValue="david_urbina">
                            {team_members.map((member_item) => (
                                <option key={member_item.id} value={member_item.id}>{member_item.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="form_field">
                        <span>Fecha limite</span>
                        <input name="due_day" type="number" min="1" max="30" defaultValue="8" />
                    </label>
                    <label className="form_field">
                        <span>Prioridad</span>
                        <select name="priority" defaultValue="Alta">
                            <option>Alta</option>
                            <option>Media</option>
                            <option>Baja</option>
                        </select>
                    </label>
                    <label className="form_field form_field_full">
                        <span>Descripcion</span>
                        <textarea name="description" placeholder="Lorem ipsum dolor sit amet, consectetur adipiscing elit."></textarea>
                    </label>
                </div>
                <footer className="modal_footer">
                    <button className="secondary_button" type="button" onClick={() => set_active_modal(null)}>
                        Cancelar
                    </button>
                    <button className="primary_button" type="submit">
                        Crear tarea
                    </button>
                </footer>
            </form>
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
function render_project_modal(set_active_modal) {
    return (
        <div className="modal_overlay">
            <section className="form_modal project_form_modal" role="dialog" aria-modal="true" aria-label="Crear proyecto">
                <header className="modal_header">
                    <h2>Crear nuevo proyecto</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="form_grid">
                    <label className="form_field form_field_full">
                        <span>Nombre del proyecto</span>
                        <input type="text" placeholder="Ej. Campana de octubre" />
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
                            {project_items.map((project_item) => (
                                <button
                                    className={project_item.id === "launch_q4" ? "color_swatch color_swatch_active" : "color_swatch"}
                                    key={project_item.id}
                                    style={{ "--project_color": project_item.color }}
                                    type="button"
                                    aria-label={project_item.label}
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
                    <button className="primary_button" type="button" onClick={() => set_active_modal(null)}>
                        Crear proyecto
                    </button>
                </footer>
            </section>
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
    const [search_query, set_search_query] = use_state("");
    const [tasks, set_tasks] = use_state(starter_tasks);
    const [selected_task_id, set_selected_task_id] = use_state(null);

    const filtered_tasks = use_memo(() => get_filtered_tasks(tasks, search_query), [
        tasks,
        search_query
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

        const unsubscribe = subscribe_to_task_events(handle_incoming_event);

        get_demo_workspace_id()
            .then((workspace_id) => {
                if (is_mounted) {
                    connect_realtime_stream(workspace_id);
                }
            })
            .catch((error) => {
                console.warn("No se pudo abrir la conexion en vivo con el backend.", error);
            });

        return () => {
            is_mounted = false;
            unsubscribe();
            disconnect_realtime_stream();
        };
    }, []);


    // Changes the active shell module and closes mobile navigation.
    function handle_module_change(module_id) {
        set_active_module(module_id);
        set_is_sidebar_open(false);
        set_selected_task_id(null);
        set_active_modal(null);
    }


    // Opens a task detail panel from any project view.
    function handle_task_select(task_id) {
        set_selected_task_id(task_id);
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


    // Creates a task optimistically, then swaps its temporary id for the
    // real backend id once create_task_request resolves.
    function handle_create_task_submit(event) {
        event.preventDefault();

        const form_data = new FormData(event.currentTarget);
        const new_task = build_new_task(form_data);
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


    // Renders the active modal requested by the application state.
    function render_active_modal() {
        if (active_modal === "task") {
            return render_create_task_modal({
                handle_create_task_submit,
                set_active_modal
            });
        }

        if (active_modal === "share") {
            return render_share_modal(set_active_modal);
        }

        if (active_modal === "project") {
            return render_project_modal(set_active_modal);
        }

        if (active_modal === "project_menu") {
            return render_project_menu(set_active_modal);
        }

        if (selected_task) {
            return render_task_detail_panel({
                handle_delete_task,
                handle_toggle_task,
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
                active_module,
                handle_module_change,
                is_sidebar_open,
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
                    search_query,
                    set_search_query
                })}
                {active_module === "tasks" ? render_tasks_module({
                    active_view,
                    filtered_tasks,
                    handle_task_select,
                    handle_toggle_task,
                    search_query,
                    set_active_modal,
                    set_active_view,
                    set_search_query,
                    tasks
                }) : render_placeholder_module(active_module)}
            </main>

            {render_active_modal()}
        </div>
    );
}
