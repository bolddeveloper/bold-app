import { Children, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { dateFromISO } from "./services/task_models.js";
import { emptyWorkspaceFilters, filterWorkspaceTasks, groupWorkspaceTasks, sortWorkspaceTasks, workspaceProjectIds, workspaceSectionIds } from "./services/workspace_operations.js";
import "./workspace_operations.css";

const DEFAULT_FIELDS = ["assignee", "project", "due", "priority", "status"];
const FIELD_LABELS = { assignee: "Responsable", project: "Proyecto", due: "Fecha límite", priority: "Prioridad", status: "Estado", section: "Sección", created: "Creación", creator: "Creado por", subtasks: "Subtareas", attachments: "Archivos" };
const DATE_OPTIONS = [["", "Cualquier fecha"], ["today", "Hoy"], ["tomorrow", "Mañana"], ["week", "Esta semana"], ["next7", "Próximos 7 días"], ["next30", "Próximos 30 días"], ["overdue", "Vencidas"], ["none", "Sin fecha"]];
const PRIORITIES = [["Alta", "Alta"], ["Media", "Media"], ["Baja", "Baja"]];
const SORT_OPTIONS = [["due", "Fecha límite"], ["priority", "Prioridad"], ["status", "Estado"], ["assignee", "Responsable"], ["project", "Proyecto"], ["created", "Fecha de creación"], ["title", "Nombre"], ["completed", "Completadas"], ["incomplete", "Sin completar"]];
const GROUP_OPTIONS = [["", "Sin agrupar"], ["status", "Estado"], ["project", "Proyecto"], ["section", "Sección"], ["assignee", "Responsable"], ["priority", "Prioridad"], ["due", "Mes de vencimiento"]];

function MultiFilter({ label, values, options, onChange }) {
    return <fieldset><legend>{label}</legend><div className="workspace_filter_options">{options.map(([id, name]) => <label key={id}><input type="checkbox" checked={values.includes(String(id))} onChange={() => onChange(String(id))} />{name}</label>)}</div></fieldset>;
}

export default function WorkspaceOperations({ TaskSelect, tasks, projects, sections, statuses, members, units, activeUnitId, storageKey, pending, loading, permissionsCan, onOpenTask, onEditTask, onOpenCreate, onQuickCreate, onBulk }) {
    const Select = useMemo(() => function WorkspaceSelect({ children, onChange, value, disabled, ...props }) {
        const options = Children.toArray(children).filter(child => child?.type === "option").map(child => ({ value: child.props.value, label: child.props.children, disabled: child.props.disabled }));
        return <TaskSelect class_name="workspace_select" aria_label={props["aria-label"] || options[0]?.label} value={value} disabled={disabled} options={options} on_change={nextValue => onChange?.({ target: { value: nextValue } })} />;
    }, [TaskSelect]);
    const [query, setQuery] = useState("");
    const [filters, setFilters] = useState(emptyWorkspaceFilters);
    const [sort, setSort] = useState("due");
    const [direction, setDirection] = useState("asc");
    const [group, setGroup] = useState("");
    const [fields, setFields] = useState(DEFAULT_FIELDS);
    const [selected, setSelected] = useState([]);
    const [expanded, setExpanded] = useState([]);
    const [openRowId, setOpenRowId] = useState(null);
    const [rowRights, setRowRights] = useState({ create: !permissionsCan, update: !permissionsCan, delete: !permissionsCan });
    const [displayLimit, setDisplayLimit] = useState(100);
    const [quickTitle, setQuickTitle] = useState("");
    const [quickParent, setQuickParent] = useState(null);
    const [quickAssignee, setQuickAssignee] = useState("");
    const [quickDate, setQuickDate] = useState("");
    const [batchText, setBatchText] = useState("");
    const [batchParent, setBatchParent] = useState(null);
    const [batchProject, setBatchProject] = useState("");
    const [batchSection, setBatchSection] = useState("");
    const [batchAssignee, setBatchAssignee] = useState("");
    const [batchPriority, setBatchPriority] = useState("Media");
    const [batchDate, setBatchDate] = useState("");
    const [viewName, setViewName] = useState("");
    const [modal, setModal] = useState("");
    const [views, setViews] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; } });
    const [error, setError] = useState("");
    const filtersRef = useRef(null);
    const [allowed, setAllowed] = useState({ create: !permissionsCan, update: !permissionsCan, delete: !permissionsCan });
    useDialog(!!modal, ".workspace_modal", () => setModal(""));
    useEffect(() => { setViews(() => { try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; } }); setSelected([]); }, [storageKey]);
    useEffect(() => setDisplayLimit(100), [query, filters, sort, direction, group]);
    useEffect(() => { const close = event => document.querySelectorAll(".workspace_ops details[open]").forEach(details => { if ((event.type === "keydown" && event.key === "Escape") || (event.type === "pointerdown" && !details.contains(event.target))) details.open = false; }); document.addEventListener("keydown", close); document.addEventListener("pointerdown", close); return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); }; }, []);

    const projectNames = useMemo(() => Object.fromEntries(projects.map(item => [String(item.id), item.label || item.name])), [projects]);
    const sectionNames = useMemo(() => Object.fromEntries(sections.map(item => [String(item.id), item.label || item.name])), [sections]);
    const memberNames = useMemo(() => Object.fromEntries(members.map(item => [String(item.id), item.name])), [members]);
    const searchableTasks = useMemo(() => tasks.map(task => ({ ...task, assignee_name: memberNames[String(task.assignee_id)] || "", workspace_search: workspaceProjectIds(task).map(id => projectNames[id]).join(" ") })), [tasks, memberNames, projectNames]);
    const allById = useMemo(() => new Map(tasks.map(task => [String(task.id), task])), [tasks]);
    const filtered = useMemo(() => sortWorkspaceTasks(filterWorkspaceTasks(searchableTasks, filters, query), sort, direction), [searchableTasks, filters, query, sort, direction]);
    const matchingIds = useMemo(() => new Set(filtered.map(task => String(task.id))), [filtered]);
    const matchingRoots = filtered.filter(task => !task.parentTaskId || !allById.has(String(task.parentTaskId)) || !matchingIds.has(String(task.parentTaskId)));
    const visibleRoots = matchingRoots.slice(0, displayLimit);
    const groups = groupWorkspaceTasks(visibleRoots, group, { ...projectNames, ...sectionNames, ...memberNames });
    const visibleIds = filtered.map(task => String(task.id));
    const selectedIds = selected.filter(id => allById.has(id));
    const selectedUnits = [...new Set(selectedIds.map(id => allById.get(id)?.unitId || activeUnitId))];
    const selectedProjects = [...new Set(selectedIds.map(id => workspaceProjectIds(allById.get(id))[0] || ""))];
    useEffect(() => {
        if (!permissionsCan) return;
        let active = true;
        const selectedTasks = selectedIds.map(id => allById.get(id));
        Promise.all([
            permissionsCan("tasks.task.create", activeUnitId),
            selectedTasks.length ? Promise.all(selectedTasks.map(task => permissionsCan("tasks.task.update", task.unitId, task.id))).then(results => results.every(Boolean)) : false,
            selectedTasks.length ? Promise.all(selectedTasks.map(task => permissionsCan("tasks.task.delete", task.unitId, task.id))).then(results => results.every(Boolean)) : false,
        ]).then(([create, update, canDelete]) => { if (active) setAllowed({ create, update, delete: canDelete }); }).catch(() => { if (active) setAllowed({ create: false, update: false, delete: false }); });
        return () => { active = false; };
    }, [permissionsCan, activeUnitId, selected.join("|"), allById]);
    const activeChips = Object.entries(filters).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : value ? [[key, value]] : []);
    const toggleFilter = (key, value) => setFilters(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] }));
    const setFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }));
    const toggleSelect = id => setSelected(current => current.includes(String(id)) ? current.filter(item => item !== String(id)) : [...current, String(id)]);
    const selectVisible = () => setSelected(current => visibleIds.every(id => current.includes(id)) ? current.filter(id => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
    const persistViews = next => { try { localStorage.setItem(storageKey, JSON.stringify(next)); setViews(next); } catch { setError("No se pudo guardar la vista en este navegador."); } };
    const saveView = event => { event.preventDefault(); const name = viewName.trim(); if (!name) return; persistViews([...views.filter(view => view.name !== name), { name, query, filters, sort, direction, group, fields }]); setViewName(""); setModal(""); };
    const applyView = view => { setQuery(view?.query || ""); setFilters(view?.filters || emptyWorkspaceFilters()); setSort(view?.sort || "due"); setDirection(view?.direction || "asc"); setGroup(view?.group || ""); setFields(view?.fields || DEFAULT_FIELDS); setSelected([]); };
    const run = async (operation, ids, changes) => { setError(""); if (ids.length > 100 || changes?.items?.length > 100) { setError("Cada operación admite hasta 100 tareas. Reduce la selección y vuelve a intentarlo."); return false; } try { if (permissionsCan) { const code = operation === "create" ? "tasks.task.create" : operation === "delete" ? "tasks.task.delete" : "tasks.task.update"; const targets = operation === "create" ? changes.items.map(item => [item.unitId || activeUnitId, null]) : ids.map(id => [allById.get(String(id))?.unitId, id]); const checks = await Promise.all(targets.map(([unitId, id]) => permissionsCan(code, unitId, id))); if (checks.some(value => !value)) { setError("No tienes permiso para aplicar esta acción a todas las tareas seleccionadas."); return false; } } const ok = await onBulk(operation, ids, changes); if (ok) { setSelected([]); setModal(""); return true; } setError("No se aplicaron los cambios. Revisa el mensaje de la aplicación."); } catch (exception) { setError(exception.message); } return false; };
    const quickCreate = async event => { event.preventDefault(); const title = quickTitle.trim(); if (!title) return; const parent = quickParent ? allById.get(String(quickParent)) : null; const ok = await onQuickCreate({ title, parentTaskId: quickParent, unitId: parent?.unitId || activeUnitId, project_id: workspaceProjectIds(parent || {})[0] || "", assignee_id: quickAssignee || parent?.assignee_id || "", due_date: quickDate || null, priority: parent?.priority || "Media" }); if (ok) { setQuickTitle(""); setQuickParent(null); setQuickAssignee(""); setQuickDate(""); } };
    const batchCreate = async event => { event.preventDefault(); const titles = batchText.split(/\r?\n/).map(title => title.trim()).filter(Boolean); if (!titles.length || titles.length > 100) { setError("Escribe entre 1 y 100 nombres de tarea, uno por línea."); return; } const parent = batchParent ? allById.get(String(batchParent)) : null; const ok = await run("create", [], { items: titles.map(title => ({ title, parentTaskId: parent?.id || null, unitId: parent?.unitId || activeUnitId, project_id: batchProject || workspaceProjectIds(parent || {})[0] || "", section: batchSection || null, assignee_id: batchAssignee || parent?.assignee_id || "", priority: batchPriority, due_date: batchDate || null })) }); if (ok) setBatchText(""); };
    const bulkUpdate = (field, value) => { if (value === "") return; if (field === "project" || field === "section") { const projectsInSelection = [...new Set(selectedIds.map(id => workspaceProjectIds(allById.get(id))[0]).filter(Boolean))]; if (field === "section" && projectsInSelection.length !== 1) { setError("Selecciona tareas de un mismo proyecto para cambiar su sección."); return; } const project = field === "project" ? value : projectsInSelection[0]; if (!project) { setError("Selecciona primero un proyecto."); return; } run("link", selectedIds, { project, ...(field === "section" ? { section: value } : {}) }); } else run("update", selectedIds, { [field]: value }); };
    const changeCompletion = done => { const unitIds = [...new Set(selectedIds.map(id => allById.get(id)?.unitId || activeUnitId))]; if (unitIds.length !== 1) { setError("Selecciona tareas de una misma unidad para cambiar su finalización juntas."); return; } const status = statuses.find(item => (item.unitId || item.unit || activeUnitId) === unitIds[0] && !!item.isFinal === done); if (!status) { setError("No hay un estado compatible para estas tareas."); return; } bulkUpdate("status", status.id); };
    const inlineUpdate = (task, field, value) => { if (field === "project" || field === "section") { const project = field === "project" ? value : workspaceProjectIds(task)[0]; if (!project) { setError("Selecciona primero un proyecto."); return; } run("link", [String(task.id)], { project, ...(field === "section" ? { section: value } : {}) }); } else run("update", [String(task.id)], { [field]: value }); };
    const toggleCompletion = task => { const status = statuses.find(item => (item.unitId || item.unit || activeUnitId) === (task.unitId || activeUnitId) && !!item.isFinal !== !!task.completed); if (status) run("update", [String(task.id)], { status: status.id }); else setError("No hay un estado compatible para esta tarea."); };
    const deleteSelected = () => { if (window.confirm(`¿Eliminar ${selectedIds.length} tareas? También afectará a las subtareas seleccionadas.`)) run("delete", selectedIds, {}); };
    const duplicateSelected = () => run("create", [], { items: selectedIds.map(id => { const task = allById.get(id); return { title: `${task.title} (copia)`, unitId: task.unitId || activeUnitId, project_id: workspaceProjectIds(task)[0] || "", assignee_id: task.assignee_id || "", priority: task.priority, due_date: task.due_date || null }; }) });
    const toggleRowActions = async task => { if (openRowId === task.id) { setOpenRowId(null); return; } setOpenRowId(task.id); if (!permissionsCan) return; setRowRights({ create: false, update: false, delete: false }); try { const [create, update, canDelete] = await Promise.all([permissionsCan("tasks.task.create", task.unitId), permissionsCan("tasks.task.update", task.unitId, task.id), permissionsCan("tasks.task.delete", task.unitId, task.id)]); setRowRights({ create, update, delete: canDelete }); } catch { setRowRights({ create: false, update: false, delete: false }); } };
    const submitSubtasks = async event => {
        event.preventDefault();
        const titles = batchText.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        const count = titles.length * selectedIds.length;
        if (!count || count > 100) { setError("El lote debe contener entre 1 y 100 subtareas."); return; }
        if (!window.confirm(`Se crearán ${count} subtareas en ${selectedIds.length} tareas. ¿Continuar?`)) return;
        const items = selectedIds.flatMap(id => titles.map(title => ({ title, parentTaskId: id, unitId: allById.get(id).unitId || activeUnitId, priority: batchPriority })));
        if (await run("create", [], { items })) setBatchText("");
    };
    const option = (id, label) => <option value={id} key={id}>{label}</option>;
    const projectOptions = projects.map(item => option(item.id, item.label || item.name));
    const memberOptions = members.map(item => option(item.id, item.name));
    const memberOptionsFor = unitId => members.filter(item => !item.unitId || item.unitId === unitId).map(item => option(item.id, item.name));
    const statusOptionsFor = unitId => statuses.filter(item => !item.unitId || item.unitId === unitId).map(item => option(item.id, item.label || item.name));
    const visible = field => fields.includes(field);
    const cell = (task, field) => {
        if (field === "assignee") return <span className="workspace_cell_value">{memberNames[String(task.assignee_id)] || "Sin responsable"}</span>;
        if (field === "priority") return <span className={`workspace_cell_badge is_${String(task.priority || "Media").toLowerCase()}`}>{task.priority || "Media"}</span>;
        if (field === "status") return <span className="workspace_cell_badge">{statuses.find(item => String(item.id) === String(task.statusId || task.status))?.label || task.status || "Sin estado"}</span>;
        if (field === "due") return <span className="workspace_cell_value">{dateFromISO(task.due_date)?.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) || "Sin fecha"}</span>;
        if (field === "project") return <span className="workspace_cell_value">{projectNames[workspaceProjectIds(task)[0]] || "Sin proyecto"}</span>;
        if (field === "section") return <span className="workspace_cell_value">{sectionNames[workspaceSectionIds(task)[0]] || "Sin sección"}</span>;
        if (field === "created") return <span>{(task.created_at || "").slice(0, 10) || "—"}</span>;
        if (field === "creator") return <span>{memberNames[String(task.created_by_assignment)] || "—"}</span>;
        if (field === "subtasks") return <span>{(task.subtasks || []).filter(child => child.completed).length}/{(task.subtasks || []).length}</span>;
        if (field === "attachments") return <span>{(task.attachments || []).length}</span>;
        return null;
    };
    const row = (task, level = 0) => {
        const children = (task.subtasks || []).filter(child => matchingIds.has(String(child.id)));
        const isExpanded = expanded.includes(String(task.id));
        return <Fragment key={task.id}><div className="workspace_task_row" role="row" style={{ "--task-depth": level }}>
            <div className="workspace_task_name" role="cell"><button type="button" className={`workspace_completion ${task.completed ? "is_complete" : ""}`} aria-label={`${task.completed ? "Reabrir" : "Completar"} ${task.title}`} aria-pressed={!!task.completed} onClick={() => toggleCompletion(task)}>{task.completed && <Check size={15} strokeWidth={3} />}</button>{children.length ? <button type="button" className="workspace_expand" aria-label={`${isExpanded ? "Contraer" : "Expandir"} subtareas de ${task.title}`} aria-expanded={isExpanded} onClick={() => setExpanded(current => isExpanded ? current.filter(id => id !== String(task.id)) : [...current, String(task.id)])}>{isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button> : <span className="workspace_expand_spacer" />}<button type="button" className="workspace_task_title" onClick={() => onOpenTask(task.id)} title={task.title}>{task.title}</button>{children.length > 0 && <small>{children.filter(child => child.completed).length}/{children.length}</small>}<button type="button" className="workspace_subtask_add" aria-label={`Agregar subtarea a ${task.title}`} title="Agregar subtarea" onClick={() => { setQuickParent(task.id); setQuickTitle(""); }}><Plus size={16} /></button><button type="button" className="workspace_row_more" aria-label={`Acciones de ${task.title}`} aria-expanded={openRowId === task.id} onClick={() => toggleRowActions(task)}>⋮</button></div>
            {Object.keys(FIELD_LABELS).filter(visible).map(field => <div className="workspace_task_cell" role="cell" key={field} data-label={FIELD_LABELS[field]}>{cell(task, field)}</div>)}
        </div>{openRowId === task.id && <div className="workspace_row_actions" role="region" aria-label={`Acciones de ${task.title}`}><button type="button" onClick={() => onOpenTask(task.id)}>Abrir</button>{rowRights.update && <><button type="button" onClick={() => onEditTask(task.id)}>Editar</button><button type="button" onClick={() => { const status = statuses.find(item => (item.unitId || item.unit || activeUnitId) === (task.unitId || activeUnitId) && !!item.isFinal !== !!task.completed); if (status) run("update", [String(task.id)], { status: status.id }); }}> {task.completed ? "Reabrir" : "Completar"}</button><Select aria-label={`Asociar ${task.title} a proyecto`} value="" onChange={event => inlineUpdate(task, "project", event.target.value)}><option value="">Asociar a proyecto…</option>{projectOptions}</Select></>}{rowRights.create && <><button type="button" onClick={() => { setQuickParent(task.id); setQuickTitle(""); }}>Agregar subtarea</button><button type="button" onClick={() => run("create", [], { items: [{ title: `${task.title} (copia)`, unitId: task.unitId || activeUnitId, project_id: workspaceProjectIds(task)[0] || "", assignee_id: task.assignee_id || "", priority: task.priority, due_date: task.due_date || null }] })}>Duplicar</button></>}{rowRights.delete && <button type="button" onClick={() => { if (window.confirm(`¿Eliminar ${task.title}?`)) run("delete", [String(task.id)], {}); }}>Eliminar</button>}<button type="button" onClick={() => setOpenRowId(null)}>Cerrar</button></div>}{isExpanded && children.map(child => row(child, level + 1))}
            {quickParent === task.id && <form className="workspace_quick_subtask" onSubmit={quickCreate}><input autoFocus aria-label={`Nueva subtarea de ${task.title}`} value={quickTitle} onChange={event => setQuickTitle(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuickParent(null); setQuickTitle(""); } }} placeholder="Nombre de la subtarea" /><Select aria-label="Responsable de la nueva subtarea" value={quickAssignee} onChange={event => setQuickAssignee(event.target.value)}><option value="">Responsable del padre</option>{memberOptions}</Select><input type="date" aria-label="Fecha de la nueva subtarea" value={quickDate} onChange={event => setQuickDate(event.target.value)} /><button type="submit" disabled={pending}>Crear</button><button type="button" onClick={() => setQuickParent(null)}>Cancelar</button><button type="button" onClick={() => { setBatchParent(task.id); setBatchProject(workspaceProjectIds(task)[0] || ""); setBatchSection(workspaceSectionIds(task)[0] || ""); setBatchAssignee(task.assignee_id || ""); setBatchPriority(task.priority || "Media"); setBatchDate(task.due_date || ""); setModal("batch"); }}>Varias</button></form>}
        </Fragment>;
    };

    if (loading) return <section className="workspace_ops" aria-label="Gestión de tareas de BOLD Workspace" aria-busy="true"><header className="workspace_ops_heading"><div><h1>BOLD Workspace</h1><p>Cargando tareas del equipo…</p></div></header><div className="workspace_skeleton" /><div className="workspace_skeleton" /><div className="workspace_skeleton" /></section>;

    return <section className="workspace_ops" aria-label="Gestión de tareas de BOLD Workspace">
        <header className="workspace_ops_heading"><div><h1>BOLD Workspace</h1><p>Gestiona y organiza el trabajo de tu equipo desde un solo lugar.</p></div>{allowed.create && <button type="button" className="primary_button" onClick={onOpenCreate}><Plus size={17} /> Agregar tarea</button>}</header>
        {pending && <div className="workspace_progress" role="status">Guardando cambios en Workspace…</div>}
        <div className="workspace_toolbar"><label className="workspace_search"><Search size={17} /><input type="search" placeholder="Buscar tareas, descripción o etiquetas" value={query} onChange={event => setQuery(event.target.value)} /></label><details ref={filtersRef}><summary><SlidersHorizontal size={17} /> Filtros {activeChips.length ? `(${activeChips.length})` : ""}</summary><div className="workspace_filter_panel"><button type="button" className="workspace_filters_close" onClick={event => { event.currentTarget.closest("details").open = false; }}>Cerrar filtros</button>
            <MultiFilter label="Proyecto" values={filters.projects} options={projects.map(item => [String(item.id), item.label || item.name])} onChange={value => toggleFilter("projects", value)} />
            <MultiFilter label="Sección" values={filters.sections} options={sections.map(item => [String(item.id), item.label || item.name])} onChange={value => toggleFilter("sections", value)} />
            <MultiFilter label="Responsable" values={filters.assignees} options={members.map(item => [String(item.id), item.name])} onChange={value => toggleFilter("assignees", value)} />
            <MultiFilter label="Estado" values={filters.statuses} options={statuses.map(item => [String(item.id), item.label || item.name])} onChange={value => toggleFilter("statuses", value)} />
            <MultiFilter label="Prioridad" values={filters.priorities} options={PRIORITIES} onChange={value => toggleFilter("priorities", value)} />
            <MultiFilter label="Creado por" values={filters.creators} options={members.map(item => [String(item.id), item.name])} onChange={value => toggleFilter("creators", value)} />
            <MultiFilter label="Unidad" values={filters.units} options={units.map(item => [String(item.id), item.name || item.label])} onChange={value => toggleFilter("units", value)} />
            <label>Vencimiento<Select value={filters.due} onChange={event => setFilter("due", event.target.value)}>{DATE_OPTIONS.map(([id, label]) => option(id, label))}</Select></label>
            <label>Desde<input type="date" value={filters.dueFrom} onChange={event => setFilter("dueFrom", event.target.value)} /></label><label>Hasta<input type="date" value={filters.dueTo} onChange={event => setFilter("dueTo", event.target.value)} /></label>
            <label>Creada desde<input type="date" value={filters.createdFrom} onChange={event => setFilter("createdFrom", event.target.value)} /></label><label>Creada hasta<input type="date" value={filters.createdTo} onChange={event => setFilter("createdTo", event.target.value)} /></label>
            <label>Completada<Select value={filters.completed} onChange={event => setFilter("completed", event.target.value)}>{option("", "Cualquiera")}{option("true", "Sí")}{option("false", "No")}</Select></label>
            <label>Subtareas<Select value={filters.subtasks} onChange={event => setFilter("subtasks", event.target.value)}>{option("", "Cualquiera")}{option("true", "Con subtareas")}{option("false", "Sin subtareas")}</Select></label>
            <label>Adjuntos<Select value={filters.attachments} onChange={event => setFilter("attachments", event.target.value)}>{option("", "Cualquiera")}{option("true", "Con archivos")}{option("false", "Sin archivos")}</Select></label>
        </div></details><label>Ordenar<Select value={sort} onChange={event => setSort(event.target.value)}>{SORT_OPTIONS.map(([id, name]) => option(id, name))}</Select></label><button type="button" aria-label={`Orden ${direction === "asc" ? "ascendente" : "descendente"}`} onClick={() => setDirection(current => current === "asc" ? "desc" : "asc")}>{direction === "asc" ? "↑" : "↓"}</button><label>Agrupar<Select value={group} onChange={event => setGroup(event.target.value)}>{GROUP_OPTIONS.map(([id, name]) => option(id, name))}</Select></label><details><summary>Campos</summary><div className="workspace_fields_panel">{Object.entries(FIELD_LABELS).map(([id, label]) => <label key={id}><input type="checkbox" checked={visible(id)} onChange={() => setFields(current => current.includes(id) ? current.filter(field => field !== id) : [...current, id])} />{label}</label>)}</div></details>{allowed.create && <button type="button" onClick={() => { setBatchParent(null); setModal("batch"); }}>Crear varias</button>}<button type="button" onClick={() => { setViewName(""); setModal("save"); }}>Guardar vista</button><Select aria-label="Vistas guardadas" value="" onChange={event => { if (event.target.value === "__default__") applyView(null); else { const view = views.find(item => item.name === event.target.value); if (view) applyView(view); } }}><option value="">Vistas guardadas</option><option value="__default__">Vista predeterminada</option>{views.map(view => option(view.name, view.name))}</Select></div>
        {activeChips.length > 0 && <div className="workspace_chips">{activeChips.map(([key, value]) => <button type="button" key={`${key}:${value}`} onClick={() => setFilters(current => ({ ...current, [key]: Array.isArray(current[key]) ? current[key].filter(item => item !== value) : "" }))}>{key}: {projectNames[value] || sectionNames[value] || memberNames[value] || statuses.find(item => String(item.id) === value)?.label || DATE_OPTIONS.find(item => item[0] === value)?.[1] || value} ×</button>)}{activeChips.length > 1 && <button type="button" onClick={() => setFilters(emptyWorkspaceFilters())}>Limpiar filtros</button>}</div>}
        {selectedIds.length > 0 && <div className="workspace_bulk" role="region" aria-label="Acciones masivas">
            <strong>{selectedIds.length} tareas seleccionadas</strong>
            {allowed.update && <>
                <Select aria-label="Asignar responsable" value="" disabled={selectedUnits.length !== 1} onChange={event => bulkUpdate("assignee_assignment", event.target.value)}><option value="">Asignar…</option>{memberOptionsFor(selectedUnits[0])}</Select>
                <Select aria-label="Asociar a proyecto" value="" onChange={event => bulkUpdate("project", event.target.value)}><option value="">Asociar proyecto…</option>{projectOptions}</Select>
                <Select aria-label="Cambiar sección" value="" disabled={selectedProjects.length !== 1 || !selectedProjects[0]} onChange={event => bulkUpdate("section", event.target.value)}><option value="">Sección…</option>{sections.filter(item => String(item.projectId || item.project) === selectedProjects[0]).map(item => option(item.id, item.label || item.name))}</Select>
                <Select aria-label="Cambiar prioridad" value="" onChange={event => bulkUpdate("priority", event.target.value)}><option value="">Prioridad…</option>{PRIORITIES.map(([id, label]) => option(id, label))}</Select>
                <Select aria-label="Cambiar estado" value="" disabled={selectedUnits.length !== 1} onChange={event => bulkUpdate("status", event.target.value)}><option value="">Estado…</option>{statusOptionsFor(selectedUnits[0])}</Select>
                <label>Fecha<input type="date" onChange={event => bulkUpdate("due_date", event.target.value)} /></label>
            </>}
            <details><summary>Más acciones</summary><div className="workspace_more">
                {allowed.update && <><button type="button" onClick={() => changeCompletion(true)}>Marcar completadas</button><button type="button" onClick={() => changeCompletion(false)}>Reabrir</button><Select aria-label="Mover bajo otra tarea" value="" onChange={event => bulkUpdate("parent_task", event.target.value)}><option value="">Mover como subtarea de…</option>{tasks.filter(task => !selectedIds.includes(String(task.id))).map(task => option(task.id, task.title))}</Select><button type="button" onClick={() => run("update", selectedIds, { parent_task: null })}>Convertir en tareas principales</button></>}
                {allowed.create && <><button type="button" onClick={duplicateSelected}>Duplicar</button><button type="button" onClick={() => { setBatchParent(null); setModal("subtasks"); }}>Crear subtareas para seleccionadas</button></>}
                {allowed.delete && <button type="button" onClick={deleteSelected}><Trash2 size={15} /> Eliminar</button>}
            </div></details>
            <button type="button" onClick={() => setSelected([])}>Cancelar</button>
        </div>}
        {error && <p role="alert" className="workspace_error">{error}</p>}
        <div className="workspace_table" role="table" aria-label="Tareas de Workspace" style={{ "--workspace-fields": fields.length, "--workspace-table-min": `${260 + fields.length * 135}px` }}><div className="workspace_table_head" role="row"><div role="columnheader"><input type="checkbox" aria-label="Seleccionar todas las tareas visibles" checked={visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))} onChange={selectVisible} /> Tarea <small>{filtered.length}</small></div>{Object.keys(FIELD_LABELS).filter(visible).map(field => <div role="columnheader" key={field}>{FIELD_LABELS[field]}</div>)}</div>{groups.map(([label, rows]) => <div className="workspace_group" key={label}><h3>{label} <small>{rows.length}</small></h3>{rows.map(task => row(task))}</div>)}{!filtered.length && <div className="workspace_empty">{tasks.length ? <>No encontramos tareas con estos filtros. <button type="button" onClick={() => { setFilters(emptyWorkspaceFilters()); setQuery(""); }}>Limpiar filtros</button></> : <>No hay tareas todavía. {allowed.create && <button type="button" onClick={onOpenCreate}>Crear primera tarea</button>}</>}</div>}</div>
        {matchingRoots.length > displayLimit && <button type="button" className="workspace_show_more" onClick={() => setDisplayLimit(limit => limit + 100)}>Mostrar 100 tareas más ({matchingRoots.length - displayLimit} restantes)</button>}
        {modal && createPortal(<div className="workspace_modal_overlay" onPointerDown={event => { if (event.target === event.currentTarget) setModal(""); }}><form className="workspace_modal" role="dialog" aria-modal="true" aria-label={modal === "save" ? "Guardar vista" : modal === "subtasks" ? "Crear subtareas para tareas seleccionadas" : "Crear varias tareas"} onSubmit={modal === "save" ? saveView : modal === "subtasks" ? submitSubtasks : batchCreate}>
            <header><div><h2>{modal === "save" ? "Guardar vista" : modal === "subtasks" ? "Subtareas para tareas seleccionadas" : batchParent ? "Crear varias subtareas" : "Crear varias tareas"}</h2>{modal === "save" && <p>Guarda los filtros, el orden, la agrupación y los campos actuales.</p>}</div><button type="button" className="workspace_modal_close" aria-label="Cerrar" onClick={() => setModal("")}>×</button></header>
            {modal === "save" ? <label>Nombre de la vista<input autoFocus value={viewName} onChange={event => setViewName(event.target.value)} placeholder="Ej. Pendientes de esta semana" required maxLength="80" /></label> : <><p className="workspace_batch_preview">{modal === "subtasks" ? `${batchText.split(/\r?\n/).filter(item => item.trim()).length * selectedIds.length} subtareas en ${selectedIds.length} tareas` : `${batchText.split(/\r?\n/).filter(item => item.trim()).length} tareas para crear`}</p><label>Una tarea por línea<textarea autoFocus rows="8" value={batchText} onChange={event => setBatchText(event.target.value)} placeholder="Escribe una tarea por línea" required /></label>{modal !== "subtasks" && <><label>Proyecto<Select value={batchProject} onChange={event => { setBatchProject(event.target.value); setBatchSection(""); }}><option value="">Sin proyecto</option>{projectOptions}</Select></label><label>Sección<Select value={batchSection} onChange={event => setBatchSection(event.target.value)}><option value="">Sin sección</option>{sections.filter(item => String(item.projectId || item.project) === batchProject).map(item => option(item.id, item.label || item.name))}</Select></label><label>Responsable<Select value={batchAssignee} onChange={event => setBatchAssignee(event.target.value)}><option value="">Sin responsable</option>{memberOptions}</Select></label><label>Fecha límite<input type="date" value={batchDate} onChange={event => setBatchDate(event.target.value)} /></label></>}<label>Prioridad<Select value={batchPriority} onChange={event => setBatchPriority(event.target.value)}>{PRIORITIES.map(([id, label]) => option(id, label))}</Select></label></>}
            <footer><button type="button" onClick={() => setModal("")}>Cancelar</button><button type="submit" className="primary_button" disabled={pending}>{modal === "save" ? "Guardar vista" : "Crear"}</button></footer>
        </form></div>, document.body)}
    </section>;
}
