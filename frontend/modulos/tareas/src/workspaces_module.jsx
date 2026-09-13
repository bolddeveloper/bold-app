import { useState } from "react";
import { createPortal } from "react-dom";
import { Folder, Plus, Pencil, Trash2, X } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { folderBranch, folderPath, folderSummary, tasksInWorkspace, transferFolderItems } from "./services/workspace_store.js";
import "./workspaces.css";

function Dialog({ title, onClose, children }) {
    useDialog(true, ".folder_dialog", onClose);
    return createPortal(<div className="folder_overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="folder_dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button></header>{children}</section></div>, document.body);
}

export default function WorkspacesModule({ workspaces, activeId, onOpen, onSave, projects, tasks, searchQuery, onProject, onTask }) {
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
    const apply = action => {
        try { commit(transferFolderItems(workspaces, parentId, dialog?.type === "pick" ? parentId : destination, selection, action)); }
        catch (e) { setError(e.message); }
    };
    const contentRows = (rows, field, picker = false) => rows.filter(row => (row.label || row.title || "").toLowerCase().includes((picker ? query : searchQuery).trim().toLowerCase())).map(row => <div className="folder_content_row" key={row.id}>
        <input type="checkbox" aria-label={`Seleccionar ${row.label || row.title}`} checked={checked(field, row.id)} onChange={() => choose(field, row.id)} />
        <button type="button" onClick={() => picker ? choose(field, row.id) : field === "projectIds" ? onProject(row.id) : onTask(row.id)}>{row.label || row.title}</button>
        {!picker && field === "taskIds" && <small>{!current.taskIds.includes(String(row.id)) ? "Del proyecto" : "Directa"}{row.completed ? " · Completada" : ""}</small>}
    </div>);

    return <section className="projects_module folder_module">
        <nav className="folder_breadcrumb" aria-label="Ruta de carpetas"><button type="button" onClick={() => open(null)}>Workspaces</button>{folderPath(workspaces, parentId).map(folder => <span key={folder.id}> / <button type="button" aria-current={folder.id === parentId ? "page" : undefined} onClick={() => open(folder.id)}>{folder.name}</button></span>)}</nav>
        <header className="projects_module_header"><div><h1>{current?.name || "Workspaces"}</h1><p>{current?.description || "Organiza proyectos y tareas en carpetas."}</p></div><div className="folder_actions"><button type="button" className="primary_button" onClick={() => start("edit", null)}><Plus size={16} /> {current ? "Crear subcarpeta" : "Crear carpeta"}</button>{current && <><button type="button" onClick={() => start("pick")}>Agregar proyectos o tareas</button><button type="button" onClick={() => start("edit", current)}>Editar carpeta</button></>}</div></header>
        <h2>{current ? "Subcarpetas" : "Carpetas"}</h2>
        <div className="projects_grid">{workspaces.filter(item => item.parentId === parentId && item.name.toLowerCase().includes(searchQuery.trim().toLowerCase())).map(item => {
            const summary = folderSummary(workspaces, item.id, projects, tasks);
            return <article className="project_summary_card folder_card" key={item.id} style={{ "--folder-color": item.color }}><div className="folder_card_title"><span><Folder size={24} /></span><button type="button" onClick={() => open(item.id)}>{item.name}</button></div><p>{item.description || "Sin descripción"}</p><small>{summary.folders} subcarpetas · {summary.projects} proyectos · {summary.tasks} tareas</small><div className="project_summary_progress"><progress aria-label={`Progreso de ${item.name}`} max="100" value={summary.progress} /><strong>{summary.progress}%</strong></div><small>{summary.done} de {summary.tasks} tareas completadas</small><footer><button type="button" onClick={() => open(item.id)}>Abrir carpeta</button><button type="button" onClick={() => start("edit", item)}><Pencil size={14} /> Editar</button><button type="button" onClick={() => start("delete", item)}><Trash2 size={14} /> Eliminar</button></footer></article>;
        })}</div>
        {!workspaces.some(item => item.parentId === parentId) && <p className="folder_empty">{current ? "Todavía no hay subcarpetas." : "Crea tu primera carpeta."}</p>}
        {current && <>
            {!!selection.length && <div className="folder_selection" role="region" aria-label="Acciones de selección"><strong>{selection.length} seleccionados</strong><button type="button" disabled={inherited} onClick={() => start("move")}>Mover a carpeta</button><button type="button" onClick={() => start("add")}>Agregar a otra carpeta</button><button type="button" disabled={inherited} onClick={() => apply("remove")}>Quitar de esta carpeta</button><button type="button" onClick={() => setSelection([])}>Cancelar selección</button>{inherited && <p>Las tareas “Del proyecto” siguen a su proyecto. Puedes agregarlas a otra carpeta o seleccionar y mover el proyecto completo.</p>}</div>}
            <h2>Proyectos</h2><div className="folder_content">{contentRows(visibleProjects, "projectIds")}{!visibleProjects.length && <p>No hay proyectos en esta carpeta.</p>}</div>
            <h2>Tareas</h2><div className="folder_content">{contentRows(visibleTasks, "taskIds")}{!visibleTasks.length && <p>No hay tareas en esta carpeta.</p>}</div>
        </>}
        {dialog && <Dialog title={dialog.type === "edit" ? dialog.item ? "Editar carpeta" : "Crear carpeta" : dialog.type === "delete" ? "Eliminar carpeta" : dialog.type === "pick" ? "Agregar proyectos o tareas" : dialog.type === "move" ? "Mover a carpeta" : "Agregar a otra carpeta"} onClose={close}>
            {dialog.type === "edit" ? <form onSubmit={event => {
                event.preventDefault(); const values = new FormData(event.currentTarget), name = values.get("name").trim();
                const item = dialog.item, targetParent = item ? item.parentId : parentId;
                if (!name || workspaces.some(folder => folder.id !== item?.id && folder.parentId === targetParent && folder.name.toLowerCase() === name.toLowerCase())) { setError("Escribe un nombre único dentro de esta carpeta."); return; }
                const next = { ...(item || { id: crypto.randomUUID(), parentId: targetParent, projectIds: [], taskIds: [] }), name, description: values.get("description").trim(), color: values.get("color") };
                commit(item ? workspaces.map(folder => folder.id === item.id ? next : folder) : [...workspaces, next]);
            }}><label>Nombre<input name="name" required maxLength={120} defaultValue={dialog.item?.name || ""} autoFocus /></label><label>Descripción<textarea name="description" maxLength={1000} defaultValue={dialog.item?.description || ""} /></label><label>Color<input type="color" name="color" defaultValue={dialog.item?.color || "#ef1f2d"} /></label>{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button className="primary_button" type="submit">Guardar</button></footer></form>
            : dialog.type === "delete" ? <><p>Se eliminará “{dialog.item.name}” junto con sus {folderBranch(workspaces, dialog.item.id).length - 1} subcarpetas y sus asociaciones. Los proyectos y tareas originales se conservarán.</p><footer><button type="button" onClick={close}>Cancelar</button><button type="button" onClick={() => { const removed = new Set(folderBranch(workspaces, dialog.item.id).map(item => item.id)); if (commit(workspaces.filter(item => !removed.has(item.id))) && removed.has(parentId)) open(dialog.item.parentId); }}>Eliminar carpetas</button></footer></>
            : <>
                {dialog.type === "pick" ? <><label>Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label><div className="folder_picker"><h3>Proyectos</h3>{contentRows(projects, "projectIds", true)}<h3>Tareas</h3>{contentRows(tasks, "taskIds", true)}</div></> : <label>Carpeta destino<select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Seleccionar carpeta</option>{workspaces.filter(item => dialog.type !== "move" || item.id !== parentId).map(item => <option value={item.id} key={item.id}>{folderPath(workspaces, item.id).map(folder => folder.name).join(" / ")}</option>)}</select></label>}
                {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary_button" disabled={!selection.length || (dialog.type !== "pick" && !destination)} onClick={() => apply(dialog.type === "move" ? "move" : "add")}>Aplicar ({selection.length})</button></footer>
            </>}
            {dialog.type === "delete" && error && <p role="alert">{error}</p>}
        </Dialog>}
        {!dialog && error && <p role="alert">{error}</p>}
    </section>;
}
