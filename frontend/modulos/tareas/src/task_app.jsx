import { ResponsiveOverlay } from "../../core/shared/responsive_overlay.jsx";
import { useMediaQuery } from "../../core/shared/use_media_query.js";
import { useDialog } from "../../core/shared/use_dialog.js";
import { Component as react_component, createElement as create_element, useEffect as use_effect, useId as use_id, useMemo as use_memo, useState as use_state, useRef as use_ref } from "react";
import Swal from "sweetalert2";
import {
    ArrowUp as arrow_up_icon,
    Archive as archive_icon,
    Bell as bell_icon,
    Bookmark as bookmark_icon,
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
    Inbox as inbox_icon,
    ImagePlus as image_plus_icon,
    ExternalLink as external_link_icon,
    LayoutList as layout_list_icon,
    Link as link_icon,
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
import { notification_items, project_items, starter_tasks, team_members, current_user, current_user_id, setPresentationData } from "./services/presentation_data.js";
import { useCore } from "../../core/core_provider.jsx";
import { AppShell, useShell } from "../../core/app_shell.jsx";
import { api } from "./services/tasks_api.js";
import { is_using_real_backend } from "../../core/http_client.js";
import { loadTaskData, saveTaskDraft } from "./services/task_service.js";
import { dateFromISO, toISODate, projectTask, taskPayload, uniqueProjectName, validateProjectDraft, recentProjectIds, isMyTask } from "./services/task_models.js";
import ReportsModule from "./reports_module.jsx";
import HomeModule from "./home_module.jsx";
import {
    add_comment as add_comment_request,
    create_task as create_task_request,
    delete_task as delete_task_request,
    list_tasks as list_tasks_request,
    move_task as move_task_request,
    toggle_subtask as toggle_subtask_request,
    update_task as update_task_request
} from "./services/task_service.js";
import {
    connect_realtime_stream,
    disconnect_realtime_stream,
    publish_task_event
} from "./services/realtime_adapter.js";
import { create_task_event, task_event_types } from "./services/task_events.js";


const notification_type_icons = { assignment: user_plus_icon, comment: message_circle_icon, status_changed: check_circle_icon };

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


// Defines empty shell content for modules that are not active in the MVP.
const placeholder_content = {
    home: {
        title: "Inicio",
        eyebrow: "BOLD WORKSPACE",
        body: "Consulta la actividad reciente y accede rapidamente a tus proyectos y tareas pendientes."
    },
    inbox: {
        title: "Bandeja de entrada",
        eyebrow: "ACTUALIZACIONES",
        body: "Revisa asignaciones, menciones y cambios recientes relacionados con tu trabajo."
    },
    reports: {
        title: "Informes",
        eyebrow: "REPORTES",
        body: "Consulta el progreso de los proyectos, las tareas completadas y la carga del equipo."
    }
};


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
const timeline_comments_storage_key = "bold_timeline_comments_by_scope";
const today_iso = () => {
    const today = new Date();
    return toISODate(today.getFullYear(), today.getMonth(), today.getDate());
};
const open_date_picker = event => { try { event.currentTarget.showPicker?.(); } catch {} };
const attachment_later = () => Swal.fire({ icon: "info", title: "Próximamente", text: "Esta función estará disponible más adelante", confirmButtonColor: "#ef1f2d" });



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
    const ids = is_using_real_backend() ? collaborator_ids : collaborator_ids.length
        ? collaborator_ids
        : (task.assignee_id ? [task.assignee_id] : []);
    return ids.map((id) => get_member(id)).filter(Boolean);
}


function get_saved_comments_by_task() {
    if (is_using_real_backend()) return {};
    try {
        const saved_comments = JSON.parse(localStorage.getItem(comments_storage_key));
        return saved_comments && typeof saved_comments === "object" && !Array.isArray(saved_comments) ? saved_comments : {};
    } catch (_error) {
        return {};
    }
}


function save_task_comments(task_id, comments) {
    if (is_using_real_backend()) return;
    try {
        localStorage.setItem(comments_storage_key, JSON.stringify({
            ...get_saved_comments_by_task(),
            [task_id]: comments
        }));
    } catch (error) {
        console.warn("No se pudieron guardar los comentarios localmente.", error);
    }
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
    return project_items.find((project_item) => project_item.id === project_id) || project_items[0] || { id: "", label: "Sin proyecto", color: "#9ca3af" };
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
        if (sort_field === "position") return (Number(task_a.position) - Number(task_b.position)) * direction_multiplier;
        if (sort_field === "due_day" && is_using_real_backend()) return (task_a.due_date || "9999").localeCompare(task_b.due_date || "9999") * direction_multiplier;
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
    if (is_using_real_backend() || task_item?.due_date !== undefined) return dateFromISO(task_item?.due_date);
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

function select_color(variant, value) {
    const normalized = String(value || "").toLowerCase();
    if (variant === "priority") return normalized.includes("alta") ? "#ef1f2d" : normalized.includes("media") ? "#f59e0b" : "#22a06b";
    if (variant === "status") {
        if (/activ|curso|lista|complet|hech/.test(normalized) && !/inactiv/.test(normalized)) return "#22a06b";
        if (/pend|esper/.test(normalized)) return "#f59e0b";
        if (/inactiv|cancel|archiv/.test(normalized)) return "#8b95a5";
        return "#4f6bed";
    }
    return null;
}

function TaskSelect({ aria_label, class_name = "", default_value, disabled = false, name, on_change = () => {}, options = [], stop_propagation = false, value, variant = "neutral" }) {
    const normalized_options = options.map(option => typeof option === "object" ? option : { value: option, label: option });
    const controlled = value !== undefined;
    const [local_value, set_local_value] = use_state(default_value ?? normalized_options[0]?.value ?? "");
    const selected_value = controlled ? value : local_value;
    const selected_option = normalized_options.find(option => String(option.value) === String(selected_value)) || normalized_options[0] || { value: "", label: "Seleccionar" };
    const [is_open, set_is_open] = use_state(false);
    const [active_index, set_active_index] = use_state(0);
    const root_ref = use_ref(null);
    const listbox_id = use_id();

    use_effect(() => {
        if (!is_open) return undefined;
        const close = event => { if (!root_ref.current?.contains(event.target)) set_is_open(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [is_open]);

    function open() {
        set_active_index(Math.max(0, normalized_options.findIndex(option => String(option.value) === String(selected_value))));
        set_is_open(true);
    }

    function choose(option) {
        if (!option || option.disabled) return;
        if (!controlled) set_local_value(option.value);
        on_change(option.value);
        set_is_open(false);
    }

    function handle_key_down(event) {
        if (disabled) return;
        if (event.key === "Escape") { set_is_open(false); return; }
        if (event.key === "Tab") { set_is_open(false); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!is_open) open();
            const last = normalized_options.length - 1;
            set_active_index(index => event.key === "Home" ? 0 : event.key === "End" ? last : Math.max(0, Math.min(last, index + (event.key === "ArrowDown" ? 1 : -1))));
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (is_open) choose(normalized_options[active_index]); else open();
        }
    }

    function render_option(option, trigger = false) {
        const color = option.color || select_color(variant, option.label);
        return <>
            {option.member ? render_avatar(option.member, trigger ? "avatar_tiny" : "avatar_small") : color ? <span className="task_select_dot" style={{ "--select_color": color }} /> : option.badge ? <span className="task_select_badge">{option.badge}</span> : option.icon ? <span className="task_select_icon">{render_icon(option.icon, 15)}</span> : null}
            <span className="task_select_text"><strong>{option.label}</strong>{!trigger && option.description ? <small>{option.description}</small> : null}</span>
        </>;
    }

    return <div className={`task_select task_select_${variant} ${is_open ? "task_select_open" : ""} ${class_name}`} ref={root_ref} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) set_is_open(false); }} onClick={stop_propagation ? event => event.stopPropagation() : undefined} onKeyDown={handle_key_down}>
        {name ? <input type="hidden" name={name} value={selected_value ?? ""} /> : null}
        <button className="task_select_trigger" type="button" role="combobox" aria-label={aria_label} aria-activedescendant={is_open ? `${listbox_id}-${active_index}` : undefined} aria-controls={listbox_id} aria-expanded={is_open} aria-haspopup="listbox" disabled={disabled} onClick={() => is_open ? set_is_open(false) : open()}>
            {render_option(selected_option, true)}
            {render_icon(chevron_down_icon, 16)}
        </button>
        {is_open ? <div className="task_select_menu" id={listbox_id} role="listbox" aria-label={aria_label}>
            {normalized_options.map((option, index) => <button className={`task_select_option ${index === active_index ? "task_select_option_focused" : ""}`} id={`${listbox_id}-${index}`} key={option.value} style={{ "--select_color": option.color || select_color(variant, option.label) || "#ef1f2d" }} type="button" role="option" aria-selected={String(option.value) === String(selected_value)} disabled={option.disabled} onMouseEnter={() => set_active_index(index)} onClick={() => choose(option)}>
                {render_option(option)}
                {String(option.value) === String(selected_value) ? <span className="task_select_check">{render_icon(check_icon, 15)}</span> : null}
            </button>)}
        </div> : null}
    </div>;
}


// Renders a colored project dot.
function render_project_dot(color) {
    return (
        <span className="project_dot" style={{ "--project_color": color }}></span>
    );
}


// Renders one navigation item in the sidebar.
// Renders a project item in the sidebar workspace list.
function render_project_item(project_item, selected_project_id, handle_project_select, handle_project_menu_toggle, active_project_menu_id) {
    const is_active = selected_project_id === project_item.id;
    const is_menu_open = active_project_menu_id === project_item.id;

    return (
        <div className={`project_item_wrap dismissible_popover ${is_active ? "project_item_wrap_active" : ""} ${is_menu_open ? "project_item_wrap_menu_open" : ""}`} key={project_item.id}>
        <button
            className={`project_item ${is_active ? "project_item_active" : ""}`}
            type="button"
            onClick={() => handle_project_select(project_item.id)}
        >
            {render_project_dot(project_item.color)}
            <span>{project_item.label}</span>
            {is_active ? (
                <span className="project_more">•••</span>
            ) : null}
        </button>
            <button
                className="project_more_button"
                type="button"
                aria-label={`Opciones de ${project_item.label}`}
                onClick={(event) => {
                    event.stopPropagation();
                    handle_project_menu_toggle(project_item.id);
                }}
            >
                {render_icon(more_horizontal_icon, 18)}
            </button>
                <div className={`sidebar_project_menu animated_overflow_menu ${is_menu_open ? "overflow_menu_open" : "overflow_menu_closed"}`} aria-hidden={!is_menu_open}>
                    <button type="button" onClick={() => handle_project_menu_toggle(project_item.id, "edit")}>Editar proyecto</button>
                    <button className="danger_menu_item" type="button" onClick={() => handle_project_menu_toggle(project_item.id, "delete")}>Eliminar proyecto</button>
                </div>
        </div>
    );
}

function get_saved_timeline_comments() {
    if (is_using_real_backend()) return {};
    try {
        const saved_comments = JSON.parse(localStorage.getItem(timeline_comments_storage_key));
        return saved_comments && typeof saved_comments === "object" && !Array.isArray(saved_comments) ? saved_comments : {};
    } catch (_error) {
        return {};
    }
}

function read_image_files(file_list) {
    return Promise.all([...file_list]
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ id: `comment_image_${Date.now()}_${file.name}`, name: file.name, url: reader.result });
            reader.readAsDataURL(file);
        })));
}

function get_split_content_width(split_element) {
    const styles = window.getComputedStyle(split_element);
    return split_element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
}


// Renders the task workspace content nested below Tareas.
function render_tasks_workspace_menu(handle_my_tasks_select, handle_projects_open, set_active_modal, projects, selected_project_id, handle_project_select, handle_project_menu_toggle, active_project_menu_id, task_scope, is_open, projects_active) {
    return (
        <div className={`tasks_submenu ${is_open ? "tasks_submenu_open" : "tasks_submenu_closed"}`} id="tasks_workspace_menu" aria-hidden={!is_open}>
            <button className={`my_tasks_button ${task_scope === "mine" ? "my_tasks_button_active" : ""}`} type="button" onClick={handle_my_tasks_select}>
                <span className="submenu_dot"></span>
                <span>Mis tareas</span>
            </button>

            <div className="sidebar_section workspace_block">
                <p className="sidebar_label">WORKSPACE</p>
                <button className="workspace_selector" type="button">
                    <span className="workspace_badge">B</span>
                    <span>{is_using_real_backend() ? current_user?.unit_name : "BOLD Workspace"}</span>
                    {render_icon(chevron_down_icon, 16)}
                </button>
            </div>

            <div className="sidebar_section projects_block">
                <div className="projects_heading">
                    <button className={`projects_index_button ${projects_active ? "projects_index_button_active" : ""}`} type="button" onClick={handle_projects_open}>
                        <span className="projects_index_icon">{render_icon(folder_icon, 17)}</span>
                        <span><strong>Proyectos</strong><small>Ver todos</small></span>
                        {render_icon(chevron_right_icon, 15)}
                    </button>
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
                    {projects.map((project_item) => render_project_item(project_item, selected_project_id, handle_project_select, handle_project_menu_toggle, active_project_menu_id))}
                </div>
            </div>
        </div>
    );
}


// Renders the desktop and mobile sidebar navigation.
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
                <p>Esta seccion estara disponible cuando existan datos para mostrar.</p>
            </div>
        </section>
    );
}

const inbox_tabs = [
    { id: "activity", label: "Actividad" },
    { id: "saved", label: "Guardadas" },
    { id: "archived", label: "Archivadas" },
    { id: "mentions", label: "@Menciones" }
];

const inbox_type_options = [
    { id: "all", label: "Todas" },
    { id: "assignment", label: "Asignaciones" },
    { id: "mention", label: "Menciones" },
    { id: "comment", label: "Comentarios" },
    { id: "date_changed", label: "Cambios de fecha" },
    { id: "completed", label: "Tareas completadas" },
    { id: "status_changed", label: "Cambios de estado" },
    { id: "dependency", label: "Dependencias" }
];

const inbox_sort_options = [
    { id: "recent", label: "Mas recientes" },
    { id: "oldest", label: "Mas antiguas" },
    { id: "priority", label: "Mayor prioridad" }
];

const inbox_state_options = [
    { id: "all", label: "Todas" },
    { id: "unread", label: "No leidas" },
    { id: "read", label: "Leidas" }
];

const inbox_type_labels = {
    assignment: "Asignacion",
    mention: "Mencion",
    comment: "Comentario",
    date_changed: "Cambio de fecha",
    completed: "Tarea completada",
    status_changed: "Cambio de estado",
    dependency: "Dependencia"
};


function get_inbox_task(notification_item, tasks) {
    const searchable_text = `${notification_item.body || ""} ${notification_item.title || ""}`.toLowerCase();

    return tasks.find((task_item) => searchable_text.includes(task_item.title.toLowerCase())) || tasks[0] || null;
}

function get_inbox_type(notification_item) {
    if (notification_item.title.includes("@")) return "mention";
    if (notification_item.type === "status_changed" && /complet/i.test(notification_item.title)) return "completed";
    return notification_item.type || "status_changed";
}


function get_inbox_activities(notifications, tasks) {
    return notifications.map((notification_item, index) => {
        const task_item = get_inbox_task(notification_item, tasks);
        const actor = team_members.find((member_item) => member_item.id === notification_item.actor_id) || null;
        const project = get_project(task_item?.project_id);
        const type = get_inbox_type(notification_item);

        return {
            ...notification_item,
            order: index,
            type,
            task: task_item,
            actor,
            project,
            group_label: notification_item.time_label === "Ayer" ? "AYER" : "HOY",
            is_mention: type === "mention" || notification_item.type === "comment",
            priority_rank: priority_rank[task_item?.priority] || 0
        };
    });
}


function render_inbox_module(props) {
    const {
        archived_inbox_ids,
        handle_inbox_activity_select,
        handle_inbox_bulk_archive,
        handle_inbox_bulk_read_state,
        handle_inbox_bulk_save,
        handle_mark_notifications_read,
        handle_open_inbox_task,
        handle_toggle_inbox_read,
        handle_toggle_inbox_archive,
        handle_toggle_inbox_saved,
        inbox_filter_menu,
        inbox_filters,
        inbox_query,
        inbox_selected_ids,
        inbox_view,
        inbox_tab,
        notifications,
        saved_inbox_ids,
        selected_inbox_id,
        set_inbox_filter_menu,
        set_inbox_filters,
        set_inbox_query,
        set_inbox_selected_ids,
        set_inbox_tab,
        set_inbox_view,
        set_is_notifications_open,
        tasks
    } = props;
    const activities = get_inbox_activities(notifications, tasks);
    const active_filter_count = [
        inbox_filters.state !== "all",
        inbox_filters.type !== "all",
        inbox_filters.project_id !== "all"
    ].filter(Boolean).length;
    const unread_count = notifications.filter((notification_item) => !notification_item.is_read && !archived_inbox_ids.includes(notification_item.id)).length;
    const visible_activities = activities.filter((activity) => {
        if (inbox_tab === "saved") return saved_inbox_ids.includes(activity.id) && !archived_inbox_ids.includes(activity.id);
        if (inbox_tab === "archived") return archived_inbox_ids.includes(activity.id);
        if (inbox_tab === "mentions") return activity.is_mention && !archived_inbox_ids.includes(activity.id);
        return !archived_inbox_ids.includes(activity.id);
    }).filter((activity) => {
        const searchable_text = [
            activity.title,
            activity.body,
            activity.actor?.name,
            activity.project.label,
            activity.task?.title
        ].join(" ").toLowerCase();
        const query_match = !inbox_query.trim() || searchable_text.includes(inbox_query.trim().toLowerCase());
        const state_match = inbox_filters.state === "all"
            || (inbox_filters.state === "unread" && !activity.is_read)
            || (inbox_filters.state === "read" && activity.is_read);
        const type_match = inbox_filters.type === "all" || activity.type === inbox_filters.type || (inbox_filters.type === "mention" && activity.is_mention);
        const project_match = inbox_filters.project_id === "all" || activity.project.id === inbox_filters.project_id;

        return query_match && state_match && type_match && project_match;
    }).sort((activity_a, activity_b) => {
        if (inbox_filters.sort === "oldest") return activity_b.order - activity_a.order;
        if (inbox_filters.sort === "priority") return activity_b.priority_rank - activity_a.priority_rank;
        return activity_a.order - activity_b.order;
    });
    const selected_activity = visible_activities.find((activity) => activity.id === selected_inbox_id)
        || activities.find((activity) => activity.id === selected_inbox_id)
        || visible_activities[0]
        || activities[0]
        || null;
    const grouped_activities = ["HOY", "AYER"].map((group_label) => ({
        group_label,
        items: visible_activities.filter((activity) => activity.group_label === group_label)
    })).filter((group) => group.items.length);
    const selected_visible_count = inbox_selected_ids.filter((id) => visible_activities.some((activity) => activity.id === id)).length;

    return (
        <section className={`inbox_module ${props.inbox_detail_open ? "inbox_detail_open" : ""}`}>
            <header className="inbox_header">
                <div>
                    <h1>Bandeja de entrada</h1>
                    <p>Mantente al dia con la actividad de tus tareas y proyectos</p>
                </div>
                <div className="inbox_header_actions">
                    <span className="inbox_unread_count">{unread_count} sin leer</span>
                    <button className="secondary_button" type="button" onClick={handle_mark_notifications_read}>
                        Marcar todas como leidas
                    </button>
                    <button className="secondary_button" type="button" onClick={() => set_is_notifications_open((current) => !current)}>
                    {render_icon(bell_icon, 17)}
                    Configurar notificaciones
                    </button>
                </div>
            </header>

            <div className="inbox_card">
                <nav className="inbox_tabs" aria-label="Bandeja">
                    {inbox_tabs.map((tab_item) => (
                        <button
                            className={`inbox_tab ${inbox_tab === tab_item.id ? "inbox_tab_active" : ""}`}
                            key={tab_item.id}
                            type="button"
                            onClick={() => set_inbox_tab(tab_item.id)}
                        >
                            {tab_item.label}
                        </button>
                    ))}
                </nav>

                <div className="inbox_body">
                    <div className="inbox_list_panel">
                        <div className="inbox_toolbar">
                            <label className="inbox_search_box">
                                {render_icon(search_icon, 16)}
                                <input
                                    type="search"
                                    value={inbox_query}
                                    placeholder="Buscar en actividad..."
                                    onChange={(event) => set_inbox_query(event.target.value)}
                                />
                            </label>
                            <div className="task_tool_anchor">
                                <button className={`secondary_button ${active_filter_count ? "inbox_filter_active" : ""}`} type="button" onClick={() => set_inbox_filter_menu(inbox_filter_menu === "filters" ? null : "filters")}>
                                    {render_icon(sliders_icon, 16)}
                                    Filtrar{active_filter_count ? ` ${active_filter_count}` : ""}
                                </button>
                                {inbox_filter_menu === "filters" ? (
                                    <ResponsiveOverlay onClose={() => set_inbox_filter_menu(null)}><div className="task_tool_panel inbox_dropdown">
                                        <label className="filter_group_label">Estado</label>
                                        <TaskSelect aria_label="Estado" variant="status" value={inbox_filters.state} options={inbox_state_options.map(option => ({ value: option.id, label: option.label }))} on_change={value => set_inbox_filters(current => ({ ...current, state: value }))} />
                                        <label className="filter_group_label">Tipo</label>
                                        <TaskSelect aria_label="Tipo" value={inbox_filters.type} options={inbox_type_options.map(option => ({ value: option.id, label: option.label }))} on_change={value => set_inbox_filters(current => ({ ...current, type: value }))} />
                                        <label className="filter_group_label">Proyecto</label>
                                        <TaskSelect aria_label="Proyecto" variant="project" value={inbox_filters.project_id} options={[{ value: "all", label: "Todos los proyectos", icon: folder_icon }, ...project_items.map(project => ({ value: project.id, label: project.label, color: project.color }))]} on_change={value => set_inbox_filters(current => ({ ...current, project_id: value }))} />
                                        <button className="link_button" type="button" onClick={() => set_inbox_filters((current) => ({ ...current, state: "all", type: "all", project_id: "all" }))}>
                                            Limpiar filtros
                                        </button>
                                    <button type="button" className="secondary_button" onClick={() => set_inbox_filter_menu(null)}>Cerrar opciones</button></div></ResponsiveOverlay>
                                ) : null}
                            </div>
                            <div className="task_tool_anchor">
                                <button className="secondary_button" type="button" onClick={() => set_inbox_filter_menu(inbox_filter_menu === "sort" ? null : "sort")}>
                                    {inbox_sort_options.find((option) => option.id === inbox_filters.sort)?.label || "Mas recientes"}
                                    {render_icon(chevron_down_icon, 16)}
                                </button>
                                {inbox_filter_menu === "sort" ? (
                                    <ResponsiveOverlay onClose={() => set_inbox_filter_menu(null)}><div className="task_tool_panel inbox_dropdown inbox_dropdown_small">
                                        {inbox_sort_options.map((option) => (
                                            <button
                                                className={`sort_option ${inbox_filters.sort === option.id ? "sort_option_active" : ""}`}
                                                key={option.id}
                                                type="button"
                                                onClick={() => {
                                                    set_inbox_filters((current) => ({ ...current, sort: option.id }));
                                                    set_inbox_filter_menu(null);
                                                }}
                                            >
                                                {option.label}
                                                {inbox_filters.sort === option.id ? render_icon(check_icon, 14) : null}
                                            </button>
                                        ))}
                                    <button type="button" className="secondary_button" onClick={() => set_inbox_filter_menu(null)}>Cerrar opciones</button></div></ResponsiveOverlay>
                                ) : null}
                            </div>
                            <button className="secondary_button" type="button" onClick={() => set_inbox_view(inbox_view === "detail" ? "compact" : "detail")}>
                                {render_icon(layout_list_icon, 17)}
                                {inbox_view === "detail" ? "Vista detallada" : "Vista compacta"}
                            </button>
                        </div>

                        {selected_visible_count ? (
                            <div className="inbox_bulk_bar">
                                <span>{selected_visible_count} seleccionada(s)</span>
                                <button type="button" onClick={() => handle_inbox_bulk_read_state(true)}>Marcar leidas</button>
                                <button type="button" onClick={() => handle_inbox_bulk_read_state(false)}>Marcar no leidas</button>
                                <button type="button" onClick={handle_inbox_bulk_save}>Guardar</button>
                                <button type="button" onClick={handle_inbox_bulk_archive}>Archivar</button>
                            </div>
                        ) : null}

                        <div className="inbox_activity_list">
                            {grouped_activities.length ? grouped_activities.map((group) => (
                                <section className="inbox_group" key={group.group_label}>
                                    <h2>{group.group_label}</h2>
                                    {group.items.map((activity) => {
                                        const is_selected = selected_activity?.id === activity.id;
                                        const activity_icon = notification_type_icons[activity.type] || inbox_icon;
                                        const is_saved = saved_inbox_ids.includes(activity.id);
                                        const is_checked = inbox_selected_ids.includes(activity.id);

                                        return (
                                            <article
                                                className={`inbox_activity ${is_selected ? "inbox_activity_selected" : ""} ${activity.is_read ? "" : "inbox_activity_unread"} ${inbox_view === "compact" ? "inbox_activity_compact" : ""}`}
                                                key={activity.id}
                                            >
                                                <label className="inbox_select_check">
                                                    <input
                                                        type="checkbox"
                                                        checked={is_checked}
                                                        onChange={(event) => {
                                                            set_inbox_selected_ids((current_ids) => event.target.checked
                                                                ? [...current_ids, activity.id]
                                                                : current_ids.filter((id) => id !== activity.id));
                                                        }}
                                                    />
                                                </label>
                                                <button className="inbox_activity_main" type="button" onClick={() => handle_inbox_activity_select(activity.id)}>
                                                    <span className={`inbox_unread_dot ${activity.is_read ? "inbox_unread_dot_read" : ""}`}></span>
                                                    <span className="inbox_activity_avatar" style={{ "--avatar_color": activity.actor?.color || "#f7dddd" }}>
                                                        {activity.actor ? activity.actor.initials : render_icon(activity_icon, 17)}
                                                    </span>
                                                    <span className="inbox_activity_text">
                                                        <strong>{inbox_view === "compact" ? activity.body : activity.title}</strong>
                                                        <span>{inbox_view === "compact" ? activity.title : `${activity.actor?.name || "Sistema"} · ${inbox_type_labels[activity.type] || "Actividad"} · ${activity.body}`}</span>
                                                    </span>
                                                    <time>{activity.time_label}</time>
                                                </button>
                                                <div className="inbox_activity_actions">
                                                    <button className={is_saved ? "inbox_saved_button" : ""} type="button" aria-label="Guardar actividad" onClick={() => handle_toggle_inbox_saved(activity.id)}>
                                                        {render_icon(bookmark_icon, is_saved ? 18 : 17)}
                                                    </button>
                                                    <button type="button" aria-label={activity.is_read ? "Marcar como no leida" : "Marcar como leida"} onClick={() => handle_toggle_inbox_read(activity.id)}>
                                                        {render_icon(activity.is_read ? bell_icon : check_icon, 17)}
                                                    </button>
                                                    <button type="button" aria-label="Archivar actividad" onClick={() => handle_toggle_inbox_archive(activity.id)}>
                                                        {render_icon(archive_icon, 17)}
                                                    </button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </section>
                            )) : (
                                <div className="inbox_empty">
                                    <strong>No hay actividad aqui</strong>
                                    <span>Las actualizaciones apareceran cuando existan notificaciones.</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <ResponsiveOverlay query="(max-width: 899px)" onClose={props.inbox_detail_open ? props.close_inbox_detail : undefined}><aside className={`inbox_detail_panel ${props.inbox_detail_open ? "inbox_detail_panel_open" : ""}`}><button className="mobile_only secondary_button" type="button" onClick={props.close_inbox_detail}>Volver a la bandeja</button>
                        {selected_activity ? (
                            <>
                                <span className="inbox_status_badge">{selected_activity.task?.status || "Activa"}</span>
                                <h2>{selected_activity.task?.title || selected_activity.body}</h2>
                                <div className="inbox_detail_meta">
                                    <span>{render_avatar(selected_activity.actor, "avatar_small")}</span>
                                    <div>
                                        <small>Responsable</small>
                                        <strong>{selected_activity.actor?.name || "Sin responsable"}</strong>
                                    </div>
                                    <span className="inbox_meta_icon">{render_icon(calendar_days_icon, 17)}</span>
                                    <div>
                                        <small>Fecha limite</small>
                                        <strong>{selected_activity.task?.due_label || "Sin fecha"}</strong>
                                    </div>
                                    <span>{render_project_dot(selected_activity.project.color)}</span>
                                    <div>
                                        <small>Proyecto</small>
                                        <strong>{selected_activity.project.label}</strong>
                                    </div>
                                </div>
                                <p>{selected_activity.task?.description || selected_activity.body}</p>
                                <button className="primary_button inbox_open_task_button" type="button" onClick={() => handle_open_inbox_task(selected_activity.task?.id)}>
                                    Abrir tarea
                                    {render_icon(external_link_icon, 18)}
                                </button>
                            </>
                        ) : null}
                    </aside></ResponsiveOverlay>
                </div>
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
            label: is_using_real_backend() ? "Sección" : "Estado",
            items: (props.board_columns || task_sections).map((section_item) => ({ id: section_item.id, label: section_item.label }))
        },
        {
            key: "priorities",
            label: "Prioridad",
            items: priority_items.map((priority_item) => ({ id: priority_item, label: priority_item }))
        }
    ];

    return (
        <ResponsiveOverlay onClose={handle_close_task_tool}><div className="task_tool_panel task_options_panel" role="dialog" aria-label="Opciones de tareas">
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
        </div></ResponsiveOverlay>
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
        ...(is_using_real_backend() ? [{ id: "position", label: "Orden del tablero" }] : []),
        { id: "title", label: "Nombre de tarea" },
        { id: "due_day", label: "Fecha limite" },
        { id: "priority", label: "Prioridad" }
    ];

    return (
        <ResponsiveOverlay onClose={handle_close_task_tool}><div className="task_tool_panel task_options_panel" role="dialog" aria-label="Opciones de tareas">
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
                <TaskSelect aria_label="Dirección" value={sort_direction} options={[{ value: "asc", label: "Ascendente" }, { value: "desc", label: "Descendente" }]} on_change={set_sort_direction} />
            </div>
            <footer className="modal_footer">
                <button className="primary_button" type="button" onClick={handle_close_task_tool}>
                    Listo
                </button>
            </footer>
        </div></ResponsiveOverlay>
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
        <ResponsiveOverlay onClose={handle_close_task_tool}><div className="task_tool_panel task_options_panel" role="dialog" aria-label="Opciones de tareas">
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
        </div></ResponsiveOverlay>
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
function CustomDatePicker({ current_day, current_date, on_apply, on_clear }) {
    const mobile = useMediaQuery("(max-width: 760px)");
    const [native_date, set_native_date] = use_state(current_date || "");
    const initial_date = dateFromISO(current_date) || new Date();
    const [view_month, set_view_month] = use_state(initial_date.getMonth());
    const [view_year, set_view_year] = use_state(initial_date.getFullYear());
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

    if (mobile) return <div className="native_date_picker">
        <label>Fecha límite<input type="date" value={native_date} onClick={open_date_picker} onChange={event => set_native_date(event.target.value)} /></label>
        <div><button type="button" onClick={on_clear}>Quitar fecha</button><button type="button" disabled={!dateFromISO(native_date)} onClick={() => { const date = dateFromISO(native_date); on_apply(date.getDate(), date.getMonth(), date.getFullYear()); }}>Aplicar fecha</button></div>
    </div>;
    return (
        <div className="custom_datepicker_popover" onClick={(e) => e.stopPropagation()}>
            <div className="custom_datepicker_nav">
                <button type="button" aria-label="Mes anterior" onClick={go_prev}>{render_icon(chevron_left_icon, 16)}</button>
                <TaskSelect aria_label="Mes" class_name="task_select_compact" value={view_month} options={month_names_es.map((label, value) => ({ value, label }))} on_change={set_view_month} />
                <TaskSelect aria_label="Año" class_name="task_select_compact" value={view_year} options={year_options.map(year => ({ value: year, label: year }))} on_change={set_view_year} />
                <button type="button" aria-label="Mes siguiente" onClick={go_next}>{render_icon(chevron_right_icon, 16)}</button>
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
                    disabled={!toISODate(view_year, view_month, picked_day)}
                    onClick={() => on_apply && on_apply(picked_day, view_month, view_year)}
                >
                    Aplicar
                </button>
            </div>
        </div>
    );
}


// Right-side task detail sidebar panel (Image 3 of design reference).
function TaskDetailPanel({ handle_add_comment, handle_delete_task, handle_open_edit_task, handle_toggle_subtask, handle_toggle_task, on_close, selected_task, show_comments = true }) {
    const [comment_text, set_comment_text] = use_state("");
    const [comment_images, set_comment_images] = use_state([]);
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

    async function submit_comment() {
        if (!comment_text.trim() && !comment_images.length) return;
        const saved = await handle_add_comment(selected_task.id, comment_text, comment_images);
        if (saved === false) return;
        set_comment_text("");
        set_comment_images([]);
    }

    function handle_comment_images(event) {
        read_image_files(event.target.files).then((images) => set_comment_images((current_images) => [...current_images, ...images]));
        event.target.value = "";
    }

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
                {is_using_real_backend() && <><span className="meta_label">Responsable</span><span className="meta_value">{get_member(selected_task.assignee_id)?.name || "Sin responsable"}</span></>}

                <span className="meta_label">{is_using_real_backend() ? "Seguidores" : "Colaboradores"}</span>
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

            {is_using_real_backend() && selected_task.attachments?.map(item => <p key={item.id}><a href={/^https?:\/\//i.test(item.url) ? item.url : undefined} target="_blank" rel="noreferrer">{item.name}</a></p>)}
            {show_comments ? <>{comments.length ? (
                <div className="detail_comments_list">
                    {comments.map((comment_item) => (
                        <div className="detail_comment_item" key={comment_item.id}>
                            <strong>{comment_item.author_name || "Joaquin Sierra"}</strong>
                            {comment_item.body ? <p>{comment_item.body}</p> : null}
                            {comment_item.images?.length ? (
                                <div className="detail_comment_images">
                                    {comment_item.images.map((image) => <img key={image.id} src={image.url} alt={image.name} />)}
                                </div>
                            ) : null}
                            {comment_item.created_at ? (
                                <small>{new Date(comment_item.created_at).toLocaleString()}</small>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="detail_comments_empty">Aun no hay comentarios.</p>
            )}

            {comment_images.length ? (
                <div className="detail_comment_image_previews">
                    {comment_images.map((image) => (
                        <span key={image.id}>
                            <img src={image.url} alt={image.name} />
                            <button type="button" aria-label={`Quitar ${image.name}`} onClick={() => set_comment_images((images) => images.filter((item) => item.id !== image.id))}>
                                {render_icon(x_icon, 12)}
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="detail_comment_input_box">
                <label className="detail_comment_image_button" title="Adjuntar imagen">
                    {render_icon(image_plus_icon, 16)}
                    <input type="file" accept="image/*" multiple onChange={handle_comment_images} />
                </label>
                <input
                    type="text"
                    className="detail_comment_input"
                    placeholder="Escribe un comentario..."
                    value={comment_text}
                    onChange={(e) => set_comment_text(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (comment_text.trim() || comment_images.length)) {
                            submit_comment();
                        }
                    }}
                />
                <button
                    type="button"
                    className="detail_comment_send_btn"
                    disabled={!comment_text.trim() && !comment_images.length}
                    onClick={submit_comment}
                >
                    {render_icon(arrow_up_icon, 15)}
                </button>
            </div>
            </> : null}
        </div>
    );
}


// Selector de colaboradores para los modales de Crear y Editar tarea
function CollaboratorsSelector({ on_change, selected_ids = [], label = "Colaboradores asignados", action_label, picker_title = "Personas del proyecto", empty_text = "Selecciona personas para seguir esta tarea" }) {
    const [is_picker_open, set_is_picker_open] = use_state(false);
    const [query, set_query] = use_state("");

    use_effect(() => {
        if (!is_picker_open) return undefined;

        function handle_outside_pointer_down(event) {
            if (!event.target.closest(".collaborator_picker_anchor")) {
                set_is_picker_open(false);
            }
        }

        document.addEventListener("pointerdown", handle_outside_pointer_down);
        return () => document.removeEventListener("pointerdown", handle_outside_pointer_down);
    }, [is_picker_open]);

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
    const visible_members = team_members.filter(member => selected_ids.includes(member.id) || `${member.name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()));

    return (
        <div className="bold_field_group collaborators_field_group">
            <div className="collaborators_field_header">
                <label className="bold_field_label">
                    {label} ({assigned_members.length})
                </label>
                <div className="collaborator_picker_anchor" style={{ position: "relative" }}>
                    <button
                        type="button"
                        className="add_collaborator_btn"
                        onClick={() => set_is_picker_open((v) => !v)}
                    >
                        {render_icon(user_plus_icon, 14)}
                        <span>{action_label || (is_using_real_backend() ? "Agregar seguidor" : "Agregar colaborador")}</span>
                    </button>

                    {is_picker_open ? (
                        <div className="collaborator_picker_dropdown">
                            <div className="picker_title">{picker_title}</div>
                            <input className="bold_text_input" type="search" value={query} onChange={event => set_query(event.target.value)} placeholder="Buscar por nombre o correo" />
                            <div className="picker_list">
                                {visible_members.map((member) => {
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
                        <span>{empty_text}</span>
                    </div>
                )}
            </div>
        </div>
    );
}


// "Editar Tarea" modal (Image 2 of design reference).
function TaskIdentityFields({ data, unitId, assigneeId, onUnit, onAssignee }) {
    return <div className="bold_field_row_2">
        <label className="bold_field_group">Equipo responsable<TaskSelect aria_label="Equipo responsable" variant="team" value={unitId} options={data.units.map(item => ({ value: item.id, label: item.name, badge: item.name?.[0]?.toUpperCase(), disabled: !data.statuses.some(status => !status.unitId || status.unitId === item.id) }))} on_change={onUnit} /></label>
        <label className="bold_field_group">Responsable<TaskSelect aria_label="Responsable" variant="person" value={assigneeId || ""} options={[{ value: "", label: "Sin responsable" }, ...data.directory.filter(item => item.unitId === unitId).map(member => ({ value: member.id, label: member.name, description: member.job_role_title, member }))]} on_change={onAssignee} /></label>
    </div>;
}

function AttachmentLinks({ attachments, onChange }) {
    return <div className="bold_field_group"><label className="bold_field_label">Archivos adjuntos</label>{attachments.map(item => <div key={item.id} className="attachment_item"><a href={/^https?:\/\//i.test(item.url) ? item.url : undefined} target="_blank" rel="noreferrer">{item.name}</a><button type="button" className="attachment_remove_btn" onClick={() => onChange(attachments.filter(row => row.id !== item.id))}>Quitar</button></div>)}<button type="button" className="attachment_dropzone" onClick={attachment_later}>{render_icon(paperclip_icon, 18)}<span>Agregar archivos adjuntos</span></button></div>;
}

function EditTaskModal({ board_columns, edit_attachments, edit_draft, handle_add_edit_attachment, handle_add_edit_subtask, handle_edit_field_change, handle_edit_subtask_title_change, handle_remove_edit_attachment, handle_remove_edit_subtask, handle_toggle_edit_subtask, on_cancel, on_save, projects = project_items, status_options, data, pending }) {
    const real = is_using_real_backend();
    if (real) { board_columns = [...data.sections.filter(item => item.projectId === edit_draft.project_id), { id: "unsectioned", label: "Sin sección" }]; status_options = data.statuses.filter(item => !item.unitId || item.unitId === edit_draft.unitId).map(item => item.label); }
    const [show_datepicker, set_show_datepicker] = use_state(false);
    const subtasks = Array.isArray(edit_draft.subtasks) ? edit_draft.subtasks : [];
    const done_count = subtasks.filter((s) => s.completed).length;

    const current_collaborators = real ? edit_draft.collaborator_ids || [] : edit_draft.collaborator_ids && edit_draft.collaborator_ids.length
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
                    <div className="modal_scroll_fields">
                    {/* Nombre */}
                    <div className="bold_field_group">
                        <label className="bold_field_label">Nombre de la tarea</label>
                        <input
                            className="bold_text_input"
                            type="text"
                            value={edit_draft.title || ""}
                            onChange={(e) => handle_edit_field_change("title", e.target.value)}
                            placeholder="Nombre de la tarea"
                            required
                            maxLength={220}
                        />
                    </div>

                    {/* Proyecto & Sección */}
                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Proyecto</label>
                            <TaskSelect aria_label="Proyecto" variant="project" value={edit_draft.project_id || ""} options={projects.map(project => ({ value: project.id, label: project.label, color: project.color }))} on_change={value => handle_edit_field_change("project_id", value)} />
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Sección</label>
                            <TaskSelect aria_label="Sección" variant="section" value={edit_draft.section || "todo"} options={board_columns.map(section_item => ({ value: section_item.id, label: section_item.label, icon: columns_icon }))} on_change={value => handle_edit_field_change("section", value)} />
                        </div>
                    </div>

                    {real && <label className="bold_field_group">Fecha de inicio<input className="bold_text_input" type="date" value={edit_draft.start_date || ""} onClick={open_date_picker} onChange={event => handle_edit_field_change("start_date", event.target.value || null)} /></label>}
                    {/* Fecha límite */}
                    <div className="bold_field_group" style={{ position: "relative" }}>
                        <label className="bold_field_label">Fecha límite</label>
                        <button
                            type="button"
                            className="bold_date_trigger_btn"
                            onClick={() => set_show_datepicker((v) => !v)}
                        >
                            {render_icon(calendar_days_icon, 15)}
                            {edit_draft.due_day ? edit_draft.due_label || String(edit_draft.due_day) : "Seleccionar fecha"}
                        </button>
                        {show_datepicker ? (
                            <CustomDatePicker
                                current_day={edit_draft.due_day}
                                current_date={edit_draft.due_date}
                                on_clear={() => { handle_edit_field_change("due_date", null); handle_edit_field_change("due_day", null); set_show_datepicker(false); }}
                                on_apply={(day, month, year) => {
                                    handle_edit_field_change("due_date", toISODate(year, month, day));
                                    handle_edit_field_change("due_day", day);
                                    handle_edit_field_change("due_label", `${day} ${month_abbrev_es[month]} ${year}`);
                                    set_show_datepicker(false);
                                }}
                            />
                        ) : null}
                    </div>

                    {real && <TaskIdentityFields data={data} unitId={edit_draft.unitId} assigneeId={edit_draft.assignee_id} onUnit={id => { handle_edit_field_change("unitId", id); handle_edit_field_change("statusId", undefined); handle_edit_field_change("status", data.statuses.find(item => (!item.unitId || item.unitId === id) && !item.isFinal)?.label || ""); handle_edit_field_change("assignee_id", ""); }} onAssignee={id => handle_edit_field_change("assignee_id", id)} />}
                    {/* Seguidores y responsable son relaciones independientes. */}
                    <CollaboratorsSelector
                        selected_ids={current_collaborators}
                        on_change={(new_ids) => {
                            handle_edit_field_change("collaborator_ids", new_ids);
                            if (!real) handle_edit_field_change("assignee_id", new_ids[0] || null);
                        }}
                    />

                    {/* Prioridad & Estado */}
                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Prioridad</label>
                            <TaskSelect aria_label="Prioridad" variant="priority" value={edit_draft.priority || "Media"} options={priority_items} on_change={value => handle_edit_field_change("priority", value)} />
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Estado</label>
                            <TaskSelect aria_label="Estado" variant="status" value={edit_draft.status || "Pend."} options={status_options} on_change={value => handle_edit_field_change("status", value)} />
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
                                    onClick={() => handle_toggle_edit_subtask(sub.id)}
                                >
                                    {sub.completed ? render_icon(check_icon, 11) : null}
                                </button>
                                <input
                                    className={`subtask_text subtask_text_input ${sub.completed ? "subtask_text_done" : ""}`}
                                    value={sub.title}
                                    onChange={(event) => handle_edit_subtask_title_change(sub.id, event.target.value)}
                                />
                                <button
                                    type="button"
                                    className="attachment_remove_btn"
                                    aria-label={`Eliminar ${sub.title || "subtarea"}`}
                                    onClick={() => handle_remove_edit_subtask(sub.id)}
                                >
                                    {render_icon(trash_icon, 14)}
                                </button>
                            </div>
                        ))}
                        <button type="button" className="attachment_add_more_btn" onClick={handle_add_edit_subtask}>
                            {render_icon(plus_icon, 14)} Agregar subtarea
                        </button>
                    </div>

                    {real ? <AttachmentLinks attachments={edit_attachments} onChange={items => handle_edit_field_change("attachments", items)} /> : <>
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

                    </>}
                    </div>
                    <footer className="bold_modal_footer">
                        <button type="button" className="secondary_button" onClick={on_cancel}>Cancelar</button>
                        <button type="submit" className="primary_button" disabled={pending || (real && !edit_draft.status)}>Guardar cambios</button>
                    </footer>
                </form>
            </div>
        </div>
    );
}


// "Nueva Tarea" creation modal (Image 4 of design reference).
function CreateTaskModal({ board_columns, on_cancel, on_create, projects = project_items, selected_project_id = project_items[0]?.id || "", status_options, data, activeUnit, pending }) {
    const real = is_using_real_backend();
    const [unitId, set_unitId] = use_state(activeUnit || "");
    const [assignee_id, set_assignee_id] = use_state("");
    const [title, set_title] = use_state("");
    const [project_id, set_project_id] = use_state(selected_project_id);
    const [section, set_section] = use_state("todo");
    const [collaborator_ids, set_collaborator_ids] = use_state([]);
    const [due_day, set_due_day] = use_state(new Date().getDate());
    const [due_month, set_due_month] = use_state(new Date().getMonth());
    const [due_year, set_due_year] = use_state(new Date().getFullYear());
    const [priority, set_priority] = use_state("Media");
    const [status, set_status] = use_state("Pend.");
    const [description, set_description] = use_state("");
    const [subtasks, set_subtasks] = use_state([]);
    const [attachments, set_attachments] = use_state([]);
    const [show_datepicker, set_show_datepicker] = use_state(false);

    if (real) {
        board_columns = [...data.sections.filter(item => item.projectId === project_id), { id: "unsectioned", label: "Sin sección" }];
        status_options = data.statuses.filter(item => !item.unitId || item.unitId === unitId).map(item => item.label);
    }
    use_effect(() => { if (real) set_section(data.sections.find(item => item.projectId === project_id)?.id || "unsectioned"); }, [project_id]);
    use_effect(() => { if (real) { set_status(data.statuses.find(item => (!item.unitId || item.unitId === unitId) && !item.isFinal)?.label || ""); set_assignee_id(""); } }, [unitId]);
    function handle_submit(e) {
        e.preventDefault();
        if (!title.trim()) return;
        const col = board_columns.find((c) => c.id === section);
        const new_task = {
            id: `task_${Date.now()}`,
            title: title.trim(),
            project_id,
            section,
            assignee_id: real ? assignee_id || null : collaborator_ids[0] || null,
            unitId,
            collaborator_ids,
            due_day: due_day || null,
            due_date: toISODate(due_year, due_month, due_day),
            due_label: due_day ? `${due_day} ${month_abbrev_es[due_month]} ${due_year}` : null,
            priority,
            status: real ? status : col?.status || status,
            completed: section === "completed",
            description: description.trim(),
            subtasks: subtasks.filter((s) => s.title.trim()).map((s) => ({ ...s, completed: false })),
            attachments,
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
                    <div className="modal_scroll_fields">
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
                            maxLength={220}
                        />
                    </div>

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Proyecto</label>
                            <TaskSelect aria_label="Proyecto" variant="project" value={project_id} options={projects.map(project => ({ value: project.id, label: project.label, color: project.color }))} on_change={set_project_id} />
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Sección</label>
                            <TaskSelect aria_label="Sección" variant="section" value={section} options={board_columns.map(section_item => ({ value: section_item.id, label: section_item.label, icon: columns_icon }))} on_change={set_section} />
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
                                current_date={toISODate(due_year, due_month, due_day)}
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
                    {real && <TaskIdentityFields data={data} unitId={unitId} assigneeId={assignee_id} onUnit={set_unitId} onAssignee={set_assignee_id} />}
                    <CollaboratorsSelector
                        selected_ids={collaborator_ids}
                        on_change={set_collaborator_ids}
                    />

                    <div className="bold_field_row_2">
                        <div className="bold_field_group">
                            <label className="bold_field_label">Prioridad</label>
                            <TaskSelect aria_label="Prioridad" variant="priority" value={priority} options={priority_items} on_change={set_priority} />
                        </div>
                        <div className="bold_field_group">
                            <label className="bold_field_label">Estado</label>
                            <TaskSelect aria_label="Estado" variant="status" value={status} options={status_options} on_change={set_status} />
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

                    {real ? <AttachmentLinks attachments={attachments} onChange={set_attachments} /> : <>
                    {/* Adjuntos */}
                    <button
                        type="button"
                        className="attachment_dropzone"
                        onClick={attachment_later}
                    >
                        {render_icon(paperclip_icon, 18)}
                        <span>{attachments.length > 0 ? `${attachments.length} archivo(s) adjunto(s)` : "Agregar archivos adjuntos"}</span>
                    </button>

                    </>}
                    </div>
                    <footer className="bold_modal_footer">
                        <button type="button" className="secondary_button" onClick={on_cancel}>Cancelar</button>
                        <button type="submit" className="primary_button" disabled={pending || !title.trim() || (real && !status)}>Crear tarea</button>
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
        handle_add_timeline_comment,
        handle_clear_filters,
        handle_close_task_tool,
        handle_column_drop,
        handle_delete_task,
        handle_delete_column,
        handle_detail_resize_key_down,
        handle_detail_resize_start,
        handle_drag_end,
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
        selected_project,
        selected_task,
        selected_task_id,
        task_detail_width,
        timeline_comments,
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

    const project_tasks = filtered_tasks;
    const completed_count = project_tasks.filter((task_item) => task_item.completed).length;
    const completion_percent = project_tasks.length ? Math.round((completed_count / project_tasks.length) * 100) : 0;

    return (
        <section className="tasks_module">
            <div className="task_project_header">
                <div className="project_title_group">
                    <p className="breadcrumb_text">
                        TAREAS / BOLD WORKSPACE
                        <span className="desktop_breadcrumb_tail"> / PROYECTOS / {is_using_real_backend() ? current_user?.unit_name : "MARKETING"}</span>
                    </p>
                    <h1>{selected_project.label}</h1>
                    <p className="project_subtitle">{selected_project.description || (is_using_real_backend() ? "" : "Campaña y entregables del último trimestre")}</p>
                    <button className="mobile_workspace_selector" type="button">
                        <span className="workspace_badge">B</span>
                        <span>{is_using_real_backend() ? current_user?.unit_name : "BOLD Workspace"}</span>
                        {render_icon(chevron_down_icon, 14)}
                    </button>
                </div>

                <div className="project_actions">
                    <div className="avatar_stack" aria-label="Miembros del proyecto">
                        {(is_using_real_backend() ? team_members.filter(item => selected_project.member_ids?.includes(item.id) || selected_project.owner_assignment === item.id).slice(0, 3) : team_members.slice(0, 3)).map((member_item) => (
                            <span
                                className="avatar_medium"
                                key={member_item.id}
                                style={{ "--avatar_color": member_item.color }}
                            >
                                {member_item.initials}
                            </span>
                        ))}
                        {!is_using_real_backend() && <span className="avatar_more">+2</span>}
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
                                Filtrar{Object.values(active_filters).flat().filter(Boolean).length ? ` (${Object.values(active_filters).flat().filter(Boolean).length})` : ""}
                            </button>
                            {active_task_tool === "filter" ? render_filter_panel({
                                board_columns,
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

                <button className="mobile_floating_add" type="button" aria-label="Agregar tarea" onClick={() => set_active_modal("task")}>
                    {render_icon(plus_icon, 28)}
                </button>
            </div>

            {/* Vista según el apartado activo */}
            {active_section === "tasks" ? (
                <div className={`tasks_workspace_split ${selected_task ? "has_detail" : ""}`}>
                    <div className="tasks_main_area">
                        {active_view === "list" ? render_list_view({
                    mobile_actions: props.mobile_actions,
                            active_quick_popover,
                            board_columns,
                            collapsed_sections,
                            completed_count,
                            completion_percent,
                            dragged_task_id,
                            editing_column_id,
                            editing_column_name,
                            filtered_tasks,
                            handle_add_column,
                            handle_column_drop,
                            handle_delete_column,
                            handle_delete_task,
                            handle_drag_end,
                            handle_drag_start,
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
                            tasks: project_tasks,
                            visible_fields
                        }) : null}

                        {active_view === "board" ? render_board_view({
                    mobile_actions: props.mobile_actions,
                            active_quick_popover,
                            board_columns,
                            dragged_task_id,
                            editing_column_id,
                            editing_column_name,
                            filtered_tasks,
                            handle_add_column,
                            handle_column_drop,
                            handle_drag_end,
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
                            set_active_modal,
                            set_editing_column_id,
                            set_is_adding_column,
                            set_editing_column_name,
                            set_new_column_name
                        }) : null}
                    </div>

                    <TaskDetailSidebar
                        handle_add_comment={handle_add_comment}
                        handle_delete_task={handle_delete_task}
                        handle_detail_resize_key_down={handle_detail_resize_key_down}
                        handle_detail_resize_start={handle_detail_resize_start}
                        handle_open_edit_task={handle_open_edit_task}
                        handle_task_select={handle_task_select}
                        handle_toggle_subtask={handle_toggle_subtask}
                        handle_toggle_task={handle_toggle_task}
                        selected_task={selected_task}
                        task_detail_width={task_detail_width}
                    />
                </div>
            ) : null}

            {active_section === "timeline" ? (
                <div className={`tasks_workspace_split ${selected_task ? "has_detail" : ""}`}>
                    <div className="tasks_main_area timeline_view_wrapper">
                        {render_timeline_view(project_tasks, handle_task_select)}
                        <TimelineComments comments={timeline_comments} on_add_comment={handle_add_timeline_comment} />
                    </div>
                    <TaskDetailSidebar
                        handle_add_comment={handle_add_comment}
                        handle_delete_task={handle_delete_task}
                        handle_detail_resize_key_down={handle_detail_resize_key_down}
                        handle_detail_resize_start={handle_detail_resize_start}
                        handle_open_edit_task={handle_open_edit_task}
                        handle_task_select={handle_task_select}
                        handle_toggle_subtask={handle_toggle_subtask}
                        handle_toggle_task={handle_toggle_task}
                        selected_task={selected_task}
                        show_comments={false}
                        task_detail_width={task_detail_width}
                    />
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
        dragged_task_id,
        editing_column_id,
        editing_column_name,
        filtered_tasks,
        handle_add_column,
        handle_column_drop,
        handle_delete_column,
        handle_delete_task,
        handle_drag_end,
        handle_drag_start,
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
        set_active_modal,
        set_editing_column_id,
        set_editing_column_name,
        set_is_adding_column,
        set_new_column_name,
        status_options,
        tasks,
        visible_fields
    } = props;
    const field_items = optional_column_items;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(set_active_modal);
    }

    return (
        <div className="list_view">
            <div className="mobile_only">
                {render_progress_card(tasks, completed_count, completion_percent)}
            </div>

            <div className="task_table_card desktop_only" tabIndex={0} role="region" aria-label="Lista de tareas desplazable">
                <div className="task_table_header" style={get_task_table_columns_style(visible_fields, false, field_items)}>
                    <span>TAREA</span>
                    <span aria-hidden="true"></span>
                    {field_items
                        .filter((column_item) => visible_fields[column_item.key])
                        .map((column_item) => <span key={column_item.key}>{column_item.label}</span>)}
                </div>

                {board_columns.map((section_item) => render_task_group({
                    mobile_actions: props.mobile_actions,
                    active_quick_popover,
                    collapsed_sections,
                    column_items: field_items,
                    editing_column_id,
                    editing_column_name,
                    filtered_tasks,
                    dragged_task_id,
                    handle_column_drop,
                    handle_delete_column,
                    handle_delete_task,
                    handle_drag_end,
                    handle_drag_start,
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
                    mobile_actions: props.mobile_actions,
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
        dragged_task_id,
        handle_column_drop,
        handle_delete_column,
        handle_delete_task,
        handle_drag_end,
        handle_drag_start,
        handle_open_edit_task,
        handle_quick_change,
        handle_save_column_name,
        handle_start_edit_column,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_section,
        handle_toggle_task,
        mobile_actions,
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
        <div
            className={`task_group ${dragged_task_id ? "task_group_drop_ready" : ""}`}
            key={section_item.id}
            onDragOver={handle_column_drop ? event => event.preventDefault() : undefined}
            onDrop={handle_column_drop ? event => { event.preventDefault(); handle_column_drop(section_item.id); } : undefined}
        >
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
                {section_item.manageable || (section_item.id !== "unsectioned" && (is_using_real_backend() || section_item.id.startsWith("col_"))) ? (
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
                handle_drag_end,
                handle_drag_start,
                handle_open_edit_task,
                handle_quick_change,
                handle_task_select,
                handle_toggle_quick_popover,
                handle_toggle_task,
                mobile_actions,
                is_dragging: dragged_task_id === task_item.id,
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
        handle_drag_end,
        handle_drag_start,
        handle_open_edit_task,
        handle_quick_change,
        handle_task_select,
        handle_toggle_quick_popover,
        handle_toggle_task,
        is_dragging,
        is_selected,
        mobile_actions,
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
            data-dragging={is_dragging ? "true" : "false"}
            draggable={Boolean(handle_drag_start)}
            key={task_item.id}
            title="Arrastra la tarea a otra sección"
            style={{
                ...get_task_table_columns_style(visible_fields, true, column_items),
                cursor: handle_drag_start ? "grab" : "pointer",
                zIndex: is_priority_open || is_status_open ? 50 : 1
            }}
            onDragEnd={handle_drag_end}
            onDragStart={handle_drag_start ? event => handle_drag_start(task_item.id, event) : undefined}
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
                            status_options={is_using_real_backend() ? task_item.status_options || status_options : status_options}
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
                    mobile_actions: props.mobile_actions,
                handle_task_select,
                handle_toggle_task,
                task_item
            }))}
        </div>
    );
}


function TaskMobileActions({ task, actions }) {
    if (!actions) return null;
    return <details className="mobile_task_actions" onClick={event => event.stopPropagation()}>
        <summary aria-label={`Acciones de ${task.title}`}>••• <span>Acciones</span></summary>
        <div className="mobile_task_action_list">
            <button type="button" onClick={() => actions.onEdit(task.id)}>Editar tarea</button>
            <label>Mover a sección<TaskSelect aria_label={`Mover ${task.title} a sección`} variant="section" value={task.section || "unsectioned"} options={actions.sections.map(section => ({ value: section.id, label: section.label, icon: columns_icon }))} stop_propagation on_change={value => actions.onMove(task.id, value)} /></label>
            <button type="button" className="danger_menu_item" onClick={() => actions.onDelete(task.id)}>Eliminar tarea</button>
        </div>
    </details>;
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
                    <span className="muted_meta">{task_item.due_label || "Sin fecha"} · Prioridad {task_item.priority}</span>
                    <span className="muted_meta">{member_item?.name || "Sin responsable"} · {project_item.label}</span>
                </span>
            </button>
            {render_avatar(member_item, "avatar_medium")}
            <TaskMobileActions task={task_item} actions={props.mobile_actions} />
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
        handle_drag_end,
        handle_delete_column,
        handle_drag_start,
        handle_save_column_name,
        handle_start_edit_column,
        handle_task_select,
        handle_toggle_task,
        is_adding_column,
        new_column_name,
        set_active_modal,
        set_editing_column_id,
        set_editing_column_name,
        set_is_adding_column,
        set_new_column_name
    } = props;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(set_active_modal);
    }

    const columns_to_render = board_columns && board_columns.length ? board_columns : default_board_columns;

    return (
        <div className="board_view" tabIndex={0} role="region" aria-label="Tablero de tareas desplazable">
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
                            {section_item.manageable || (section_item.id !== "unsectioned" && (is_using_real_backend() || section_item.id.startsWith("col_"))) ? (
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
                    mobile_actions: props.mobile_actions,
                                handle_drag_end,
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
        handle_drag_end,
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
            onDragEnd={handle_drag_end}
            onDragStart={handle_drag_start ? event => handle_drag_start(task_item.id, event) : undefined}
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
            <TaskMobileActions task={task_item} actions={props.mobile_actions} />
        </article>
    );
}


// Renders the timeline/Gantt view for the Cronograma apartado.
function render_timeline_view(filtered_tasks, handle_task_select) {
    const dates = filtered_tasks.flatMap(task => [dateFromISO(task.start_date), parse_due_date(task)]).filter(Boolean);
    const rangeStart = dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : new Date();
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : rangeStart;
    const dayCount = Math.max(14, Math.round((rangeEnd - rangeStart) / 86400000) + 1);
    const days = Array.from({ length: dayCount }, (_, index) => { const date = new Date(rangeStart); date.setDate(date.getDate() + index); return date; });

    if (!filtered_tasks.length) {
        return render_empty_tasks_state();
    }

    return (
        <div className="timeline_view_card">
            <div className="timeline_header">
                <div className="timeline_col_label">TAREA</div>
                <div className="timeline_days_track_header" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(28px, 1fr))` }}>
                    {days.map((d) => (
                        <div key={d.getTime()} className={`timeline_day_header_cell ${d.toDateString() === new Date().toDateString() ? "timeline_day_today" : ""}`}>
                            <span className="timeline_day_num">{d.getDate()}</span>
                            <span className="timeline_day_sub">{d.toLocaleDateString("es", { month: "short" })}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="timeline_body">
                {filtered_tasks.map((task_item) => {
                    const member_item = get_member(task_item.assignee_id);
                    const dueDate = parse_due_date(task_item);
                    const startDate = dateFromISO(task_item.start_date) || dueDate;
                    const startOffset = startDate ? Math.max(0, Math.round((startDate - rangeStart) / 86400000)) : 0;
                    const duration = dueDate && startDate ? Math.max(1, Math.round((dueDate - startDate) / 86400000) + 1) : 1;
                    const left_pct = startOffset / dayCount * 100;
                    const width_pct = Math.max(2, duration / dayCount * 100);

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
                                {!dueDate && !startDate && <span>Sin fecha</span>}
                                <div
                                    className={`timeline_bar ${get_priority_class(task_item.priority)}`}
                                    style={{ left: `${left_pct}%`, width: `${width_pct}%`, display: dueDate || startDate ? undefined : "none" }}
                                    onClick={() => handle_task_select(task_item.id)}
                                    title={`${task_item.title} (${task_item.due_label || "Sin fecha"})`}
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
function render_calendar_view(props) { return <CalendarView {...props} />; }

function CalendarView(props) {
    const [month, setMonth] = use_state(new Date());
    const calendar_days = Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => index + 1);
    const shift = amount => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
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
    const leading_blank_count = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;

    if (!filtered_tasks.length) {
        return render_empty_tasks_state(set_active_modal);
    }

    return (
        <div className="calendar_view">
            <div className="calendar_header">
                <div className="calendar_title_group">
                    <button className="icon_button" type="button" aria-label="Mes anterior" onClick={() => shift(-1)}>
                        {render_icon(chevron_left_icon, 18)}
                    </button>
                    <div>
                        <p className="eyebrow_text">CALENDARIO</p>
                        <h2>{month.toLocaleDateString("es", { month: "long", year: "numeric" })}</h2>
                    </div>
                    <button className="icon_button" type="button" aria-label="Mes siguiente" onClick={() => shift(1)}>
                        {render_icon(chevron_right_icon, 18)}
                    </button>
                </div>
                <div className="calendar_header_actions">
                    <button className="outline_button" type="button" onClick={() => setMonth(new Date())}>Hoy</button>
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
                    const day_tasks = filtered_tasks.filter(task => { const date = parse_due_date(task); return date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth() && date.getDate() === day_item; });
                    const is_today = day_item === new Date().getDate() && month.getMonth() === new Date().getMonth() && month.getFullYear() === new Date().getFullYear();

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
function render_empty_tasks_state(set_active_modal = () => {}) {
    return (
        <div className="empty_tasks_state">
            <div className="empty_search_icon">
                {render_icon(search_icon, 96)}
            </div>
            <h2>No encontramos tareas</h2>
            <p>Agrega una tarea o ajusta los filtros activos.</p>
            <button className="primary_button" type="button" onClick={() => set_active_modal?.("task")}>
                Agregar tarea
            </button>
        </div>
    );
}


function TimelineComments({ comments, on_add_comment }) {
    const [comment_text, set_comment_text] = use_state("");
    const [comment_images, set_comment_images] = use_state([]);

    async function submit_comment() {
        if (!comment_text.trim() && !comment_images.length) return;
        on_add_comment(comment_text, comment_images);
        set_comment_text("");
        set_comment_images([]);
    }

    function handle_images(event) {
        read_image_files(event.target.files).then((images) => set_comment_images((current_images) => [...current_images, ...images]));
        event.target.value = "";
    }

    return (
        <section className="timeline_comments_section" aria-labelledby="timeline_comments_title">
            <header className="timeline_comments_header">
                <div>
                    <p>CONVERSACION DEL PROYECTO</p>
                    <h2 id="timeline_comments_title">Comentarios del cronograma</h2>
                </div>
                <span>{comments.length}</span>
            </header>

            {comments.length ? (
                <div className="timeline_comments_list" tabIndex={0} role="region" aria-label="Historial de comentarios del cronograma">
                    {comments.map((comment_item) => (
                        <article className="detail_comment_item" key={comment_item.id}>
                            <strong>{comment_item.author_name}</strong>
                            {comment_item.body ? <p>{comment_item.body}</p> : null}
                            {comment_item.images?.length ? (
                                <div className="detail_comment_images">
                                    {comment_item.images.map((image) => <img key={image.id} src={image.url} alt={image.name} />)}
                                </div>
                            ) : null}
                            <small>{new Date(comment_item.created_at).toLocaleString()}</small>
                        </article>
                    ))}
                </div>
            ) : (
                <p className="timeline_comments_empty">Aun no hay comentarios en este cronograma.</p>
            )}

            {comment_images.length ? (
                <div className="detail_comment_image_previews">
                    {comment_images.map((image) => (
                        <span key={image.id}>
                            <img src={image.url} alt={image.name} />
                            <button type="button" aria-label={`Quitar ${image.name}`} onClick={() => set_comment_images((images) => images.filter((item) => item.id !== image.id))}>
                                {render_icon(x_icon, 12)}
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="timeline_comment_composer">
                <label className="detail_comment_image_button" title="Adjuntar imagen">
                    {render_icon(image_plus_icon, 18)}
                    <input type="file" accept="image/*" multiple onChange={handle_images} />
                </label>
                <input
                    type="text"
                    value={comment_text}
                    placeholder="Escribe un comentario para el cronograma..."
                    onChange={(event) => set_comment_text(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") submit_comment();
                    }}
                />
                <button type="button" aria-label="Enviar comentario" disabled={!comment_text.trim() && !comment_images.length} onClick={submit_comment}>
                    {render_icon(arrow_up_icon, 16)}
                </button>
            </div>
        </section>
    );
}


function TaskDetailSidebar({ handle_add_comment, handle_delete_task, handle_detail_resize_key_down, handle_detail_resize_start, handle_open_edit_task, handle_task_select, handle_toggle_subtask, handle_toggle_task, selected_task, show_comments = true, task_detail_width }) {
    if (!selected_task) return null;

    return (
        <>
            <div
                className="task_detail_resizer"
                role="separator"
                aria-label="Cambiar ancho del detalle de tarea"
                aria-orientation="vertical"
                aria-valuemin={320}
                aria-valuenow={task_detail_width}
                tabIndex={0}
                onKeyDown={handle_detail_resize_key_down}
                onPointerDown={handle_detail_resize_start}
            />
            <ResponsiveOverlay query="(max-width: 1023px)" onClose={() => handle_task_select(null)}><div className="task_detail_sidebar" role="dialog" aria-label="Detalle de tarea" style={{ width: `min(${task_detail_width}px, 50%)` }}>
                <TaskDetailPanel
                    handle_add_comment={handle_add_comment}
                    handle_delete_task={handle_delete_task}
                    handle_open_edit_task={handle_open_edit_task}
                    handle_toggle_subtask={handle_toggle_subtask}
                    handle_toggle_task={handle_toggle_task}
                    on_close={() => handle_task_select(null)}
                    selected_task={selected_task}
                    show_comments={show_comments}
                />
            </div></ResponsiveOverlay>
        </>
    );
}


// Renders the sharing modal based on the desktop reference asset.
function render_share_modal(set_active_modal, project, onMembers, onError) {
    const real = is_using_real_backend();
    const members = real ? team_members.filter(item => project?.member_ids?.includes(item.id) || project?.owner_assignment === item.id) : team_members.slice(0, 2);
    const url = new URL(window.location.href); if (project?.id) url.searchParams.set("project", project.id);
    const shareUrl = real ? url.href : "bold.gt/proyectos/lanzamiento-q4";
    return (
        <div className="modal_overlay">
            <section className="form_modal share_modal" role="dialog" aria-modal="true" aria-label="Compartir proyecto">
                <header className="modal_header">
                    <h2>Compartir "{project?.label || "Lanzamiento Q4"}"</h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 22)}
                    </button>
                </header>
                <div className="share_content">
                    <label className="form_field">
                        <span>Invitar personas</span>
                        <div className="invite_row">
                            <input type="text" placeholder={real ? "Administrar miembros del proyecto" : "Nombre o correo electronico"} readOnly={real} />
                            <button className="primary_button" type="button" onClick={onMembers}>{real ? "Administrar miembros" : "Enviar invitacion"}</button>
                        </div>
                    </label>
                    <p className="sidebar_label">PERSONAS CON ACCESO</p>
                    {members.map((member_item) => (
                        <div className="access_row" key={member_item.id}>
                            {render_avatar(member_item, "avatar_medium")}
                            <div>
                                <strong>{member_item.name}</strong>
                                <span>{member_item.email}</span>
                            </div>
                            <button className="outline_button" type="button" onClick={onMembers}>{real ? "Miembro" : "Puede editar"}</button>
                        </div>
                    ))}
                    <div className="link_access_card">
                        <span>{render_icon(user_plus_icon, 18)}</span>
                        <div>
                            <strong>{real ? "Acceso según tus permisos" : "Cualquiera en BOLD Workspace"}</strong>
                            <p>{real ? "El enlace requiere iniciar sesión y tener acceso al proyecto" : "Puede ver este proyecto con el enlace"}</p>
                        </div>
                        {render_icon(chevron_down_icon, 16)}
                    </div>
                    <div className="copy_link_row">
                        <input type="text" value={shareUrl} readOnly />
                        <button className="dark_button" type="button" onClick={() => navigator.clipboard?.writeText(shareUrl).catch(error => onError?.(error.message))}>
                            {render_icon(link_icon, 16)}
                            Copiar enlace
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

function ShareProjectModal({ project, onClose, onSave, onError, pending }) {
    const [query, setQuery] = use_state("");
    const [selected, setSelected] = use_state(() => project?.member_ids || []);
    const visible = team_members.filter(member => selected.includes(member.id) || `${member.name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()));
    const url = new URL(window.location.href);
    if (project?.id) url.searchParams.set("project", project.id);
    const toggle = id => setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
    return <div className="modal_overlay"><section className="form_modal share_modal" role="dialog" aria-modal="true" aria-label="Compartir proyecto">
        <header className="modal_header"><h2>Compartir "{project?.label}"</h2><button type="button" aria-label="Cerrar" onClick={onClose}>{render_icon(x_icon, 22)}</button></header>
        <div className="share_content">
            <label className="form_field"><span>Buscar personas</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o correo electrónico" /></label>
            <div className="project_people_selected">{visible.map(member => <button className={`project_person_chip ${selected.includes(member.id) ? "project_person_chip_active" : ""}`} key={member.id} type="button" onClick={() => toggle(member.id)}>{render_avatar(member, "avatar_small")}<span>{member.name}<small>{member.email}</small></span>{render_icon(selected.includes(member.id) ? x_icon : plus_icon, 16)}</button>)}</div>
            <div className="copy_link_row"><input type="text" value={url.href} readOnly /><button className="dark_button" type="button" onClick={() => navigator.clipboard?.writeText(url.href).catch(error => onError(error.message))}>{render_icon(link_icon, 16)} Copiar enlace</button></div>
            <footer className="bold_modal_footer"><button className="secondary_button" type="button" onClick={onClose}>Cancelar</button><button className="primary_button" type="button" disabled={pending} onClick={() => onSave(selected)}>Guardar acceso</button></footer>
        </div>
    </section></div>;
}

function render_projects_module({ projects, selected_project_id, tasks, search_query, onCreate, onOpen, onEdit, onShare, onDelete }) {
    const query = search_query.trim().toLowerCase();
    const visible = projects.filter(project => project.label.toLowerCase().includes(query));
    return <section className="projects_module">
        <header className="projects_module_header"><div><p className="breadcrumb_text">PROYECTOS</p><h1>Proyectos</h1><p>Gestiona el trabajo del departamento en un solo lugar.</p></div><button className="primary_button" type="button" onClick={onCreate}>{render_icon(plus_icon, 17)} Crear proyecto</button></header>
        <div className="projects_grid">{visible.map(project => {
            const projectTasks = tasks.filter(task => task.project_id === project.id || task.taskProjects?.some(link => link.projectId === project.id));
            const done = projectTasks.filter(task => task.completed).length;
            const progress = projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0;
            return <article className={`project_summary_card ${selected_project_id === project.id ? "project_summary_card_active" : ""}`} key={project.id}>
                <div className="project_summary_title">{render_project_dot(project.color)}<button type="button" onClick={() => onOpen(project.id)}>{project.label}</button><span>{project.status || "Activo"}</span></div>
                <p>{project.start_date || "Sin inicio"} — {project.end_date || "Sin fecha final"}</p>
                <div className="project_summary_progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div>
                <small>{done} de {projectTasks.length} tareas completadas</small>
                <footer className="project_summary_actions">
                    <button className="project_action_primary" type="button" onClick={() => onOpen(project.id)}>{render_icon(external_link_icon, 15)} Abrir tareas</button>
                    <button className="project_action_secondary" type="button" onClick={() => onEdit(project.id)}>{render_icon(pencil_icon, 15)} Editar</button>
                    <button className="project_action_secondary" type="button" onClick={() => onShare(project.id)}>{render_icon(link_icon, 15)} Compartir</button>
                    <button className="project_action_danger" type="button" onClick={() => onDelete(project.id)}>{render_icon(trash_icon, 15)} Eliminar</button>
                </footer>
            </article>;
        })}</div>
        {!visible.length && <div className="placeholder_card"><h2>No hay proyectos</h2><p>Prueba otro nombre o crea un proyecto.</p></div>}
    </section>;
}


function DeleteConfirmModal({ item_label, item_meta, item_type, on_cancel, on_confirm, pending }) {
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
                    <button type="button" onClick={on_confirm} disabled={pending}>Eliminar</button>
                </footer>
            </section>
        </div>
    );
}


// Renders the create project modal shown from the sidebar add button.
function render_project_modal(props) {
    const {
        editing_project,
        handle_create_project,
        project_color,
        project_people_ids,
        set_active_modal,
        set_project_color,
        set_project_people_ids
    } = props;

    return (
        <div className="project_create_overlay">
            <section className="project_create_modal" role="dialog" aria-modal="true" aria-label="Crear proyecto">
                <header className="project_create_header">
                    <h2>
                        {render_icon(folder_icon, 34)}
                        {editing_project ? "Editar proyecto" : "Crear nuevo proyecto"}
                    </h2>
                    <button type="button" aria-label="Cerrar" onClick={() => set_active_modal(null)}>
                        {render_icon(x_icon, 30)}
                    </button>
                </header>

                <form className="project_create_body" onSubmit={handle_create_project}>
                    <div className="modal_scroll_fields">
                    <label className="project_create_step">
                        <span><strong>1</strong> Nombre del proyecto</span>
                        <input name="project_name" type="text" placeholder="Ej. Campana de lanzamiento Q4" defaultValue={editing_project?.label || ""} required maxLength={180} />
                    </label>

                    <label className="project_create_step">
                        <span><strong>2</strong> Descripcion</span>
                        <textarea name="project_description" rows="4" placeholder="Describe brevemente el objetivo y alcance del proyecto..." defaultValue={editing_project?.description || ""}></textarea>
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
                                <input name="project_start" type="date" defaultValue={editing_project?.start_date || today_iso()} onClick={open_date_picker} />
                            </label>
                            <label>
                                Fecha de fin
                                <input name="project_end" type="date" defaultValue={editing_project?.end_date || ""} onClick={open_date_picker} />
                            </label>
                            <label>
                                Estado inicial
                                <TaskSelect aria_label="Estado inicial" name="project_status" variant="status" default_value={editing_project?.status || "Activo"} options={["Activo", "Pendiente", "Inactivo"]} />
                            </label>
                        </div>
                        <label className="project_create_full_select">
                            Prioridad
                            <TaskSelect aria_label="Prioridad" name="project_priority" variant="priority" disabled={is_using_real_backend()} default_value={editing_project?.priority || "Media"} options={priority_items} />
                        </label>
                    </section>

                    <section className="project_create_step">
                        <span><strong>5</strong> Personas relacionadas al proyecto</span>
                        <CollaboratorsSelector
                            selected_ids={project_people_ids}
                            on_change={set_project_people_ids}
                            label="Personas relacionadas"
                            action_label="Agregar persona"
                            picker_title="Personas del proyecto"
                            empty_text="Selecciona personas relacionadas con este proyecto"
                        />
                    </section>

                    </div>
                    <footer className="project_create_footer">
                        <button type="button" onClick={() => set_active_modal(null)}>Cancelar</button>
                        <button type="submit">{editing_project ? "Guardar cambios" : "Crear proyecto"}</button>
                    </footer>
                </form>
            </section>
        </div>
    );
}


// Renders the project overflow menu from the desktop reference.
function render_project_menu(set_active_modal, handle_request_delete_project, is_open) {
    return (
        <div className={`project_menu_popover animated_overflow_menu ${is_open ? "overflow_menu_open" : "overflow_menu_closed"}`} aria-hidden={!is_open}>
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
                        <span className="desktop_breadcrumb_tail"> / PROYECTOS / {is_using_real_backend() ? current_user?.unit_name : "MARKETING"}</span>
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
    const session = useCore();
    const { active_module, set_active_module, set_is_sidebar_open } = useShell();
    const real = is_using_real_backend();
    const [data, set_data] = use_state(null);
    const [api_error, set_api_error] = use_state("");
    const [pending, set_pending] = use_state(false);
    const mutation_pending = use_ref(false);
    const refresh = use_ref(async () => {});
    const [active_view, set_active_view] = use_state("list");
    const [active_modal, set_active_modal] = use_state(null);
    const [inbox_detail_open, set_inbox_detail_open] = use_state(false);
    const mobile = useMediaQuery("(max-width: 760px)");
    const compact = useMediaQuery("(max-width: 1023px)");
    useDialog(!!active_modal && !["project_menu"].includes(active_modal), '[role="dialog"][aria-modal="true"]', () => set_active_modal(null));
    const [is_tasks_menu_open, set_is_tasks_menu_open] = use_state(true);
    const [search_query, set_search_query] = use_state("");
    const [stored_tasks, set_tasks] = use_state(() => merge_saved_comments(starter_tasks));
    const [selected_task_id, set_selected_task_id] = use_state(null);
    const [delete_target, set_delete_target] = use_state(null);
    const [edit_draft, set_edit_draft] = use_state(null);
    const [edit_attachments, set_edit_attachments] = use_state([]);
    const [active_task_tool, set_active_task_tool] = use_state(null);
    const [sort_field, set_sort_field] = use_state(real ? "position" : "due_day");
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
    const status_options = real ? (data?.statuses || []).filter(item => !item.unitId || item.unitId === (edit_draft?.unitId || session.activeUnit?.id)).map(item => item.label) : default_status_items;
    const [collapsed_sections, set_collapsed_sections] = use_state([]);
    const [is_notifications_open, set_is_notifications_open] = use_state(false);

    const [projects, set_projects] = use_state(() => {
        if (real) return [];
        try {
            const saved_projects = JSON.parse(localStorage.getItem(projects_storage_key));

            return Array.isArray(saved_projects) && saved_projects.length ? saved_projects : project_items;
        } catch (_error) {
            return project_items;
        }
    });
    const recent_projects_key = `bold_recent_projects:${session.activeAssignment?.personId || "demo"}:${session.activeAssignment?.id || current_user_id}`;
    const [recent_project_ids, set_recent_project_ids] = use_state([]);
    const [project_color, set_project_color] = use_state(project_color_options[0]);
    const [project_people_ids, set_project_people_ids] = use_state(team_members.map((member_item) => member_item.id));
    const [mock_sections_by_project, set_mock_sections_by_project] = use_state(() => Object.fromEntries(project_items.map(project => [project.id, default_board_columns])));
    const [dragged_task_id, set_dragged_task_id] = use_state(null);
    const [is_adding_column, set_is_adding_column] = use_state(false);
    const [new_column_name, set_new_column_name] = use_state("");
    const [editing_column_id, set_editing_column_id] = use_state(null);
    const [editing_column_name, set_editing_column_name] = use_state("");
    const [unsectioned_by_project, set_unsectioned_by_project] = use_state({});
    const [schedule_view, set_schedule_view] = use_state("timeline");
    const [active_quick_popover, set_active_quick_popover] = use_state(null);
    const [active_section, set_active_section] = use_state("tasks");
    const [selected_project_id, set_selected_project_id] = use_state(() => new URLSearchParams(window.location.search).get("project") || (real ? "" : "launch_q4"));
    const [task_scope, set_task_scope] = use_state("project");
    const tasks = use_memo(() => real ? stored_tasks.map(task => projectTask(task, task_scope === "project" ? selected_project_id : null)) : stored_tasks, [real, stored_tasks, selected_project_id, task_scope]);
    const unsectioned_config = unsectioned_by_project[selected_project_id] || { label: "Sin sección", hidden: false };
    const has_unsectioned_tasks = tasks.some(task => task.project_id === selected_project_id && task.section === "unsectioned");
    const unsectioned_column = { id: "unsectioned", label: unsectioned_config.label, manageable: true };
    const board_columns = real ? (task_scope === "mine"
        ? [{ id: "unsectioned", label: "Mis tareas" }]
        : [...(data?.sections || []).filter(item => item.projectId === selected_project_id), ...(!unsectioned_config.hidden || has_unsectioned_tasks ? [unsectioned_column] : [])])
        : [...(mock_sections_by_project[selected_project_id] || []), ...(!unsectioned_config.hidden || has_unsectioned_tasks ? [unsectioned_column] : [])];

    const [task_detail_width, set_task_detail_width] = use_state(390);
    const [active_project_menu_id, set_active_project_menu_id] = use_state(null);
    const [editing_project_id, set_editing_project_id] = use_state(null);
    const [inbox_tab, set_inbox_tab] = use_state("activity");
    const [selected_inbox_id, set_selected_inbox_id] = use_state(null);
    const [saved_inbox_ids, set_saved_inbox_ids] = use_state([]);
    const [archived_inbox_ids, set_archived_inbox_ids] = use_state([]);
    const [inbox_query, set_inbox_query] = use_state("");
    const [inbox_filter_menu, set_inbox_filter_menu] = use_state(null);
    const [inbox_view, set_inbox_view] = use_state("detail");
    const [inbox_selected_ids, set_inbox_selected_ids] = use_state([]);
    const [inbox_filters, set_inbox_filters] = use_state({
        sort: "recent",
        state: "all",
        type: "all",
        project_id: "all"
    });
    const [timeline_comments_by_scope, set_timeline_comments_by_scope] = use_state(get_saved_timeline_comments);

    use_effect(() => {
        if (!real) localStorage.setItem(projects_storage_key, JSON.stringify(projects));
    }, [projects]);

    use_effect(() => {
        if (real && !data) return;
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem(recent_projects_key)) || []; } catch {}
        const next = recentProjectIds(Array.isArray(saved) ? saved : [], projects.map(project => project.id));
        set_recent_project_ids(next);
        try { localStorage.setItem(recent_projects_key, JSON.stringify(next)); } catch {}
    }, [recent_projects_key, projects, real, data]);

    function remember_project(project_id, available_ids = projects.map(project => project.id)) {
        set_recent_project_ids(current => {
            const next = recentProjectIds(current, available_ids, project_id);
            try { localStorage.setItem(recent_projects_key, JSON.stringify(next)); } catch {}
            return next;
        });
    }

    use_effect(() => {
        try {
            if (!real) localStorage.setItem(timeline_comments_storage_key, JSON.stringify(timeline_comments_by_scope));
        } catch (error) {
            console.warn("No se pudieron guardar los comentarios del cronograma.", error);
        }
    }, [timeline_comments_by_scope]);

    use_effect(() => {
        function clamp_detail_width() {
            const split_element = document.querySelector(".tasks_workspace_split");
            if (!split_element || window.innerWidth <= 760) return;
            set_task_detail_width((current_width) => Math.min(current_width, get_split_content_width(split_element) / 2));
        }

        window.addEventListener("resize", clamp_detail_width);
        return () => window.removeEventListener("resize", clamp_detail_width);
    }, []);

    function handle_create_project(event) {
        event.preventDefault();
        const form_data = new FormData(event.currentTarget);
        const base_label = (form_data.get("project_name") || "").toString().trim();
        const start_date = form_data.get("project_start") || "";
        const end_date = form_data.get("project_end") || "";

        const validation_error = validateProjectDraft(base_label, start_date, end_date);
        if (validation_error) return set_api_error(validation_error);
        const label = editing_project_id ? base_label : uniqueProjectName(base_label, projects.map(project => project.label));

        const project_payload = {
            id: editing_project_id || `project_${Date.now()}`,
            label,
            description: (form_data.get("project_description") || "").toString(),
            color: project_color,
            start_date,
            end_date,
            status: form_data.get("project_status") || "Activo",
            priority: form_data.get("project_priority") || "Media",
            member_ids: project_people_ids
        };

        if (real) {
            let created_project_id = editing_project_id;
            mutate(async () => {
                const assignment = session.activeAssignment;
                const payload = { name: label, description: project_payload.description, color_hex: project_color, status: project_payload.status, start_date: start_date || null, end_date: end_date || null };
                const project = editing_project_id ? await api.update("projects", editing_project_id, payload) : await api.create("projects", { ...payload, unit: assignment.unitId, owner_assignment: assignment.id });
                created_project_id = project.id;
                const members = data.members.filter(item => item.project === project.id);
                for (const member of members) if (!project_people_ids.includes(member.assignment)) await api.remove("project-members", member.id);
                for (const id of project_people_ids) {
                    const old = members.find(item => item.assignment === id);
                    if (!old) await api.create("project-members", { project: project.id, assignment: id, member_role: "member", status: "active" });
                    else if (old.status !== "active" || old.removed_at) await api.update("project-members", old.id, { status: "active", removed_at: null });
                }
                set_selected_project_id(project.id);
            }, () => {
                if (!editing_project_id) remember_project(created_project_id, [created_project_id, ...projects.map(project => project.id)]);
                set_active_modal(null); set_editing_project_id(null);
            });
            return;
        }
        set_projects((current_projects) => (
            editing_project_id
                ? current_projects.map((project_item) => project_item.id === editing_project_id ? { ...project_item, ...project_payload } : project_item)
                : [...current_projects, project_payload]
        ));
        if (!editing_project_id) set_mock_sections_by_project(current => ({ ...current, [project_payload.id]: [] }));
        if (!editing_project_id) remember_project(project_payload.id, [project_payload.id, ...projects.map(project => project.id)]);
        set_selected_project_id(project_payload.id);
        set_project_color(project_color_options[0]);
        set_project_people_ids(team_members.map((member_item) => member_item.id));
        set_editing_project_id(null);
        set_active_modal(null);
    }

    function handle_project_select(project_id) {
        remember_project(project_id);
        const url = new URL(window.location.href); url.searchParams.set("project", project_id); window.history.replaceState(null, "", url);
        if (real) set_active_filters(filters => ({ ...filters, sections: [] }));
        set_selected_project_id(project_id);
        set_task_scope("project");
        set_active_module("tasks");
        set_active_section("tasks");
        set_selected_task_id(null);
        set_active_project_menu_id(null);
        set_is_sidebar_open(false);
    }

    function handle_project_menu_toggle(project_id, action = "toggle") {
        if (action !== "toggle") {
            const url = new URL(window.location.href); url.searchParams.set("project", project_id); window.history.replaceState(null, "", url);
            set_selected_project_id(project_id);
        }
        if (action === "edit") {
            const project_item = projects.find((item) => item.id === project_id);
            set_editing_project_id(project_id);
            set_project_color(project_item?.color || project_color_options[0]);
            set_project_people_ids(project_item?.member_ids || team_members.map((member_item) => member_item.id));
            set_active_project_menu_id(null);
            set_active_modal("project");
            return;
        }

        if (action === "delete") {
            set_delete_target({ type: "project", id: project_id });
            set_active_project_menu_id(null);
            set_active_modal("delete_confirm");
            return;
        }

        set_active_project_menu_id((current_id) => current_id === project_id ? null : project_id);
    }

    function handle_share_project(project_id) {
        const url = new URL(window.location.href); url.searchParams.set("project", project_id); window.history.replaceState(null, "", url);
        set_selected_project_id(project_id);
        set_active_project_menu_id(null);
        set_active_modal("share");
    }

    function handle_save_project_members(member_ids) {
        if (!real) {
            set_projects(items => items.map(project => project.id === selected_project_id ? { ...project, member_ids } : project));
            set_active_modal(null);
            return;
        }
        mutate(async () => {
            const members = data.members.filter(item => item.project === selected_project_id);
            for (const member of members) if (!member_ids.includes(member.assignment)) await api.remove("project-members", member.id);
            for (const id of member_ids) if (!members.some(member => member.assignment === id)) await api.create("project-members", { project: selected_project_id, assignment: id, member_role: "member", status: "active" });
        }, () => set_active_modal(null));
    }

    function handle_drag_start(task_id, event) {
        set_dragged_task_id(task_id);
        event?.dataTransfer?.setData("text/plain", String(task_id));
        if (event?.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function handle_drag_end() {
        set_dragged_task_id(null);
    }

    function handle_column_drop(column_id, task_id = dragged_task_id) {
        if (real) {
            const task = data.tasks.find(item => item.id === task_id);
            const link = task?.taskProjects.find(item => item.projectId === selected_project_id);
            set_dragged_task_id(null);
            if (link) mutate(() => api.updateTaskProjectLink(link.id, { section: column_id === "unsectioned" ? null : column_id, position: String(Math.max(0, ...data.links.filter(item => item.projectId === selected_project_id && item.sectionId === column_id).map(item => Number(item.position))) + 1000) }));
            return;
        }
        if (!task_id) return;
        const target_column = board_columns.find((c) => c.id === column_id);
        const next_section = column_id;
        const next_status = target_column ? target_column.status : "Pend.";
        const next_completed = column_id === "completed";

        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) {
                return task_item;
            }

            const updated_task = {
                ...task_item,
                section: next_section,
                status: next_status,
                completed: next_completed
            };

            update_task_request(task_item.id, updated_task).catch(() => { });
            move_task_request(task_item.id, next_section).catch(() => { });
            publish_task_event(create_task_event(task_event_types.task_status_changed, task_item.id, updated_task));

            return updated_task;
        }));

        set_dragged_task_id(null);
    }

    function handle_add_column() {
        if (real) { if (new_column_name.trim()) mutate(() => api.create("sections", { project: selected_project_id, name: new_column_name.trim(), position: String(Math.max(0, ...board_columns.map(item => Number(item.position) || 0)) + 1000) }), () => { set_new_column_name(""); set_is_adding_column(false); }); return; }
        const trimmed_name = new_column_name.trim();
        if (!trimmed_name) return;

        const new_column_id = `col_${Date.now()}`;
        set_mock_sections_by_project(current => ({ ...current, [selected_project_id]: [...(current[selected_project_id] || []), { id: new_column_id, label: trimmed_name, status: trimmed_name }] }));
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
        if (editing_column_id === "unsectioned") {
            set_unsectioned_by_project(current => ({ ...current, [selected_project_id]: { label, hidden: false } }));
            set_editing_column_id(null);
            set_editing_column_name("");
            return;
        }
        if (real) { mutate(() => api.update("sections", editing_column_id, { name: label }), () => set_editing_column_id(null)); return; }
        set_mock_sections_by_project(current => ({ ...current, [selected_project_id]: (current[selected_project_id] || []).map(column_item => column_item.id === editing_column_id ? { ...column_item, label, status: label } : column_item) }));
        set_editing_column_id(null);
        set_editing_column_name("");
    }

    function handle_delete_column(column_id) {
        if (column_id === "unsectioned") {
            const hide = () => set_unsectioned_by_project(current => ({ ...current, [selected_project_id]: { ...(current[selected_project_id] || { label: "Sin sección" }), hidden: true } }));
            if (real) {
                const links = data.links.filter(link => link.projectId === selected_project_id && !link.sectionId);
                if (!links.length) { hide(); return; }
                mutate(async () => {
                    const existing = data.sections.find(section => section.projectId === selected_project_id);
                    const target = existing || await api.create("sections", { project: selected_project_id, name: "General", position: "1000" });
                    for (const [index, link] of links.entries()) await api.updateTaskProjectLink(link.id, { section: target.id, position: String((index + 1) * 1000) });
                }, hide);
                return;
            }
            const sections = mock_sections_by_project[selected_project_id] || [];
            const target = sections[0] || { id: `col_${Date.now()}`, label: "General", status: "Pend." };
            if (!sections.length) set_mock_sections_by_project(current => ({ ...current, [selected_project_id]: [target] }));
            set_tasks(current => current.map(task => task.project_id === selected_project_id && task.section === "unsectioned" ? { ...task, section: target.id, status: target.status || "Pend.", completed: target.id === "completed" } : task));
            hide();
            return;
        }
        if (real) { mutate(() => api.remove("sections", column_id)); return; }
        set_mock_sections_by_project(current => ({ ...current, [selected_project_id]: (current[selected_project_id] || []).filter(column_item => column_item.id !== column_id) }));
        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.project_id === selected_project_id && task_item.section === column_id ? { ...task_item, section: "unsectioned", status: "Pend.", completed: false } : task_item
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
        const scoped_tasks = task_scope === "mine"
            ? by_filters.filter((task_item) => isMyTask(task_item, current_user_id))
            : by_filters.filter((task_item) => task_item.project_id === selected_project_id);

        return get_sorted_tasks(real ? scoped_tasks.map(task => task_scope === "mine" ? { ...task, section: "unsectioned" } : task) : scoped_tasks, sort_field, sort_direction);
    }, [
        active_filters,
        search_query,
        selected_project_id,
        sort_direction,
        sort_field,
        task_scope,
        tasks
    ]);

    const selected_project = use_memo(() => (
        task_scope === "mine"
            ? { id: "my_tasks", label: "Mis tareas", description: "Tareas asignadas a ti" }
            : projects.find((project_item) => project_item.id === selected_project_id) || projects[0] || project_items[0] || { id: "", label: "Sin proyectos" }
    ), [projects, selected_project_id, task_scope]);

    const timeline_scope_id = task_scope === "mine" ? "my_tasks" : selected_project_id;
    const timeline_comments = real ? tasks.filter(item => task_scope === "mine" ? item.assignee_id === current_user_id : item.taskProjects.some(link => link.projectId === selected_project_id)).flatMap(item => item.comments).sort((a, b) => a.created_at.localeCompare(b.created_at)) : timeline_comments_by_scope[timeline_scope_id] || [];

    const selected_task = use_memo(() => {
        if (!selected_task_id) return null;
        return tasks.find((task_item) => task_item.id === selected_task_id) || null;
    }, [selected_task_id, tasks]);

    use_effect(() => {
        if (selected_inbox_id || !notifications.length) return;
        const default_notification = notifications.find((notification_item) => !notification_item.is_read) || notifications[0];
        set_selected_inbox_id(default_notification.id);
    }, [notifications, selected_inbox_id]);

    use_effect(() => {
        function handle_pointer_down(event) {
            if (event.target.closest(".task_tool_anchor, .inbox_dropdown, .task_options_panel, .mobile_more_button, .quick_popover_container, .project_menu_popover, .project_item_wrap")) {
                return;
            }

            set_is_notifications_open(false);
            set_active_task_tool(null);
            set_active_quick_popover(null);
            set_inbox_filter_menu(null);
            set_active_project_menu_id(null);
            set_active_modal((current_modal) => current_modal === "project_menu" ? null : current_modal);
        }

        document.addEventListener("pointerdown", handle_pointer_down);
        return () => document.removeEventListener("pointerdown", handle_pointer_down);
    }, []);


    use_effect(() => {
        if (!real) { list_tasks_request().then(rows => set_tasks(merge_saved_comments(rows))); return; }
        let mounted = true, running = null, dirty = false;
        refresh.current = () => {
            dirty = true;
            if (running) return running;
            running = (async () => {
                while (dirty && mounted) {
                    dirty = false;
                    const next = await loadTaskData(session);
                    if (!mounted) return;
                    setPresentationData(next);
                    set_data(next); set_projects(next.projects);
                    set_tasks(next.tasks.filter(item => !item.parentTaskId || !next.tasks.some(parent => parent.id === item.parentTaskId)));
                    set_notifications(next.notifications);
                    set_selected_project_id(id => next.projects.some(item => item.id === id) ? id : next.projects[0]?.id || "");
                    set_selected_task_id(id => next.tasks.some(item => item.id === id) ? id : null);
                }
            })().finally(() => { running = null; });
            return running;
        };
        const report = error => { if (mounted && error.name !== "AbortError") set_api_error(error.message); };
        refresh.current().then(async () => {
            const units = session.units;
            for (const unit of units) {
                if (!mounted) return;
                const allowed = await session.permissions.can("tasks.task.read", unit.id);
                if (mounted && allowed) connect_realtime_stream({ unitId: unit.id, token: session.token, assignmentId: session.activeAssignment.id, onEvent: () => refresh.current().catch(report), onReconnect: () => refresh.current().catch(report), onError: message => mounted && set_api_error(message) });
            }
        }).catch(report);
        // Secondary resources have no event stream; focus and polling reconcile them too.
        const reconcile = () => refresh.current().catch(report);
        window.addEventListener("focus", reconcile);
        const timer = setInterval(reconcile, 30000);
        return () => { mounted = false; clearInterval(timer); window.removeEventListener("focus", reconcile); disconnect_realtime_stream(); api.cancelRequests(); setPresentationData(null); };
    }, []);

    async function mutate(operation, on_success = () => {}) {
        if (mutation_pending.current) { set_api_error("Espera a que termine el guardado actual e inténtalo de nuevo."); return false; }
        mutation_pending.current = true; set_pending(true); set_api_error("");
        try {
            await operation(); await refresh.current(); on_success(); return true;
        } catch (error) {
            if (error.name !== "AbortError") {
                set_api_error(error.message);
                if (error.status === 404) { set_selected_task_id(null); set_active_modal(null); }
                // Reconcile partial multi-resource saves as well as rejected writes.
                await refresh.current().catch(() => {});
                if (error.partialDraft) {
                    set_selected_task_id(error.partialDraft.id); set_edit_draft(error.partialDraft);
                    set_edit_attachments(error.partialDraft.attachments || []); set_active_modal("edit_task");
                    set_api_error(`La tarea está guardada. Algunos cambios adicionales fallaron; puedes reintentarlos.\n${error.message}`);
                }
            }
            return false;
        } finally { mutation_pending.current = false; set_pending(false); }
    }

    useDialog(mobile && !!inbox_filter_menu, ".inbox_dropdown", () => set_inbox_filter_menu(null));
    useDialog(compact && inbox_detail_open && active_module === "inbox", ".inbox_detail_panel_open", () => set_inbox_detail_open(false));
    useDialog(mobile && !!active_task_tool, ".task_options_panel", () => set_active_task_tool(null));
    useDialog(compact && !!selected_task && !active_modal, ".task_detail_sidebar", () => set_selected_task_id(null));
    use_effect(() => {
        const escape = event => { if (event.key === "Escape") { set_active_task_tool(null); set_active_quick_popover(null); set_active_project_menu_id(null); set_inbox_filter_menu(null); set_active_modal(current => current === "project_menu" ? null : current); } };
        document.addEventListener("keydown", escape);
        return () => document.removeEventListener("keydown", escape);
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
        if (real) { mutate(async () => { for (const id of notifications.filter(item => !item.is_read).map(item => item.id)) await api.markNotificationRead(id); }); return; }
        set_notifications((current_notifications) => current_notifications.map((notification_item) => ({
            ...notification_item,
            is_read: true
        })));
    }

    function handle_inbox_activity_select(notification_id) {
        set_inbox_detail_open(true);
        if (real) { set_selected_inbox_id(notification_id); mutate(async () => { for (const id of [notification_id]) await api.markNotificationRead(id); }); return; }
        set_selected_inbox_id(notification_id);
        set_notifications((current_notifications) => current_notifications.map((notification_item) => (
            notification_item.id === notification_id ? { ...notification_item, is_read: true } : notification_item
        )));
    }

    function handle_toggle_inbox_saved(notification_id) {
        set_saved_inbox_ids((current_ids) => (
            current_ids.includes(notification_id)
                ? current_ids.filter((id) => id !== notification_id)
                : [...current_ids, notification_id]
        ));
    }

    function handle_toggle_inbox_archive(notification_id) {
        set_archived_inbox_ids((current_ids) => (
            current_ids.includes(notification_id)
                ? current_ids.filter((id) => id !== notification_id)
                : [...current_ids, notification_id]
        ));
        set_inbox_selected_ids((current_ids) => current_ids.filter((id) => id !== notification_id));
    }

    function handle_toggle_inbox_read(notification_id) {
        if (real && notifications.find(item => item.id === notification_id)?.is_read) { set_api_error("El servidor todavía no permite marcar notificaciones como no leídas."); return; }
        if (real) { mutate(async () => { for (const id of [notification_id]) await api.markNotificationRead(id); }); return; }
        set_notifications((current_notifications) => current_notifications.map((notification_item) => (
            notification_item.id === notification_id ? { ...notification_item, is_read: !notification_item.is_read } : notification_item
        )));
    }

    function handle_inbox_bulk_read_state(is_read) {
        if (real && !is_read) { set_api_error("El servidor todavía no permite marcar notificaciones como no leídas."); return; }
        if (real) { mutate(async () => { for (const id of inbox_selected_ids) await api.markNotificationRead(id); }); return; }
        set_notifications((current_notifications) => current_notifications.map((notification_item) => (
            inbox_selected_ids.includes(notification_item.id) ? { ...notification_item, is_read } : notification_item
        )));
        set_inbox_selected_ids([]);
    }

    function handle_inbox_bulk_save() {
        set_saved_inbox_ids((current_ids) => Array.from(new Set([...current_ids, ...inbox_selected_ids])));
        set_inbox_selected_ids([]);
    }

    function handle_inbox_bulk_archive() {
        inbox_selected_ids.forEach((notification_id) => handle_toggle_inbox_archive(notification_id));
        set_inbox_selected_ids([]);
    }

    function handle_open_inbox_task(task_id) {
        set_active_module("tasks");
        set_active_section("tasks");
        set_active_view("list");
        set_selected_task_id(task_id || null);
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
        set_inbox_detail_open(false);
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

    function handle_my_tasks_select() {
        set_task_scope("mine");
        set_active_module("tasks");
        set_active_section("tasks");
        set_selected_task_id(null);
        set_is_sidebar_open(false);
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

    function handle_detail_resize_start(event) {
        if (window.innerWidth <= 760) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const split_width = get_split_content_width(event.currentTarget.parentElement);
        const detail_width = event.currentTarget.nextElementSibling.getBoundingClientRect().width;
        const start_x = event.clientX;

        function handle_pointer_move(move_event) {
            set_task_detail_width(Math.min(split_width / 2, Math.max(320, detail_width + start_x - move_event.clientX)));
        }

        function handle_pointer_up() {
            window.removeEventListener("pointermove", handle_pointer_move);
            window.removeEventListener("pointerup", handle_pointer_up);
        }

        window.addEventListener("pointermove", handle_pointer_move);
        window.addEventListener("pointerup", handle_pointer_up);
    }

    function handle_detail_resize_key_down(event) {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const max_width = get_split_content_width(event.currentTarget.parentElement) / 2;
        const direction = event.key === "ArrowLeft" ? 16 : -16;
        set_task_detail_width((current_width) => Math.min(max_width, Math.max(320, current_width + direction)));
    }


    // Opens the "Editar tarea" modal and seeds the draft.
    function handle_open_edit_task(task_id) {
        const task_item = tasks.find((t) => t.id === task_id);
        if (!task_item) return;
        const draft_snapshot = {
            ...(real ? task_item : {}),
            title: task_item.title,
            description: task_item.description || "",
            project_id: task_item.project_id,
            section: task_item.section,
            assignee_id: task_item.assignee_id,
            collaborator_ids: Array.isArray(task_item.collaborator_ids) ? task_item.collaborator_ids : [],
            due_day: task_item.due_day,
            due_label: task_item.due_label || "",
            priority: task_item.priority,
            status: task_item.status,
            subtasks: (Array.isArray(task_item.subtasks) ? task_item.subtasks : []).map((subtask_item) => ({ ...subtask_item }))
        };
        set_selected_task_id(task_id);
        set_edit_draft(draft_snapshot);
        set_edit_attachments(real ? task_item.attachments : task_item.attachment_name ? [{ id: "existing_attachment", name: task_item.attachment_name }] : []);
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
        if (real) { const task = data.tasks.find(item => item.id === task_id); mutate(() => api.updateTask(task_id, taskPayload({ unitId: task.unitId, [field]: value }, data.statuses)), () => set_active_quick_popover(null)); return; }
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


    function handle_add_comment(task_id, comment_text, images = []) {
        if (real) {
            if (images.length) { set_api_error("Los comentarios admiten texto. A?ade los archivos como enlaces adjuntos a la tarea."); return Promise.resolve(false); }
            return comment_text.trim() ? mutate(() => api.createComment(task_id, comment_text.trim())) : Promise.resolve(false);
        }
        const body = comment_text.trim();
        if (!body && !images.length) return;

        const new_comment = {
            id: `comment_${Date.now()}`,
            task_id,
            author_name: current_user.name,
            body,
            images,
            created_at: new Date().toISOString()
        };

        set_tasks((current_tasks) => current_tasks.map((task_item) => {
            if (task_item.id !== task_id) return task_item;

            const comments = [...(Array.isArray(task_item.comments) ? task_item.comments : []), new_comment];
            save_task_comments(task_id, comments);
            return { ...task_item, comments };
        }));

        if (body) {
            add_comment_request(task_id, body, current_user.name).catch((error) => {
                console.warn("No se pudo sincronizar el comentario.", error);
            });
        }
    }


    // Toggles task completion and emits a local template event for future sync.
    function handle_toggle_task(task_id) {
        if (real) {
            const task = data.tasks.find(item => item.id === task_id);
            const status = data.statuses.find(item => (!item.unitId || item.unitId === task.unitId) && item.isFinal !== task.completed);
            if (status) mutate(() => api.updateTask(task_id, { status: status.id }));
            else set_api_error("No hay un estado compatible para cambiar la finalización.");
            return;
        }
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
        set_delete_target({ type: "project", id: selected_project_id });
        set_active_modal("delete_confirm");
    }

    function handle_add_timeline_comment(comment_text, images = []) {
        if (real) {
            if (!selected_task_id) { set_api_error("Selecciona una tarea para agregar su comentario."); return; }
            return handle_add_comment(selected_task_id, comment_text, images);
        }
        const body = comment_text.trim();
        if (!body && !images.length) return;

        const new_comment = {
            id: `timeline_comment_${Date.now()}`,
            author_id: current_user.id,
            author_name: current_user.name,
            body,
            images,
            created_at: new Date().toISOString()
        };

        set_timeline_comments_by_scope((current_comments) => ({
            ...current_comments,
            [timeline_scope_id]: [...(current_comments[timeline_scope_id] || []), new_comment]
        }));
    }

    // Deletes a task through the backend and removes it from local state.
    function handle_confirm_delete_task(task_id) {
        if (real) { mutate(() => api.deleteTask(task_id), () => { set_active_modal(null); set_selected_task_id(null); set_delete_target(null); }); return; }
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
        if (real) { mutate(() => api.remove("projects", project_id), () => { set_active_modal(null); set_delete_target(null); }); return; }
        const fallback_project = projects.find((project_item) => project_item.id !== project_id) || project_items[0] || { id: "", label: "Sin proyecto", color: "#9ca3af" };
        set_projects((current_projects) => current_projects.filter((project_item) => project_item.id !== project_id));
        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.project_id === project_id ? { ...task_item, project_id: fallback_project.id } : task_item
        )));
        set_selected_project_id(fallback_project.id);
        set_active_modal(null);
        set_delete_target(null);
    }


    // Toggles one subtask's completed state, optimistically and through the backend.
    function handle_toggle_subtask(task_id, subtask_id) {
        if (real) { handle_toggle_task(subtask_id); return; }
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

    function handle_edit_subtask_title_change(subtask_id, title) {
        set_edit_draft((current_draft) => ({
            ...current_draft,
            subtasks: current_draft.subtasks.map((subtask_item) => (
                subtask_item.id === subtask_id ? { ...subtask_item, title } : subtask_item
            ))
        }));
    }

    function handle_add_edit_subtask() {
        set_edit_draft((current_draft) => ({
            ...current_draft,
            subtasks: [...current_draft.subtasks, { id: `subtask_${Date.now()}`, title: "", completed: false }]
        }));
    }

    function handle_remove_edit_subtask(subtask_id) {
        set_edit_draft((current_draft) => ({
            ...current_draft,
            subtasks: current_draft.subtasks.filter((subtask_item) => subtask_item.id !== subtask_id)
        }));
    }

    function handle_toggle_edit_subtask(subtask_id) {
        set_edit_draft((current_draft) => ({
            ...current_draft,
            subtasks: current_draft.subtasks.map((subtask_item) => (
                subtask_item.id === subtask_id
                    ? { ...subtask_item, completed: !subtask_item.completed }
                    : subtask_item
            ))
        }));
    }


    // Updates one field of the "Editar tarea" draft as the user types/selects.
    function handle_edit_field_change(field_name, value) {
        if (real && field_name === "attachments") { set_edit_attachments(value); return; }
        if (real && field_name === "project_id") { set_edit_draft(draft => ({ ...draft, project_id: value, section: data.sections.find(item => item.projectId === value)?.id || "unsectioned" })); return; }
        set_edit_draft((current_draft) => ({ ...current_draft, [field_name]: value }));
    }


    // Simulates picking a file from the "Agregar mas" dropzone in the
    // "Editar tarea" modal (same placeholder behavior as the create modal).
    function handle_add_edit_attachment() {
        attachment_later();
    }

    function handle_remove_edit_attachment(attachment_id) {
        set_edit_attachments((current_attachments) => current_attachments.filter((attachment_item) => attachment_item.id !== attachment_id));
    }


    // Saves the "Editar tarea" draft, optimistically and through the backend.
    function handle_save_task_edits(event, task_id) {
        event.preventDefault();
        const title = (edit_draft.title || "").trim();
        if (!title) return set_api_error("El título de la tarea es obligatorio.");
        if (title.length > 220) return set_api_error("El título de la tarea no puede superar 220 caracteres.");
        const validated_draft = { ...edit_draft, title };
        if (real) { mutate(() => saveTaskDraft({ ...validated_draft, attachments: edit_attachments }, data, data.tasks.find(item => item.id === task_id)), () => set_active_modal(null)); return; }

        const due_label = validated_draft.due_day ? validated_draft.due_label || `${validated_draft.due_day} sep` : "";
        const completed = validated_draft.section === "completed";
        const updated_fields = { ...validated_draft, due_label, completed };

        set_tasks((current_tasks) => current_tasks.map((task_item) => (
            task_item.id === task_id ? { ...task_item, ...updated_fields } : task_item
        )));
        publish_task_event(create_task_event(task_event_types.task_updated, task_id, updated_fields));
        set_active_modal(null);

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
                    data={data} pending={pending} activeUnit={session.activeUnit?.id}
                    board_columns={board_columns}
                    on_cancel={() => set_active_modal(null)}
                    on_create={(new_task) => {
                        if (real) { mutate(() => saveTaskDraft(new_task, data), () => { set_active_modal(null); set_active_view("list"); }); return; }
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
                    projects={projects}
                    selected_project_id={selected_project_id}
                    status_options={status_options}
                />
            );
        }

        // New Master-Plan Editar modal
        if (active_modal === "edit_task" && selected_task && edit_draft) {
            return (
                <EditTaskModal
                    data={data} pending={pending}
                    board_columns={board_columns}
                    edit_attachments={edit_attachments}
                    edit_draft={edit_draft}
                    handle_add_edit_attachment={handle_add_edit_attachment}
                    handle_add_edit_subtask={handle_add_edit_subtask}
                    handle_edit_field_change={handle_edit_field_change}
                    handle_edit_subtask_title_change={handle_edit_subtask_title_change}
                    handle_remove_edit_attachment={handle_remove_edit_attachment}
                    handle_remove_edit_subtask={handle_remove_edit_subtask}
                    handle_toggle_edit_subtask={handle_toggle_edit_subtask}
                    on_cancel={() => { set_active_modal(null); }}
                    on_save={(event) => handle_save_task_edits(event, selected_task.id)}
                    projects={projects}
                    status_options={status_options}
                />
            );
        }

        if (active_modal === "share") {
            return <ShareProjectModal project={selected_project} pending={pending} onClose={() => set_active_modal(null)} onSave={handle_save_project_members} onError={set_api_error} />;
        }

        if (active_modal === "project") {
            return render_project_modal({
                editing_project: projects.find((project_item) => project_item.id === editing_project_id) || null,
                handle_create_project,
                project_color,
                project_people_ids,
                set_active_modal: (modal_id) => {
                    if (modal_id === null) set_editing_project_id(null);
                    set_active_modal(modal_id);
                },
                set_project_color,
                set_project_people_ids
            });
        }

        if (active_modal === "delete_confirm" && delete_target) {
            const is_task = delete_target.type === "task";
            const task_item = is_task ? tasks.find((item) => item.id === delete_target.id) : null;
            const project_item = is_task ? get_project(task_item?.project_id) : projects.find((item) => item.id === delete_target.id) || project_items[0] || { id: "", label: "Sin proyecto", color: "#9ca3af" };

            return (
                <DeleteConfirmModal
                    pending={pending}
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


    if (real && !data) return <div className="bold_modal_backdrop"><div className="bold_modal_window"><div className="bold_modal_body"><p role="status">{api_error || "Cargando tus tareas…"}</p><button className="secondary_button" onClick={session.logout}>Cerrar sesión</button><button className="primary_button" onClick={() => refresh.current().catch(error => set_api_error(error.message))}>Reintentar</button></div></div></div>;

    // Returns the full shell with the focused tasks module.
    return (
        <AppShell
            sidebarProps={{ handle_module_change, navigationSlots: { tasks: { id: "tasks_workspace_menu", open: is_tasks_menu_open, onToggle: handle_tasks_menu_toggle, content: render_tasks_workspace_menu(handle_my_tasks_select, () => handle_module_change("projects"), set_active_modal, recent_project_ids.map(id => projects.find(project => project.id === id)).filter(Boolean), selected_project_id, handle_project_select, handle_project_menu_toggle, active_project_menu_id, task_scope, is_tasks_menu_open, active_module === "projects") } } }}
            mobileHeaderProps={{ detailOpen: !!selected_task || (active_module === "inbox" && inbox_detail_open), detailTitle: selected_task ? "Detalle de tarea" : active_module === "inbox" && inbox_detail_open ? "Detalle de actividad" : null, onBack: () => { set_selected_task_id(null); set_inbox_detail_open(false); }, onMore: () => set_active_modal(selected_task ? "project_menu" : null) }}
            topBarProps={{ searchPlaceholder: active_module === "projects" ? "Buscar proyectos por nombre" : "Buscar tareas, proyectos o personas", handle_close_notifications, handle_mark_notifications_read, handle_toggle_notifications, is_notifications_open, notifications: notifications.map(item => ({ ...item, actor: team_members.find(member => member.id === item.actor_id), icon: notification_type_icons[item.type] })), search_query, set_search_query }}
            feedback={real && (api_error || pending) && <div className="api_feedback" role={api_error ? "alert" : "status"}>{pending ? "Guardando…" : api_error}<button type="button" onClick={() => set_api_error("")} aria-label="Cerrar mensaje">×</button></div>}
            overlays={<>{render_active_modal()}{render_project_menu(set_active_modal, handle_request_delete_project, active_modal === "project_menu")}</>}
        >
                <div className="module_transition" key={active_module}>
                {active_module === "home" ? <HomeModule
                    currentUser={current_user}
                    notifications={notifications}
                    onCreateProject={() => set_active_modal("project")}
                    onCreateTask={() => set_active_modal("task")}
                    onOpenProject={handle_project_select}
                    onOpenReports={() => handle_module_change("reports")}
                    onOpenTask={(task_id) => {
                        set_active_module("tasks");
                        set_active_section("tasks");
                        handle_task_select(task_id);
                    }}
                    onOpenTasks={handle_my_tasks_select}
                    onToggleTask={handle_toggle_task}
                    parseDueDate={parse_due_date}
                    projects={projects}
                    tasks={real ? tasks.map(task => projectTask(task, null)) : tasks}
                /> : active_module === "projects" ? render_projects_module({
                    projects,
                    selected_project_id,
                    tasks: stored_tasks,
                    search_query,
                    onCreate: () => { set_editing_project_id(null); set_project_color(project_color_options[0]); set_project_people_ids([]); set_active_modal("project"); },
                    onOpen: handle_project_select,
                    onEdit: id => handle_project_menu_toggle(id, "edit"),
                    onShare: handle_share_project,
                    onDelete: id => handle_project_menu_toggle(id, "delete")
                }) : active_module === "tasks" ? render_tasks_module({
                    mobile_actions: { onEdit: handle_open_edit_task, onDelete: handle_request_delete_task, onMove: (id, section) => handle_column_drop(section, id), sections: board_columns },
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
                    handle_add_timeline_comment,
                    handle_clear_filters,
                    handle_close_task_tool,
                    handle_column_drop,
                    handle_delete_column,
                    handle_delete_task: handle_request_delete_task,
                    handle_detail_resize_key_down,
                    handle_detail_resize_start,
                    handle_drag_end,
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
                    selected_project,
                    search_query,
                    selected_task,
                    selected_task_id,
                    task_detail_width,
                    timeline_comments,
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
                }) : active_module === "inbox" ? render_inbox_module({
                    inbox_detail_open, close_inbox_detail: () => set_inbox_detail_open(false),
                    archived_inbox_ids,
                    handle_inbox_activity_select,
                    handle_inbox_bulk_archive,
                    handle_inbox_bulk_read_state,
                    handle_inbox_bulk_save,
                    handle_mark_notifications_read,
                    handle_open_inbox_task,
                    handle_toggle_inbox_read,
                    handle_toggle_inbox_archive,
                    handle_toggle_inbox_saved,
                    inbox_filter_menu,
                    inbox_filters,
                    inbox_query,
                    inbox_selected_ids,
                    inbox_view,
                    inbox_tab,
                    notifications,
                    saved_inbox_ids,
                    selected_inbox_id,
                    set_inbox_filter_menu,
                    set_inbox_filters,
                    set_inbox_query,
                    set_inbox_selected_ids,
                    set_inbox_tab,
                    set_inbox_view,
                    set_is_notifications_open,
                    tasks
                }) : active_module === "schedules" ? render_schedules_module({
                    filtered_tasks,
                    handle_task_select,
                    schedule_view,
                    set_active_modal,
                    set_schedule_view
                }) : active_module === "reports" ? <ReportsModule tasks={tasks} projects={projects} parseDueDate={parse_due_date} /> : render_placeholder_module(active_module)}
                </div>
        </AppShell>
    );
}


export default function TasksModule() {
    const core = useCore();
    return <TaskAppErrorBoundary><TaskAppContent key={core.activeAssignment?.id || "template"} /></TaskAppErrorBoundary>;
}
