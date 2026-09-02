import { create_task_event } from "./task_events.js";
import { task_event_types } from "./task_events.js";
import { project_items, starter_tasks, team_members } from "../data/task_data.js";


// Switches the whole client between the in-memory template data (default,
// used for the demo) and the real boldApp backend. Every exported function
// below keeps the exact same name/signature in both modes, so flipping this
// one flag (VITE_USE_REAL_BACKEND=true) is the entire "rework" needed to
// swap templates for real endpoints later.
const use_real_backend = import.meta.env.VITE_USE_REAL_BACKEND === "true";

export function is_using_real_backend() {
    return use_real_backend;
}


// Defines the live API client configuration, pointed at the boldApp backend.
const api_client_config = {
    base_url: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
    demo_workspace_name: import.meta.env.VITE_DEMO_WORKSPACE_NAME || "Bold Demo",
    demo_user_email: import.meta.env.VITE_DEMO_USER_EMAIL || "ana@bold.gt"
};


// ---------------------------------------------------------------------------
// Modo plantilla: almacen en memoria sembrado desde task_data.js. Ninguna de
// estas funciones toca la red; existen solo para que la UI tenga un backend
// con el que conversar mientras el backend real no esta en juego para la demo.
// ---------------------------------------------------------------------------

let template_tasks = starter_tasks.map((task_item) => ({
    comments: [],
    ...task_item,
    subtasks: task_item.subtasks.map((subtask_item) => ({ ...subtask_item }))
}));


// Lists tasks from the in-memory template store.
async function list_tasks_via_template() {
    return template_tasks.map((task_item) => ({ ...task_item }));
}


// Adds a task to the in-memory template store.
async function create_task_via_template(task_payload) {
    const new_task = {
        comments: [],
        subtasks: [],
        ...task_payload
    };

    template_tasks = [...template_tasks, new_task];

    return { ...new_task };
}


// Merges the given fields into a task already in the template store.
async function update_task_via_template(task_id, task_payload) {
    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id ? { ...task_item, ...task_payload } : task_item
    ));

    return { ok: true };
}


// Moves a task to a different board column in the template store.
async function move_task_via_template(task_id, section) {
    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id ? { ...task_item, section } : task_item
    ));

    return { ok: true };
}


// Removes a task from the template store.
async function delete_task_via_template(task_id) {
    template_tasks = template_tasks.filter((task_item) => task_item.id !== task_id);

    return { ok: true, deleted: true };
}


// Adds a comment to a task in the template store.
export async function add_comment(task_id, comment_body, author_name) {
    const new_comment = {
        id: `comment_${Date.now()}`,
        author_name,
        body: comment_body,
        created_at: new Date().toISOString()
    };

    template_tasks = template_tasks.map((task_item) => (
        task_item.id === task_id
            ? { ...task_item, comments: [...task_item.comments, new_comment] }
            : task_item
    ));

    create_task_event(task_event_types.comment_created, task_id, new_comment);

    return new_comment;
}


// Toggles one subtask's completed state on a task in the template store.
export async function toggle_subtask(task_id, subtask_id) {
    template_tasks = template_tasks.map((task_item) => {
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
    });

    return { ok: true };
}


// ---------------------------------------------------------------------------
// Modo backend real: llamadas HTTP contra la API de boldApp (Django REST
// Framework). Queda intacto y listo para activarse con VITE_USE_REAL_BACKEND.
// ---------------------------------------------------------------------------

// Caches the resolved demo context (workspace/users/projects/sections/statuses)
// so it only needs to be fetched once per page load.
let cached_demo_context = null;

// Caches, per backend task id, the linked task_project row and its local
// project id, so move_task() can update the right board column without an
// extra round trip.
const task_link_cache = {};


// Sends a request to the boldApp REST API and returns the parsed JSON body.
async function api_fetch(path, options = {}) {
    const response = await fetch(`${api_client_config.base_url}${path}`, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    if (!response.ok) {
        const error_body = await response.text();
        throw new Error(`boldApp API ${options.method || "GET"} ${path} -> ${response.status}: ${error_body}`);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}


// Unwraps a DRF list response, which is paginated ({results: [...]}) once
// the demo dataset grows past the default page size, or a plain array.
function unwrap_list(response) {
    return response && response.results ? response.results : response || [];
}


// Resolves the demo workspace, users, projects, sections, and task statuses
// used to translate between the frontend's flat task shape and the
// backend's normalized models (Task/TaskStatus/Section/TaskProject).
async function resolve_demo_context() {
    if (cached_demo_context) {
        return cached_demo_context;
    }

    const [workspaces_response, users_response] = await Promise.all([
        api_fetch("/api/workspaces/"),
        api_fetch("/api/users/")
    ]);

    const workspace_list = unwrap_list(workspaces_response);
    const user_list = unwrap_list(users_response);

    const workspace = workspace_list.find((item) => item.name === api_client_config.demo_workspace_name);
    if (!workspace) {
        throw new Error(
            `No se encontro el workspace de demo "${api_client_config.demo_workspace_name}". ` +
            "Corre 'python manage.py seed_demo_data' en el backend."
        );
    }

    const demo_user = user_list.find((item) => item.email === api_client_config.demo_user_email) || null;

    const user_map = {};
    for (const member_item of team_members) {
        const backend_user = user_list.find((item) => item.email === member_item.email);
        if (backend_user) {
            user_map[member_item.id] = backend_user;
        }
    }

    const projects_response = await api_fetch(`/api/projects/?workspace=${workspace.id}`);
    const project_list = unwrap_list(projects_response);

    const project_map = {};
    for (const project_item of project_items) {
        const backend_project = project_list.find((item) => item.name === project_item.label);
        if (backend_project) {
            project_map[project_item.id] = backend_project;
        }
    }

    const section_and_status_map = {};
    for (const [local_project_id, backend_project] of Object.entries(project_map)) {
        const [sections_response, statuses_response] = await Promise.all([
            api_fetch(`/api/sections/?project=${backend_project.id}`),
            api_fetch(`/api/task-statuses/?project=${backend_project.id}`)
        ]);

        const section_list = unwrap_list(sections_response);
        const status_list = unwrap_list(statuses_response);

        section_and_status_map[local_project_id] = {
            sections_by_name: Object.fromEntries(section_list.map((item) => [item.name, item])),
            statuses_by_category: Object.fromEntries(status_list.map((item) => [item.category, item])),
            statuses_by_id: Object.fromEntries(status_list.map((item) => [item.id, item]))
        };
    }

    cached_demo_context = {
        workspace,
        demo_user,
        user_map,
        project_map,
        section_and_status_map
    };

    return cached_demo_context;
}


// Finds the local key (task_data.js id) whose mapped backend record matches
// the given backend id, or null when there is no match.
function reverse_lookup_local_id(local_to_backend_map, backend_id) {
    const found_entry = Object.entries(local_to_backend_map).find(([, backend_item]) => backend_item.id === backend_id);
    return found_entry ? found_entry[0] : null;
}


// Builds a simple, increasing ordering value for `position` fields.
// DecimalField(max_digits=20, decimal_places=10) allows at most 10 integer
// digits, so this uses Unix seconds (10 digits) rather than milliseconds.
function build_position_value() {
    return String(Math.floor(Date.now() / 1000));
}


// Builds the backend Task payload from the frontend's flat task shape.
function map_task_to_backend(local_task, context) {
    const backend_assignee = context.user_map[local_task.assignee_id];
    const status_map = context.section_and_status_map[local_task.project_id]?.statuses_by_category || {};
    const backend_status = status_map[local_task.section];
    const due_day = String(local_task.due_day || 8).padStart(2, "0");

    return {
        workspace: context.workspace.id,
        created_by: context.demo_user ? context.demo_user.id : backend_assignee?.id,
        assignee: backend_assignee ? backend_assignee.id : null,
        status: backend_status ? backend_status.id : null,
        title: local_task.title,
        description: local_task.description,
        priority: local_task.priority,
        // The mock dataset hardcodes September (see the "Septiembre 2026"
        // calendar header in task_app.jsx); this mirrors that same demo-only
        // assumption instead of solving general date handling.
        due_date: `2026-09-${due_day}`,
        position: build_position_value()
    };
}


// Builds the frontend's flat task shape from a backend Task plus the
// task_projects link that places it on a project board/column.
function map_task_from_backend(backend_task, context, link_info) {
    const local_project_id = link_info?.local_project_id || null;
    const status_item = local_project_id
        ? context.section_and_status_map[local_project_id]?.statuses_by_id[backend_task.status]
        : null;
    const due_day = backend_task.due_date ? Number(backend_task.due_date.split("-")[2]) : null;

    return {
        id: backend_task.id,
        title: backend_task.title,
        description: backend_task.description || "",
        project_id: local_project_id || project_items[0].id,
        section: status_item ? status_item.category : "todo",
        assignee_id: reverse_lookup_local_id(context.user_map, backend_task.assignee) || "",
        due_day: due_day || 8,
        due_label: due_day ? `${due_day} sep` : "",
        priority: backend_task.priority,
        status: status_item ? status_item.name : "Pend.",
        completed: status_item ? status_item.is_final : false,
        tags: [],
        subtasks: [],
        comments: [],
        attachment_name: null
    };
}


// Resolves the demo workspace id, so callers (e.g. task_app.jsx) can open
// the live WebSocket connection without duplicating the lookup logic.
export async function get_demo_workspace_id() {
    const context = await resolve_demo_context();
    return context.workspace.id;
}


// Lists tasks for the demo workspace from the real backend.
async function list_tasks_via_backend() {
    const context = await resolve_demo_context();
    const tasks_response = await api_fetch(`/api/tasks/?workspace=${context.workspace.id}`);
    const backend_tasks = unwrap_list(tasks_response);

    const link_by_task_id = {};
    for (const [local_project_id, backend_project] of Object.entries(context.project_map)) {
        const task_projects_response = await api_fetch(`/api/task-projects/?project=${backend_project.id}`);
        const task_project_list = unwrap_list(task_projects_response);

        for (const task_project_item of task_project_list) {
            const link_info = {
                local_project_id,
                task_project_id: task_project_item.id
            };
            link_by_task_id[task_project_item.task] = link_info;
            task_link_cache[task_project_item.task] = link_info;
        }
    }

    return backend_tasks.map((backend_task) => map_task_from_backend(backend_task, context, link_by_task_id[backend_task.id]));
}


// Creates a task through the real backend, then links it to its project and
// board column via the task_projects bridge table.
async function create_task_via_backend(task_payload) {
    const context = await resolve_demo_context();
    const backend_payload = map_task_to_backend(task_payload, context);
    const created_task = await api_fetch("/api/tasks/", {
        method: "POST",
        body: JSON.stringify(backend_payload)
    });

    const backend_project = context.project_map[task_payload.project_id];
    let task_project_id = null;

    if (backend_project) {
        const section_map = context.section_and_status_map[task_payload.project_id]?.sections_by_name || {};
        const backend_section = section_map[task_payload.section];

        const task_project = await api_fetch("/api/task-projects/", {
            method: "POST",
            body: JSON.stringify({
                task: created_task.id,
                project: backend_project.id,
                section: backend_section ? backend_section.id : null,
                added_by: context.demo_user ? context.demo_user.id : backend_payload.created_by,
                position: build_position_value()
            })
        });
        task_project_id = task_project.id;

        task_link_cache[created_task.id] = {
            local_project_id: task_payload.project_id,
            task_project_id
        };
    }

    create_task_event(task_event_types.task_created, created_task.id, task_payload);

    return {
        ...task_payload,
        id: created_task.id
    };
}


// Updates a task's editable fields (and workflow status) through the real backend.
async function update_task_via_backend(task_id, task_payload) {
    const context = await resolve_demo_context();
    const status_map = context.section_and_status_map[task_payload.project_id]?.statuses_by_category || {};
    const backend_status = status_map[task_payload.section];

    return api_fetch(`/api/tasks/${task_id}/`, {
        method: "PATCH",
        body: JSON.stringify({
            title: task_payload.title,
            description: task_payload.description,
            priority: task_payload.priority,
            status: backend_status ? backend_status.id : null
        })
    });
}


// Moves a task between board columns by updating its task_projects link.
async function move_task_via_backend(task_id, section) {
    const context = await resolve_demo_context();
    const link = task_link_cache[task_id];

    if (!link) {
        return { ok: false, message: "No se encontro el vinculo proyecto-tarea para mover la seccion." };
    }

    const section_map = context.section_and_status_map[link.local_project_id]?.sections_by_name || {};
    const backend_section = section_map[section];

    return api_fetch(`/api/task-projects/${link.task_project_id}/`, {
        method: "PATCH",
        body: JSON.stringify({
            section: backend_section ? backend_section.id : null
        })
    });
}


// Deletes (soft-deletes) a task through the real backend.
async function delete_task_via_backend(task_id) {
    await api_fetch(`/api/tasks/${task_id}/`, {
        method: "DELETE"
    });

    delete task_link_cache[task_id];

    return { ok: true, deleted: true };
}


// ---------------------------------------------------------------------------
// Interfaz publica: mismas firmas en ambos modos. task_app.jsx llama estas
// funciones sin saber (ni le importa) si hay plantillas o backend real detras.
// ---------------------------------------------------------------------------

export async function list_tasks(query_params = {}) {
    return use_real_backend ? list_tasks_via_backend(query_params) : list_tasks_via_template();
}

export async function create_task(task_payload) {
    return use_real_backend ? create_task_via_backend(task_payload) : create_task_via_template(task_payload);
}

export async function update_task(task_id, task_payload) {
    return use_real_backend ? update_task_via_backend(task_id, task_payload) : update_task_via_template(task_id, task_payload);
}

export async function move_task(task_id, section) {
    return use_real_backend ? move_task_via_backend(task_id, section) : move_task_via_template(task_id, section);
}

export async function delete_task(task_id) {
    return use_real_backend ? delete_task_via_backend(task_id) : delete_task_via_template(task_id);
}
