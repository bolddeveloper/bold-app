import { useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, Clock3, ExternalLink, Folder, FolderPlus, Link, ListPlus, Pencil, Settings2, Trash2, X } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { folderBranch, folderPath, folderSummary, tasksInWorkspace, transferFolderItems } from "./services/workspace_store.js";
import WorkspaceOperations from "./workspace_operations.jsx";
import "./workspaces.css";

function Dialog({ title, onClose, children }) {
    useDialog(true, ".folder_dialog", onClose);
    return createPortal(<div className="folder_overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="folder_dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button></header>{children}</section></div>, document.body);
}

export default function WorkspacesModule({ TaskSelect, CalendarDateField, workspaces, activeId, onOpen, onSave, projects, tasks, allTasks, sections, statuses, members, units, activeUnitId, storageKey, pending, loading, permissionsCan, searchQuery, onProject, onProjectPreview, onEditProject, onShareProject, onTask, onEditTask, onCreateTask, onQuickCreate, onBulk }) {
    const current = workspaces.find(item => item.id === activeId);
    const parentId = current?.id || null;
    const [dialog, setDialog] = useState(null);
    const [selection, setSelection] = useState([]);
    const [query, setQuery] = useState("");
    const [destination, setDestination] = useState("");
    const [error, setError] = useState("");
    const close = () => { setDialog(null); setError(""); };
    const open = id => { setSelection([]); close(); onOpen(id || "all"); };
    const choose = (field, id) => setSelection(rows => rows.some(row => row.field === field && row.id === String(id)) ? rows.filter(row => row.field !== field || row.id !== String(id)) : [...rows, { field, id: String(id) }]);
    const checked = (field, id) => selection.some(row => row.field === field && row.id === String(id));
    const commit = items => { if (!onSave(items)) { setError("No se pudo guardar. El cambio no se aplicó; revisa el almacenamiento del navegador e inténtalo de nuevo."); return false; } close(); setSelection([]); return true; };
    const start = (type, item) => { setError(""); setQuery(""); setDestination(""); setDialog({ type, item }); if (type === "pick") setSelection([]); };
    const visibleTasks = current ? tasksInWorkspace(current, tasks) : [];
    const visibleProjects = current ? projects.filter(project => current.projectIds.includes(String(project.id))) : [];
    const inherited = selection.some(row => !current?.[row.field].includes(row.id));
    const apply = action => { try { commit(transferFolderItems(workspaces, parentId, dialog?.type === "pick" ? parentId : destination, selection, action)); } catch (e) { setError(e.message); } };
    const daysRemaining = row => {
        const raw = row.due_date || row.dueDate;
        if (!raw) return null;
        const days = Math.ceil((new Date(`${raw}T23:59:59`).getTime() - Date.now()) / 86400000);
        return days < 0 ? `${Math.abs(days)} d vencida` : days === 0 ? "Vence hoy" : `${days} d restantes`;
    };
    const contentRows = (rows, field, picker = false) => rows.filter(row => (row.label || row.title || "").toLowerCase().includes((picker ? query : searchQuery).trim().toLowerCase())).map(row => <div className={`folder_content_row ${picker ? "folder_picker_row" : field === "projectIds" ? "folder_project_row" : "folder_task_row"}`} key={row.id}>
        <input type="checkbox" aria-label={`Seleccionar ${row.label || row.title}`} checked={checked(field, row.id)} onChange={() => choose(field, row.id)} />
        {field === "projectIds" && !picker && <span className="folder_project_mark" style={{ "--project-color": row.color || "#ef1f2d" }}><Folder size={17} /></span>}
        <button type="button" onClick={() => picker ? choose(field, row.id) : field === "projectIds" ? onProject(row.id) : onTask(row.id)}><strong>{row.label || row.title}</strong>{!picker && field === "projectIds" && <small>{row.description || "Abrir proyecto"}</small>}</button>
        {!picker && field === "taskIds" && <div className="folder_task_meta">{current.taskIds.includes(String(row.id)) && <span className="folder_direct_badge">Directa</span>}<span className={`folder_priority folder_priority_${String(row.priority || "media").toLowerCase()}`}>{row.priority || "Media"}</span><small><CalendarDays size={13} /> {row.due_label || "Sin fecha"}</small>{daysRemaining(row) && <small className="folder_days"><Clock3 size={13} /> {daysRemaining(row)}</small>}</div>}
    </div>);
    const projectCards = visibleProjects.map(project => {
        const projectTasks = tasks.filter(task => task.project_id === project.id || task.taskProjects?.some(link => link.projectId === project.id));
        const done = projectTasks.filter(task => task.completed).length;
        const progress = projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0;
        return <article className="project_summary_card folder_project_card" key={project.id}>
            <input type="checkbox" aria-label={`Seleccionar ${project.label}`} checked={checked("projectIds", project.id)} onChange={() => choose("projectIds", project.id)} />
            <div className="project_summary_title"><button type="button" className="project_info_button" aria-label={`Ver información de ${project.label}`} aria-haspopup="dialog" title="Ver información del proyecto" onClick={event => onProjectPreview({ id: project.id, rect: event.currentTarget.getBoundingClientRect() })}><span className="folder_project_identity" style={{ "--project-color": project.color || "#ef1f2d" }}>{project.avatar_data_url ? <img src={project.avatar_data_url} alt="" /> : null}</span></button><button type="button" onClick={() => onProject(project.id)}>{project.label}</button><div className="project_summary_badges"><span data-status={(project.status || "Activo").toLowerCase()}>{project.status || "Activo"}</span><span data-priority={(project.priority || "Media").toLowerCase()}>{project.priority || "Media"}</span></div></div>
            <p>{project.start_date || "Sin inicio"} — {project.end_date || "Sin fecha final"}</p>
            <div className="project_summary_progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div>
            <small>{done} de {projectTasks.length} tareas completadas</small>
            <details className="project_actions_toggle"><summary aria-label={`Mostrar acciones de ${project.label}`}><ChevronDown size={18} /></summary><footer className="project_summary_actions"><button className="project_action_primary" type="button" onClick={() => onProject(project.id)}><ExternalLink size={15} /> Abrir tareas</button><button className="project_action_secondary" type="button" onClick={() => onEditProject(project.id)}><Pencil size={15} /> Editar</button><button className="project_action_secondary" type="button" onClick={() => onShareProject(project.id)}><Link size={15} /> Compartir</button></footer></details>
        </article>;
    });

    if (activeId === "total") return <section className="projects_module folder_module"><WorkspaceOperations TaskSelect={TaskSelect} CalendarDateField={CalendarDateField} tasks={allTasks} projects={projects} sections={sections} statuses={statuses} members={members} units={units} activeUnitId={activeUnitId} storageKey={storageKey} pending={pending} loading={loading} permissionsCan={permissionsCan} onOpenTask={onTask} onOpenCreate={onCreateTask} onBulk={onBulk} /></section>;

    return <section className="projects_module folder_module">
        <nav className="folder_breadcrumb" aria-label="Ruta de carpetas"><button type="button" onClick={() => open(null)}>Workspaces</button>{folderPath(workspaces, parentId).map(folder => <span key={folder.id}> / <button type="button" aria-current={folder.id === parentId ? "page" : undefined} onClick={() => open(folder.id)}>{folder.name}</button></span>)}</nav>
        <header className="projects_module_header"><div><h2>{current?.name || "Carpetas"}</h2><p>{current?.description || "Organiza proyectos y tareas en carpetas."}</p></div><div className="folder_actions"><button type="button" className="folder_icon_action primary_button" title={current ? "Crear subcarpeta" : "Crear carpeta"} aria-label={current ? "Crear subcarpeta" : "Crear carpeta"} onClick={() => start("edit", null)}><FolderPlus size={21} /></button>{current && <><button type="button" className="folder_icon_action" title="Agregar proyectos o tareas" aria-label="Agregar proyectos o tareas" onClick={() => start("pick")}><ListPlus size={21} /></button><button type="button" className="folder_icon_action" title="Editar carpeta" aria-label="Editar carpeta" onClick={() => start("edit", current)}><Settings2 size={21} /></button></>}</div></header>
        <h2>{current ? "Subcarpetas" : "Carpetas"}</h2>
        <div className="projects_grid">{workspaces.filter(item => item.parentId === parentId && item.name.toLowerCase().includes(searchQuery.trim().toLowerCase())).map(item => {
            const summary = folderSummary(workspaces, item.id, projects, tasks);
            return <article className="project_summary_card folder_card" role="button" tabIndex={0} aria-label={`Abrir carpeta ${item.name}`} key={item.id} style={{ "--folder-color": item.color }} onClick={() => open(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") open(item.id); }}><div className="folder_card_title"><span><Folder size={24} /></span><strong>{item.name}</strong></div><p>{item.description || "Sin descripción"}</p><small>{summary.folders} subcarpetas · {summary.projects} proyectos · {summary.tasks} tareas</small><div className="project_summary_progress"><progress aria-label={`Progreso de ${item.name}`} max="100" value={summary.progress} /><strong>{summary.progress}%</strong></div><small>{summary.done} de {summary.tasks} tareas completadas</small><footer><button type="button" aria-label={`Editar ${item.name}`} title="Editar carpeta" onClick={event => { event.stopPropagation(); start("edit", item); }}><Pencil size={15} /></button><button type="button" aria-label={`Eliminar ${item.name}`} title="Eliminar carpeta" onClick={event => { event.stopPropagation(); start("delete", item); }}><Trash2 size={15} /></button></footer></article>;
        })}</div>
        {!workspaces.some(item => item.parentId === parentId) && <p className="folder_empty">{current ? "Todavía no hay subcarpetas." : "Crea tu primera carpeta."}</p>}
        {current && <>{!!selection.length && <div className="folder_selection" role="region" aria-label="Acciones de selección"><strong>{selection.length} seleccionados</strong><button type="button" disabled={inherited} onClick={() => start("move")}>Mover a carpeta</button><button type="button" onClick={() => start("add")}>Agregar a otra carpeta</button><button type="button" disabled={inherited} onClick={() => apply("remove")}>Quitar de esta carpeta</button><button type="button" onClick={() => setSelection([])}>Cancelar selección</button>{inherited && <p>Las tareas “Del proyecto” siguen a su proyecto. Puedes agregarlas a otra carpeta o seleccionar y mover el proyecto completo.</p>}</div>}
            <h2>Proyectos</h2><div className="projects_grid folder_projects_grid">{projectCards}{!visibleProjects.length && <p>No hay proyectos en esta carpeta.</p>}</div>
            <h2>Tareas</h2><div className="folder_content">{contentRows(visibleTasks, "taskIds")}{!visibleTasks.length && <p>No hay tareas en esta carpeta.</p>}</div></>}
        {dialog && <Dialog title={dialog.type === "edit" ? dialog.item ? "Editar carpeta" : "Crear carpeta" : dialog.type === "delete" ? "Eliminar carpeta" : dialog.type === "pick" ? "Agregar proyectos o tareas" : dialog.type === "move" ? "Mover a carpeta" : "Agregar a otra carpeta"} onClose={close}>
            {dialog.type === "edit" ? <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget), name = values.get("name").trim(); const item = dialog.item, targetParent = item ? item.parentId : parentId; if (!name || workspaces.some(folder => folder.id !== item?.id && folder.parentId === targetParent && folder.name.toLowerCase() === name.toLowerCase())) { setError("Escribe un nombre único dentro de esta carpeta."); return; } const next = { ...(item || { id: crypto.randomUUID(), parentId: targetParent, projectIds: [], taskIds: [] }), name, description: values.get("description").trim(), color: values.get("color") }; commit(item ? workspaces.map(folder => folder.id === item.id ? next : folder) : [...workspaces, next]); }}><label>Nombre<input name="name" required maxLength={120} defaultValue={dialog.item?.name || ""} autoFocus /></label><label>Descripción<textarea name="description" maxLength={1000} defaultValue={dialog.item?.description || ""} /></label><label>Color<input type="color" name="color" defaultValue={dialog.item?.color || "#ef1f2d"} /></label>{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button className="primary_button" type="submit">Guardar</button></footer></form>
            : dialog.type === "delete" ? <><p>Se eliminará “{dialog.item.name}” junto con sus {folderBranch(workspaces, dialog.item.id).length - 1} subcarpetas y sus asociaciones. Los proyectos y tareas originales se conservarán.</p><footer><button type="button" onClick={close}>Cancelar</button><button type="button" onClick={() => { const removed = new Set(folderBranch(workspaces, dialog.item.id).map(item => item.id)); if (commit(workspaces.filter(item => !removed.has(item.id))) && removed.has(parentId)) open(dialog.item.parentId); }}>Eliminar carpetas</button></footer></>
            : <>{dialog.type === "pick" ? <><label>Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label><div className="folder_picker"><h3>Proyectos</h3>{contentRows(projects, "projectIds", true)}<h3>Tareas</h3>{contentRows(tasks, "taskIds", true)}</div></> : <label>Carpeta destino<select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Seleccionar carpeta</option>{workspaces.filter(item => dialog.type !== "move" || item.id !== parentId).map(item => <option value={item.id} key={item.id}>{folderPath(workspaces, item.id).map(folder => folder.name).join(" / ")}</option>)}</select></label>}{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary_button" disabled={!selection.length || (dialog.type !== "pick" && !destination)} onClick={() => apply(dialog.type === "move" ? "move" : "add")}>Aplicar ({selection.length})</button></footer></>}
            {dialog.type === "delete" && error && <p role="alert">{error}</p>}
        </Dialog>}
        {!dialog && error && <p role="alert">{error}</p>}
    </section>;
}
