import WorkspaceShareDialog from "./workspace_share_dialog.jsx";
import {removePersonAssignments} from "../../core/shared/people.js";
import {useShell} from "../../core/app_shell.jsx";
import {useCore} from "../../core/core_provider.jsx";
import {membersForUnit} from "./services/task_models.js";
import {CachedImage} from "../../core/shared/cached_image.jsx";
import { TextEditorField, TaskText } from "./task_text_editor.jsx";
import ColorPicker from "../../core/shared/color_picker.jsx";
import { useEffect, useRef, useState } from "react";
import { DriveFolderPicker } from "../../docs/drive_module.jsx";
import { workspaceApi } from "../../docs/workspace_api.js";
import GoogleConnection from "../../docs/google_connection.jsx";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, Clock3, ExternalLink, Folder, FolderInput, FolderPlus, Link, ListPlus, MoreHorizontal, Pencil, Search, Settings2, Trash2, UsersRound, X } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { folderBranch, folderPath, folderSummary, moveWorkspaceFolder, tasksInWorkspace, transferFolderItems } from "./services/workspace_store.js";
import {BoldSelect} from "../../core/shared/bold_select.jsx";
import {normalizeSearchText} from "../../core/global_search.js";
import WorkspaceOperations from "./workspace_operations.jsx";
import "./workspaces.css";

function Dialog({ title, onClose, children, className = "" }) {
    useDialog(true, ".folder_dialog", onClose);
    return createPortal(<div className="folder_overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className={`folder_dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button></header>{children}</section></div>, document.body);
}

export default function WorkspacesModule({ onEditing, onImport, savePending = false, accountId, shareRecords = [], onShare, TaskSelect, CalendarDateField, workspaces, activeId, onOpen, onSave, projects, tasks, allTasks, sections, statuses, members, units, activeUnitId, storageKey, pending, loading, permissionsCan, searchQuery, onProject, onProjectPreview, onEditProject, onShareProject, onTask, onEditTask, onCreateTask, onQuickCreate, onToggleTask, onBulk }) {
    const shell = useShell(), core = useCore();
    const [shareQuery, setShareQuery] = useState("");
    const [sharing, setSharing] = useState(false);
    const sharingBusy = useRef(false);
    const current = workspaces.find(item => item.id === activeId);
    const parentId = current?.id || null;
    const [dialog, setDialog] = useState(null);
    useEffect(() => {onEditing?.(Boolean(dialog)); return () => onEditing?.(false);}, [dialog]);
    const [selection, setSelection] = useState([]);
    const [query, setQuery] = useState({ projectIds: "", taskIds: "" });
    const [destination, setDestination] = useState("");
    const [folderQuery, setFolderQuery] = useState("");
    const [pickTab, setPickTab] = useState("projectIds");
    const [error, setError] = useState("");
    const [folderColor, setFolderColor] = useState(null);
    const [driveConnection, setDriveConnection] = useState(null);
    const [driveError, setDriveError] = useState("");
    const [driveSelection, setDriveSelection] = useState([]);
    const latest = useRef(workspaces);
    latest.current = workspaces;
    useEffect(() => {
        if (dialog?.type !== "pick" || pickTab !== "drive" || driveConnection) return;
        let alive = true;
        setDriveConnection(null); setDriveError("");
        workspaceApi.connection().then(value => {if (alive) setDriveConnection(value);}).catch(problem => {if (alive) setDriveError(problem.message);});
        return () => {alive = false;};
    }, [dialog?.type, pickTab, driveConnection]);
    const owned = item => !item.shared && (!item.ownerId || item.ownerId === accountId);
    const shareFolder = dialog?.type === "share" ? dialog.item : null;
    const shareRecord = shareRecords.find(row => row.mine && row.folder_id === shareFolder?.id);
    const shareIds = shareRecord?.member_ids || [];
    const departmentMembers = core.directory || members;
    async function changeSharing(person, remove = false) {
        if (sharingBusy.current) return;
        sharingBusy.current = true; setSharing(true); setError("");
        try {await onShare(shareFolder, remove ? removePersonAssignments(shareIds, person.id, departmentMembers) : [...new Set([...shareIds, person.id])]);}
        catch (problem) {setError(problem.message);}
        finally {sharingBusy.current = false; setSharing(false);}
    }
    const close = () => { if (savePending) return; setDialog(null); setFolderColor(null); setError(""); };
    const open = id => { setSelection([]); setFolderQuery(""); close(); onOpen(id || "all"); };
    const choose = (field, id) => setSelection(rows => rows.some(row => row.field === field && row.id === String(id)) ? rows.filter(row => row.field !== field || row.id !== String(id)) : [...rows, { field, id: String(id) }]);
    const checked = (field, id) => selection.some(row => row.field === field && row.id === String(id));
    const commit = async items => { if (savePending) return false; if (!await onSave(items)) { setError("No se pudo guardar. El cambio no se aplicó. Revisa si otra persona actualizó la carpeta o si perdiste conexión."); return false; } close(); setSelection([]); return true; };
    const start = (type, item) => { setShareQuery(""); setFolderColor(null); setError(""); setQuery({ projectIds: "", taskIds: "" }); setDestination(type === "folderMove" ? item.parentId || "root" : ""); setDialog({ type, item }); if (type === "pick") {setSelection([]); setDriveSelection([]); setPickTab("projectIds"); setDriveConnection(null); setDriveError("");} };
    const searchText = normalizeSearchText(folderQuery || searchQuery);
    const matches = value => normalizeSearchText(value).includes(searchText);
    const childFolders = workspaces.filter(item => item.parentId === parentId && matches(item.name));
    const excludedDestinations = dialog?.type === "folderMove" ? new Set(folderBranch(workspaces,dialog.item.id).map(item=>item.id)) : new Set();
    const destinationOptions = workspaces.filter(item => !item.shared && (dialog?.type !== "move" || item.id !== parentId) && !excludedDestinations.has(item.id)).map(item => ({value:item.id,label:folderPath(workspaces,item.id).map(folder=>folder.name).join(" / ")}));
    const visibleTasks = current ? tasksInWorkspace(current, tasks) : [];
    const visibleProjects = current ? projects.filter(project => current.projectIds.includes(String(project.id))) : [];
    const toggleTask = onToggleTask || (taskId => {
        const task = allTasks.find(item => String(item.id) === String(taskId));
        const status = statuses.find(item => (item.unitId || item.unit || activeUnitId) === (task?.unitId || activeUnitId)
            && Boolean(item.isFinal) !== Boolean(task?.completed));
        if (status) onBulk("update", [String(taskId)], { status: status.id });
    });
    const inherited = selection.some(row => !current?.[row.field].includes(row.id));
    const apply = action => {
        try {
            let items = transferFolderItems(latest.current, parentId, dialog?.type === "pick" ? parentId : destination, selection, action);
            if (dialog?.type === "pick") items = items.map(item => item.id === parentId ? {...item, driveFolders: [...new Map([...(item.driveFolders || []), ...driveSelection].map(folder => [folder.id, folder])).values()]} : item);
            commit(items);
        } catch (e) {setError(e.message);}
    };
    const daysRemaining = row => {
        const raw = row.due_date || row.dueDate;
        if (!raw) return null;
        const days = Math.ceil((new Date(`${raw}T23:59:59`).getTime() - Date.now()) / 86400000);
        return days < 0 ? `${Math.abs(days)} d vencida` : days === 0 ? "Vence hoy" : `${days} d restantes`;
    };
    const contentRows = (rows, field, picker = false) => rows.filter(row => normalizeSearchText(row.label || row.title || "").includes(picker ? normalizeSearchText(query[field]) : searchText)).map(row => <div className={`folder_content_row ${picker ? "folder_picker_row" : field === "projectIds" ? "folder_project_row" : "folder_task_row"}`} key={row.id}>
        <input type="checkbox" aria-label={`Seleccionar ${row.label || row.title}`} disabled={picker ? current?.[field].includes(String(row.id)) : current?.shared} checked={checked(field, row.id) || Boolean(picker && current?.[field].includes(String(row.id)))} onChange={() => choose(field, row.id)} />
        {field === "projectIds" && !picker && <span className="folder_project_mark" style={{ "--project-color": row.color || "#ef1f2d" }}><Folder size={17} /></span>}
        <button type="button" disabled={picker && current?.[field].includes(String(row.id))} aria-pressed={picker ? checked(field, row.id) || current?.[field].includes(String(row.id)) : undefined} onClick={() => picker ? choose(field, row.id) : field === "projectIds" ? onProject(row.id) : onTask(row.id)}><strong>{row.label || row.title}</strong>{!picker && field === "projectIds" && <small>{row.description || "Abrir proyecto"}</small>}</button>
        {picker && current?.[field].includes(String(row.id)) && <small className="folder_included">Incluido</small>}{!picker && field === "taskIds" && <div className="folder_task_meta"><span className="folder_direct_badge">{current.taskIds.includes(String(row.id)) ? "En esta carpeta" : "Del proyecto"}</span><span className={`folder_priority folder_priority_${String(row.priority || "media").toLowerCase()}`}>{row.priority || "Media"}</span><small><CalendarDays size={13} /> {row.due_label || "Sin fecha"}</small>{daysRemaining(row) && <small className="folder_days"><Clock3 size={13} /> {daysRemaining(row)}</small>}</div>}
    </div>);
    const projectCards = visibleProjects.filter(project=>matches(project.label)).map(project => {
        const projectTasks = tasks.filter(task => task.project_id === project.id || task.taskProjects?.some(link => link.projectId === project.id));
        const done = projectTasks.filter(task => task.completed).length;
        const progress = projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0;
        return <article className="project_summary_card folder_project_card" key={project.id}>
            <input type="checkbox" aria-label={`Seleccionar ${project.label}`} disabled={current?.shared} checked={checked("projectIds", project.id)} onChange={() => choose("projectIds", project.id)} />
            <div className="project_summary_title"><button type="button" className="project_info_button" aria-label={`Ver información de ${project.label}`} aria-haspopup="dialog" title="Ver información del proyecto" onClick={event => onProjectPreview({ id: project.id, rect: event.currentTarget.getBoundingClientRect() })}><span className="folder_project_identity" style={{ "--project-color": project.color || "#ef1f2d" }}>{project.avatar_data_url ? <CachedImage src={project.avatar_data_url} alt="" /> : null}</span></button><button type="button" onClick={() => onProject(project.id)}>{project.label}</button><div className="project_summary_badges"><span data-status={(project.status || "Activo").toLowerCase()}>{project.status || "Activo"}</span><span data-priority={(project.priority || "Media").toLowerCase()}>{project.priority || "Media"}</span></div></div>
            <p>{project.start_date || "Sin inicio"} — {project.end_date || "Sin fecha final"}</p>
            <div className="project_summary_progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div>
            <small>{done} de {projectTasks.length} tareas completadas</small>
            <details className="project_actions_toggle"><summary aria-label={`Mostrar acciones de ${project.label}`}><ChevronDown size={18} /></summary><footer className="project_summary_actions"><button className="project_action_primary" type="button" onClick={() => onProject(project.id)}><ExternalLink size={15} /> Abrir tareas</button><button className="project_action_secondary" type="button" onClick={() => onEditProject(project.id)}><Pencil size={15} /> Editar</button><button className="project_action_secondary" type="button" onClick={() => onShareProject(project.id)}><Link size={15} /> Compartir</button></footer></details>
        </article>;
    });

    const workspaceNav = <nav className="workspace_main_nav" aria-label="Secciones de Workspace"><button type="button" aria-pressed={activeId !== "total"} onClick={()=>open("all")}><Folder size={15}/>Carpetas</button><button type="button" aria-pressed={activeId === "total"} onClick={()=>open("total")}><ListPlus size={15}/>Todas las tareas</button></nav>;
    if (activeId === "total") return <section className="projects_module folder_module">{workspaceNav}<WorkspaceOperations TaskSelect={TaskSelect} CalendarDateField={CalendarDateField} tasks={allTasks} projects={projects} sections={sections} statuses={statuses} members={members} units={units} activeUnitId={activeUnitId} storageKey={storageKey} pending={pending} loading={loading} permissionsCan={permissionsCan} onOpenTask={onTask} onOpenCreate={onCreateTask} onToggleTask={toggleTask} onBulk={onBulk} onOrganize={ids=>{setSelection(ids.map(id=>({field:"taskIds",id:String(id)})));start("bulkAdd");}} />{dialog?.type==="bulkAdd" && <Dialog title="Agregar tareas a una carpeta" onClose={close}><p>{selection.length} tareas seleccionadas. Se agregarán como accesos, sin cambiar su proyecto ni sus permisos.</p><label>Destino<BoldSelect label="Carpeta destino" searchable value={destination} onValueChange={setDestination} options={[{value:"",label:"Seleccionar carpeta"},...destinationOptions]}/></label>{!destinationOptions.length && <p>Crea una carpeta en la sección Carpetas para organizar estas tareas.</p>}{error && <p role="alert">{error}</p>}<footer><button type="button" disabled={savePending} onClick={close}>Cancelar</button><button className="primary_button" type="button" disabled={savePending||!destination} onClick={()=>apply("add")}>{savePending ? "Guardando…" : "Agregar tareas"}</button></footer></Dialog>}</section>;

    return <section className={`projects_module folder_module ${current ? "folder_module_current" : ""}`}>
        {workspaceNav}
        {current && <nav className="folder_breadcrumb" aria-label="Ruta de carpetas"><button type="button" onClick={() => open(null)}>Workspace</button>{folderPath(workspaces, parentId).map(folder => <span key={folder.id}> / <button type="button" aria-current={folder.id === parentId ? "page" : undefined} onClick={() => open(folder.id)}>{folder.name}</button></span>)}</nav>}
        <header className="projects_module_header"><div><h2>{current?.name || "Workspace"}</h2><TaskText value={current?.description || "Reúne proyectos, tareas y accesos a Drive en carpetas. Comparte su organización con tu equipo."}/></div><div className="folder_actions"><span role="status">{savePending ? "Guardando…" : ""}</span><button type="button" className="primary_button" disabled={savePending} onClick={()=>start("edit",null)}><FolderPlus size={16}/>{current ? "Nueva subcarpeta" : "Nueva carpeta"}</button>{current && <><button type="button" disabled={savePending} onClick={()=>start("pick")}><ListPlus size={16}/>Agregar contenido</button><button type="button" disabled={savePending} onClick={()=>start("edit",current)}><Settings2 size={16}/>Configurar</button></>}{current && owned(current) && <><button type="button" disabled={savePending} onClick={()=>start("folderMove",current)}><FolderInput size={16}/>Mover</button><button type="button" disabled={savePending} aria-label="Compartir carpeta del workspace" onClick={()=>start("share",current)}><UsersRound size={16}/>Compartir</button></>}{onImport && !current && <details className="folder_more_menu" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.currentTarget.querySelector("summary").focus();}}}><summary aria-label="Más opciones de Workspace"><MoreHorizontal size={18}/></summary><div><button type="button" disabled={savePending} onClick={onImport}>Importar carpetas de este dispositivo</button></div></details>}</div></header>
        <label className="folder_library_search"><Search size={16}/><input type="search" aria-label="Buscar en Workspace" placeholder={current ? "Buscar carpetas, proyectos o tareas" : "Buscar carpetas"} value={folderQuery} onChange={event=>setFolderQuery(event.target.value)}/></label>
        <details className="folder_section" open><summary>{current ? "Subcarpetas" : "Carpetas"}<span>{childFolders.length}</span></summary>
        <div className="projects_grid">{childFolders.map(item => {
            const summary = folderSummary(workspaces, item.id, projects, tasks);
            return <article className="project_summary_card folder_card" role="button" tabIndex={0} aria-label={`Abrir carpeta ${item.name}`} key={item.id} style={{ "--folder-color": item.color }} onClick={() => open(item.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {event.preventDefault(); open(item.id);} }}><div className="folder_card_title"><span><Folder size={24} /></span><strong>{item.name}</strong></div><TaskText value={item.description || "Sin descripción"} /><small>{summary.folders} subcarpetas · {summary.projects} proyectos · {summary.tasks} tareas</small><div className="project_summary_progress"><progress aria-label={`Progreso de ${item.name}`} max="100" value={summary.progress} /><strong>{summary.progress}%</strong></div><small>{summary.done} de {summary.tasks} tareas completadas</small><footer>{!item.shared && <><button type="button" aria-label={`Editar ${item.name}`} title="Editar carpeta" onClick={event => { event.stopPropagation(); start("edit", item); }}><Pencil size={15} /></button><button type="button" aria-label={`Mover carpeta ${item.name}`} title="Mover carpeta" onClick={event=>{event.stopPropagation();start("folderMove",item);}}><FolderInput size={15}/></button><button type="button" aria-label={`Eliminar ${item.name}`} title="Eliminar carpeta" onClick={event => { event.stopPropagation(); start("delete", item); }}><Trash2 size={15} /></button></>}{owned(item) && <button type="button" aria-label={`Compartir ${item.name}`} title="Compartir carpeta con personas de BOLD" onClick={event => {event.stopPropagation(); start("share", item);}}><UsersRound size={16}/></button>}{item.shared && <small>Compartida contigo</small>}</footer></article>;
        })}</div>
        {!childFolders.length && <p className="folder_empty">{searchText ? "No hay carpetas que coincidan con tu búsqueda." : current ? "Todavía no hay subcarpetas. Usa Nueva subcarpeta para organizar este espacio." : "Crea tu primera carpeta para reunir proyectos y tareas."}</p>}</details>
        {current && !!current.driveFolders?.length && <details className="folder_section folder_drive_links" open><summary>Carpetas de Drive<span>{current.driveFolders.filter(folder=>matches(folder.name)).length}</span></summary><div className="projects_grid">{current.driveFolders.filter(folder => matches(folder.name)).map(folder => <article className="project_summary_card folder_drive_card" key={folder.id}><button type="button" className="folder_drive_open" onClick={() => shell.open_drive_folder(folder)}><Folder size={24}/><strong>{folder.name}</strong><ExternalLink size={17}/></button><small>Acceso a carpeta de Drive</small>{!current.shared && <button className="folder_drive_remove" type="button" aria-label={`Quitar acceso a ${folder.name}`} title="Quitar acceso del workspace" onClick={() => commit(latest.current.map(item => item.id === current.id ? {...item, driveFolders: (item.driveFolders || []).filter(row => row.id !== folder.id)} : item))}><Trash2 size={16}/></button>}</article>)}</div></details>}
        {current && <>{!!selection.length && <div className="folder_selection" role="region" aria-label="Acciones de selección"><strong>{selection.length} seleccionados</strong><button type="button" disabled={inherited} onClick={() => start("move")}>Mover a carpeta</button><button type="button" onClick={() => start("add")}>Agregar a otra carpeta</button><button type="button" disabled={inherited} onClick={() => apply("remove")}>Quitar de esta carpeta</button><button type="button" onClick={() => setSelection([])}>Cancelar selección</button>{inherited && <p>Las tareas “Del proyecto” siguen a su proyecto. Puedes agregarlas a otra carpeta o seleccionar y mover el proyecto completo.</p>}</div>}
            <details className="folder_section" open><summary>Proyectos<span>{projectCards.length}</span></summary><div className="projects_grid folder_projects_grid">{projectCards}{!projectCards.length && <p className="folder_empty">{searchText ? "No hay proyectos que coincidan." : "Usa Agregar contenido para incluir proyectos."}</p>}</div></details>
            <details className="folder_section" open><summary>Tareas<span>{visibleTasks.filter(task=>matches(task.title)).length}</span></summary><div className="folder_content">{contentRows(visibleTasks, "taskIds")}{!visibleTasks.filter(task=>matches(task.title)).length && <p className="folder_empty">{searchText ? "No hay tareas que coincidan." : "Agrega tareas directamente o incluye un proyecto con sus tareas."}</p>}</div></details></>}
        {dialog?.type === "share" ? <WorkspaceShareDialog folder={shareFolder} members={departmentMembers} ids={shareIds} onChange={changeSharing} busy={sharing} error={error} onClose={() => {if (!sharingBusy.current) close();}} query={shareQuery} setQuery={setShareQuery} core={core}/> : dialog && <Dialog title={dialog.type === "edit" ? dialog.item ? "Editar carpeta" : "Crear carpeta" : dialog.type === "delete" ? "Eliminar carpeta" : dialog.type === "pick" ? "Agregar contenido" : dialog.type === "folderMove" ? "Mover carpeta" : dialog.type === "move" ? "Mover a carpeta" : "Agregar a otra carpeta"} onClose={close}>
            {dialog.type === "folderMove" ? <form onSubmit={event=>{event.preventDefault();try{commit(moveWorkspaceFolder(latest.current,dialog.item.id,destination==="root"?null:destination));}catch(problem){setError(problem.message);}}}><p>Mover «{dialog.item.name}» con sus subcarpetas y asociaciones.</p><label>Destino<BoldSelect label="Destino de la carpeta" searchable value={destination} onValueChange={setDestination} options={[{value:"root",label:"Workspace / Inicio"},...destinationOptions]}/></label><p className="folder_help">Si el destino está compartido, su organización también será visible allí. Los permisos de proyectos, tareas y Drive se mantienen.</p>{error && <p role="alert">{error}</p>}<footer><button type="button" disabled={savePending} onClick={close}>Cancelar</button><button type="submit" className="primary_button" disabled={savePending || destination===(dialog.item.parentId||"root")}>{savePending ? "Moviendo…" : "Mover carpeta"}</button></footer></form>
            : dialog.type === "edit" ? <form aria-busy={savePending} onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget), name = values.get("name").trim(); const item = dialog.item, targetParent = item ? item.parentId : parentId; if (!name || workspaces.some(folder => folder.id !== item?.id && folder.parentId === targetParent && folder.name.toLowerCase() === name.toLowerCase())) { setError("Escribe un nombre único dentro de esta carpeta."); return; } const identity = crypto.randomUUID(); const next = { ...(item || {id: current?.shared ? `shared:${current.shareRecordId}:${identity}` : identity, ...(current?.shared ? {sourceFolderId: identity, shared: true, shareRecordId: current.shareRecordId, ownerId: current.ownerId} : {ownerId: accountId}), parentId: targetParent, projectIds: [], taskIds: []}), name, description: values.get("description").trim(), color: values.get("color") }; const rows = latest.current; commit(item ? rows.map(folder => folder.id === item.id ? next : folder) : [...rows, next]); }}><label>Nombre<input name="name" required maxLength={120} defaultValue={dialog.item?.name || ""} autoFocus /></label><label>Descripción<TextEditorField allowImages={false} name="description" maxLength={1000} defaultValue={dialog.item?.description || ""} /></label><label>Color<ColorPicker name="color" label="Color de la carpeta" value={folderColor || dialog.item?.color || "#ef1f2d"} onChange={setFolderColor}/></label>{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button className="primary_button" type="submit" disabled={savePending}>{savePending ? "Guardando…" : "Guardar"}</button></footer></form>
            : dialog.type === "delete" ? <><p>Se eliminará “{dialog.item.name}” junto con sus {folderBranch(workspaces, dialog.item.id).length - 1} subcarpetas y sus asociaciones. Los proyectos y tareas originales se conservarán.</p><footer><button type="button" onClick={close}>Cancelar</button><button type="button" onClick={async () => { const removed = new Set(folderBranch(workspaces, dialog.item.id).map(item => item.id)); if (await commit(workspaces.filter(item => !removed.has(item.id))) && removed.has(parentId)) open(dialog.item.parentId); }}>Eliminar carpetas</button></footer></>
            : <>{dialog.type === "pick" ? <><nav className="folder_picker_tabs" aria-label="Tipo de contenido">{[["projectIds","Proyectos"],["taskIds","Tareas"],["drive","Drive"]].map(([id,label])=><button type="button" key={id} aria-pressed={pickTab===id} onClick={()=>setPickTab(id)}>{label}<span>{id==="drive" ? driveSelection.length : selection.filter(row=>row.field===id).length}</span></button>)}</nav><p className="folder_help">Selecciona los elementos que quieras reunir aquí. Los originales conservan su ubicación y permisos.</p><div className="folder_picker folder_picker_with_drive">{[{ title: "Proyectos", field: "projectIds", rows: projects, placeholder: "Buscar proyecto…" }, { title: "Tareas", field: "taskIds", rows: tasks, placeholder: "Buscar tarea…" }].filter(group=>group.field===pickTab).map(group => { const rows = contentRows(group.rows, group.field, true); return <section className="folder_picker_column" key={group.field} aria-label={group.title}><h3>{group.title}</h3><label><input type="search" aria-label={group.placeholder} placeholder={group.placeholder} value={query[group.field]} onChange={event => setQuery(current => ({ ...current, [group.field]: event.target.value }))} autoFocus={group.field === "projectIds"} /></label><div className="folder_picker_list">{rows.length ? rows : <p>No hay {group.title.toLowerCase()} que mostrar.</p>}</div></section>; })}{pickTab==="drive" && <section className="folder_picker_column folder_drive_picker" aria-label="Carpetas de Drive"><h3>Carpetas de Drive</h3>
                {driveError ? <p role="alert">{driveError}</p> : !driveConnection ? <p role="status">Cargando Drive…</p> : driveConnection.services?.drive?.status === "available" ? <DriveFolderPicker foldersOnly label="Agregar carpeta a la selección" rows={[...(current?.driveFolders || []), ...driveSelection]} submit={(id, folder) => setDriveSelection(items => items.some(item => item.id === id) || current?.driveFolders?.some(item => item.id === id) ? items : [...items, {id, name: folder.name}])}/> : <GoogleConnection onConnected={setDriveConnection}/>}
                {!!driveSelection.length && <div className="folder_drive_selection" aria-label="Carpetas seleccionadas">{driveSelection.map(folder => <div key={folder.id}><Folder size={16}/><span>{folder.name}</span><button type="button" aria-label={`Quitar ${folder.name} de la selección`} onClick={() => setDriveSelection(items => items.filter(item => item.id !== folder.id))}><X size={16}/></button></div>)}</div>}
            </section>}</div></> : <label>Carpeta destino<BoldSelect label="Carpeta destino" searchable value={destination} onValueChange={setDestination} options={[{value:"",label:"Seleccionar carpeta"},...destinationOptions]}/></label>}{error && <p role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary_button" disabled={savePending || !(selection.length + (dialog.type === "pick" ? driveSelection.length : 0)) || (dialog.type !== "pick" && !destination)} onClick={() => apply(dialog.type === "move" ? "move" : "add")}>{savePending ? "Guardando…" : dialog.type === "move" ? "Mover" : "Agregar"} ({selection.length + (dialog.type === "pick" ? driveSelection.length : 0)})</button></footer></>}
            {dialog.type === "delete" && error && <p role="alert">{error}</p>}
        </Dialog>}
        {!dialog && error && <p role="alert">{error}</p>}
    </section>;
}
