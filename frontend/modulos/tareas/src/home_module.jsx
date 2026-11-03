import PrivateNotes from "./private_notes.jsx";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, BarChart3, CalendarDays, Check, ChevronRight, Clock3, FolderPlus, GripVertical, MoreHorizontal, Plus, RotateCcw, Search, X, LockKeyhole, ListTodo, LayoutGrid, ArrowUpRight, Video, RefreshCw, TrendingUp, Link2 } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { useMediaQuery } from "../../core/shared/use_media_query.js";
import { useShell } from "../../core/app_shell.jsx";
import { buildHomeData } from "./home_data.js";
import {normalizeSearchText} from "../../core/global_search.js";
import { defaultHomeLayout, HOME_WIDGET_TYPES, normalizeHomeLayout, migrateHomeLayout, placeHomeWidgets, reorderHomeWidgets } from "./home_layout.js";
import "./home.css";
import "./home_workspace_v4.css";
import {useHomeAgenda} from "./use_home_agenda.jsx";
import {upcomingMeetings,meetingLink} from "./home_agenda_data.js";

const percentage = (part, total) => total ? Math.round(part / total * 100) : 0;
const dateText = date => date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
const widgetNames = {notes:"Notas privadas",tasks:"Prioridades",projects:"Avance de proyectos",activity:"Actividad reciente",shortcuts:"Accesos rápidos",status:"Resumen de tareas",agenda:"Agenda de hoy",weekly:"Carga semanal"};
const widgetIcons = {notes:LockKeyhole,tasks:ListTodo,projects:LayoutGrid,activity:AtSign,shortcuts:Link2,status:BarChart3,agenda:CalendarDays,weekly:TrendingUp};
const WidgetTitleContext = createContext(null);
function WidgetHeading({ type, title, action, onAction }) {
    const Icon = widgetIcons[type], editing = useContext(WidgetTitleContext);
    const [draft, setDraft] = useState(null);
    const save = () => { if (draft === null) return; editing?.save(draft.trim().slice(0, 60)); setDraft(null); };
    return <header className="home_widget_heading"><div><i><Icon /></i>{draft !== null ? <input className="home_widget_title_input" autoFocus value={draft} maxLength={60} aria-label="Nombre del widget" onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === "Enter") save(); if (event.key === "Escape") setDraft(null); }} /> : <h2 tabIndex={editing ? 0 : undefined} title={editing ? "Doble clic o F2 para cambiar el nombre" : undefined} onDoubleClick={editing ? () => setDraft(editing.title || title || widgetNames[type]) : undefined} onKeyDown={editing ? event => { if (event.key === "F2" || event.key === "Enter") { event.preventDefault(); setDraft(editing.title || title || widgetNames[type]); } } : undefined}>{editing?.title || title || widgetNames[type]}</h2>}</div>{onAction && <button type="button" onClick={onAction}>{action}</button>}</header>;
}


function WidgetMenu({ id, openId, setOpenId, children, triggerContent = <MoreHorizontal /> }) {
    const root = useRef(null), trigger = useRef(null), menu = useRef(null), open = openId === id;
    useLayoutEffect(() => {
        if (!open || !trigger.current || !menu.current) return;
        const position = () => {
            if (window.innerWidth <= 600) return;
            const anchor = trigger.current.getBoundingClientRect(), panel = menu.current;
            const top = anchor.bottom + panel.offsetHeight + 8 <= window.innerHeight ? anchor.bottom + 6 : anchor.top - panel.offsetHeight - 6;
            panel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - panel.offsetHeight - 8))}px`;
            panel.style.left = `${Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
        };
        position();
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const close = event => {
            if (event.type === "keydown" && event.key === "Escape") { setOpenId(null); trigger.current?.focus(); }
            if (event.type === "pointerdown" && !root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpenId(null);
        };
        document.addEventListener("keydown", close); document.addEventListener("pointerdown", close);
        return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
    }, [open, setOpenId]);
    return <div className={`home_widget_menu${open ? " is_open" : ""}`} ref={root}>
        <button ref={trigger} type="button" aria-label={id === "add" ? "Agregar widget" : "Opciones del widget"} aria-expanded={open} onClick={() => setOpenId(open ? null : id)}>{triggerContent}</button>
        {open && createPortal(<div ref={menu} className="home_widget_popover home_widget_popover_portal">{children(() => { setOpenId(null); trigger.current?.focus(); })}</div>, document.body)}
    </div>;
}

function WidgetFrame({ widget, index, children, openId, setOpenId, move, remove, configure, update, beginDrag }) {
    return <article className={`home_widget home_widget_${widget.type} home_variant_compact`} onPointerDown={event => { if (event.target.closest(".home_widget_heading") && !event.target.closest("button, a, input, h2")) beginDrag(event, widget.id); }}>
        <div className="home_widget_tools"><button className="home_drag" type="button" aria-label="Mover widget. Arrastra o usa las flechas para cambiar su posición." onPointerDown={event => beginDrag(event, widget.id)} onKeyDown={event => { if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); move(index, index - 1); } if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(index, index + 1); } }}><GripVertical /></button><WidgetMenu id={widget.id} openId={openId} setOpenId={setOpenId}>{close => <><button type="button" onClick={() => { move(index, index - 1); close(); }}>Mover antes</button><button type="button" onClick={() => { move(index, index + 1); close(); }}>Mover después</button>{configure && <button type="button" onClick={() => { configure(); close(); }}>Personalizar contenido</button>}<button className="home_remove" type="button" onClick={() => { remove(index); close(); }}>Quitar widget</button></>}</WidgetMenu></div>
        <WidgetTitleContext.Provider value={{ title: widget.title, save: title => update(index, { ...widget, title }) }}><div className="home_widget_body">{children}</div></WidgetTitleContext.Provider>
    </article>;
}

function HomeWidgetSlot({widget,position,columns,dragging,dropTarget,children}) {
    return <div data-home-widget={widget.id} className={`home_widget_slot is_uniform${dragging ? " is_dragging" : ""}${dropTarget ? " is_drop_target" : ""}`} style={{top:position.top,left:`calc(${position.column/columns*100}% + ${position.column*14/columns}px)`,width:`calc(${position.span/columns*100}% - ${(1-position.span/columns)*14}px)`,height:position.height}}>{children}</div>;
}

function TasksWidget({widget,data,projects,onChange,onOpenTask,onOpenTasks,onToggleTask,onCreateTask}) {
    const visible = widget.tab === "upcoming" ? data.upcoming : widget.tab === "undated" ? data.undated : widget.tab === "overdue" ? data.overdue : data.dueToday;
    return <><WidgetHeading type="tasks" action="Ver todas" onAction={onOpenTasks}/><div className="home_tabs" role="group" aria-label="Filtrar prioridades">{[["today","Hoy",data.dueToday.length],["overdue","Vencidas",data.overdue.length],["upcoming","Próximas",data.upcoming.length],["undated","Sin fecha",data.undated.length]].map(([id,label,count]) => <button type="button" className={widget.tab === id ? "active" : ""} aria-pressed={widget.tab === id} onClick={()=>onChange({...widget,tab:id})} key={id}>{label}<small>{count}</small></button>)}</div><div className="home_focus_tasks">{visible.slice(0,3).map(({task,due}) => {const project=projects.find(item=>item.id===task.project_id);return <div className="home_focus_task" key={task.id}><button type="button" className="home_task_check" aria-label={`Completar ${task.title}`} onClick={()=>onToggleTask(task.id)}><Check/></button><button type="button" className="home_task_open" onClick={()=>onOpenTask(task.id)}><strong>{task.title}</strong><small>{project?.label || project?.name || "Sin proyecto"} · {due ? due.toLocaleDateString("es",{day:"numeric",month:"short"}) : "Sin fecha"}</small></button><span className={`home_priority_dot priority_${task.priority?.toLowerCase()}`} title={`Prioridad ${task.priority || "Media"}`} aria-label={`Prioridad ${task.priority || "Media"}`}/></div>;})}{!visible.length && <div className="home_blank"><Check/><strong>Sin tareas en este filtro</strong><span>No hay tareas en este filtro.</span></div>}</div><button type="button" className="home_quick_add" onClick={onCreateTask}><Plus/> Nueva tarea</button></>;
}

function ProjectsWidget({ data, onOpenProject, onOpenTasks }) {
    return <><WidgetHeading type="projects" action="Ver todos" onAction={onOpenTasks} /><div className="home_projects_list">{data.projects.slice(0, 3).map(project => <button className="home_project" onClick={() => onOpenProject(project.id)} key={project.id}><div><span style={{ background: project.color }} /><strong>{project.label || project.name}</strong><b>{percentage(project.completed, project.total)}%</b></div><progress value={project.completed} max={project.total || 1} style={{ accentColor: project.color, "--home-project-color": project.color || "var(--bold_red)" }} /><small>{project.completed} de {project.total} tareas completadas</small></button>)}{!data.projects.length && <p className="home_empty">Todavía no hay proyectos.</p>}</div></>;
}

function ActivityWidget({ activity = [], onOpenTasks, onOpenTask, onOpenProject }) {
    const icons = { task_created: Plus, project_created: FolderPlus, assignment: Plus, comment: AtSign, status_changed: Check };
    return <><WidgetHeading type="activity" action="Ver actividad" onAction={onOpenTasks} /><div className="home_activity_list">{activity.slice(0, 4).map(item => { const Icon = icons[item.type] || Check; const open = item.project_id ? () => onOpenProject(item.project_id) : item.task_id ? () => onOpenTask(item.task_id) : onOpenTasks; return <button type="button" className="home_activity_item" key={item.id} onClick={open}><i className={`home_activity_icon_${item.type}`}><Icon /></i><div><strong>{item.title}</strong><small>{item.time_label || (item.created_at && new Date(item.created_at).toLocaleString("es"))}{item.body ? ` · ${item.body}` : ""}</small></div></button>; })}{!activity.length && <p className="home_empty">Sin actividad reciente.</p>}</div></>;
}

function ShortcutPicker({widget,catalog,apply,close}) {
    const [query,setQuery]=useState(""),[category,setCategory]=useState("all"),[selected,setSelected]=useState(widget.shortcuts || []),search=useRef(null);
    const toggle=id=>setSelected(items=>items.includes(id) ? items.filter(item=>item!==id):[...items,id]);
    const matches=catalog.filter(item=>normalizeSearchText(item.label).includes(normalizeSearchText(query)));
    const groups=[{id:"access",title:"Accesos",items:matches.filter(item=>!item.id.startsWith("project:"))},{id:"projects",title:"Proyectos",items:matches.filter(item=>item.id.startsWith("project:"))}];
    const visible=groups.filter(group=>category==="all" || category===group.id),count=visible.reduce((total,group)=>total+group.items.length,0);
    return <><div className="home_shortcut_picker_content">
        <label className="home_shortcut_search"><Search aria-hidden="true"/><input ref={search} autoFocus aria-label="Buscar acceso o proyecto" placeholder="Buscar acceso o proyecto…" value={query} onChange={event=>setQuery(event.target.value)}/>{query && <button type="button" aria-label="Limpiar búsqueda" onClick={()=>{setQuery("");search.current?.focus();}}><X/></button>}</label>
        <div className="home_shortcut_filters" role="group" aria-label="Tipo de acceso">{[["all","Todos",matches.length],...groups.map(group=>[group.id,group.title,group.items.length])].map(([id,title,total])=><button type="button" key={id} aria-pressed={category===id} onClick={()=>setCategory(id)}>{title}<small>{total}</small></button>)}</div>
        <div className="home_shortcut_results" aria-label="Accesos disponibles">{visible.filter(group=>group.items.length).map(group=><section className="home_shortcut_group" key={group.id}><h3>{group.title}</h3>{group.items.map(item=>{const Icon=item.icon,checked=selected.includes(item.id);return <button type="button" className="home_shortcut_option" key={item.id} data-shortcut={item.id} aria-pressed={checked} onClick={()=>toggle(item.id)}><i><Icon aria-hidden="true"/></i><span>{item.label}</span><i className="home_shortcut_check" aria-hidden="true">{checked && <Check/>}</i></button>;})}</section>)}{!count && <div className="home_shortcut_empty"><Search/><strong>{query ? "No hay coincidencias":"No hay proyectos disponibles"}</strong><p>{query ? "Prueba otro nombre o limpia la búsqueda.":"Los proyectos que puedas abrir aparecerán aquí."}</p>{query && <button type="button" onClick={()=>{setQuery("");search.current?.focus();}}>Limpiar búsqueda</button>}</div>}</div>
        </div><footer><span aria-live="polite">{selected.length} {selected.length===1 ? "seleccionado":"seleccionados"}</span><div><button type="button" onClick={close}>Cancelar</button><button type="button" className="is_primary" disabled={!selected.length} onClick={()=>{apply({...widget,shortcuts:selected});close();}}>Aplicar</button></div></footer></>;
}

function ShortcutsWidget({ widget, catalog }) {
    const selected = widget.shortcuts.map(id => catalog.find(item => item.id === id)).filter(Boolean);
    return <><WidgetHeading type="shortcuts" /><div className="home_shortcuts">{selected.map(item => { const Icon = item.icon; return <button type="button" onClick={item.action} key={item.id}><i><Icon /></i><span>{item.label}</span><ChevronRight /></button>; })}{!selected.length && <p className="home_empty">Elige accesos desde los tres puntos.</p>}</div></>;
}

function StatusWidget({data,onOpenTasks}) {
    const {completed,inProgress,pending}=data.statusCounts,total=completed+inProgress+pending;
    const groups=[["Completadas",completed,"var(--home_green)"],["En curso",inProgress,"var(--home_blue)"],["Pendientes",pending,"var(--bold_red)"]];
    let offset=0;
    return <><WidgetHeading type="status" action="Ver tareas" onAction={onOpenTasks}/><div className="home_summary_chart"><svg viewBox="0 0 160 160" role="img" aria-label={`${completed} completadas, ${inProgress} en curso y ${pending} pendientes`}><circle cx="80" cy="80" r="62" className="home_ring_track"/>{groups.map(([label,value,color])=>{const length=total?value/total*100:0,at=offset;offset+=length;return <circle key={label} cx="80" cy="80" r="62" pathLength="100" fill="none" stroke={color} strokeWidth="12" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-at} transform="rotate(-90 80 80)"/>;})}<text x="80" y="78" className="home_ring_number">{percentage(completed,total)}%</text><text x="80" y="100" className="home_ring_caption">completado</text></svg><div className="home_summary_legend"><strong>{total}<small> tareas en total</small></strong>{groups.map(([label,value,color])=><div key={label}><i style={{background:color}}/><span>{label}</span><b>{value}</b></div>)}</div></div><div className="home_summary_footer"><span><b>{data.dueToday.length}</b> vencen hoy</span><span className={data.overdue.length?"is_overdue":""}><b>{data.overdue.length}</b> vencidas</span></div></>;
}

function WeeklyWidget({data,onOpenTasks}) {
    const [selected,setSelected]=useState(null), rows=data.weekly,total=rows.reduce((sum,row)=>sum+row.total,0), completed=rows.reduce((sum,row)=>sum+row.completed,0),max=Math.max(1,...rows.map(row=>row.total));
    const focus=selected === null ? null : rows[selected];
    return <><WidgetHeading type="weekly" action="Ver tareas" onAction={onOpenTasks}/><div className="home_week_metric"><strong>{total}<small> {total === 1 ? "tarea" : "tareas"}</small></strong><span>{completed} {completed === 1 ? "completada" : "completadas"}</span></div><div className="home_week_bars" role="group" aria-label="Tareas por fecha límite esta semana">{rows.map((row,index)=><button type="button" key={index} aria-pressed={selected===index} onClick={()=>setSelected(index)} aria-label={`${dateText(row.date)}: ${row.total} tareas, ${row.completed} completadas`}><span className="home_bar_track"><span className="home_bar_total" style={{height:`${row.total/max*100}%`}}><span style={{height:`${percentage(row.completed,row.total)}%`}}/></span></span><small>{row.date.toLocaleDateString("es",{weekday:"short"}).slice(0,3)}</small><b>{row.total}</b></button>)}</div><div className="home_week_caption" aria-live="polite">{focus ? `${focus.date.toLocaleDateString("es",{day:"numeric",month:"short"})} · ${focus.completed} de ${focus.total} completadas` : "Esta semana · según fecha límite"}<span><i/>Completadas <i/>Pendientes</span></div></>;
}

function AgendaWidget({now,onNavigate}) {
    const agenda=useHomeAgenda(now,true),meetings=upcomingMeetings(agenda.events,now),time=value=>new Date(value).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"});
    return <><WidgetHeading type="agenda" action="Abrir" onAction={onNavigate}/><div className="home_agenda_date"><strong>{now.getDate()}</strong><span>{now.toLocaleDateString("es",{weekday:"long"})}<small>{now.toLocaleDateString("es",{month:"long"})} · Hora local</small></span><button type="button" disabled={agenda.loading} onClick={agenda.refresh} aria-label="Actualizar agenda"><RefreshCw className={agenda.loading?"is_spinning":""}/></button></div><div className="home_meetings" aria-busy={agenda.loading}>{agenda.loading ? <p className="home_empty" role="status">Consultando tu agenda…</p> : meetings.map(event=>{const link=meetingLink(event),live=Date.parse(event.start.dateTime)<=now.getTime();return <div className={`home_meeting${live?" is_live":""}`} key={event.key}><time>{time(event.start.dateTime)}</time><button type="button" onClick={onNavigate}><strong>{event.summary || "Reunión"}</strong><small>{live?"En curso · ":""}{event.calendar_name} · hasta {time(event.end.dateTime)}</small></button>{link && <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Entrar a ${event.summary || "la reunión"}`} title="Entrar a Meet"><Video/></a>}</div>;})}{!agenda.loading && !meetings.length && <p className="home_empty">Sin reuniones pendientes para hoy.</p>}</div>{agenda.error ? <p className="home_agenda_note" role="status">{agenda.error} <button type="button" onClick={agenda.refresh}>Reintentar</button></p> : !agenda.loading && !agenda.connected ? <button type="button" className="home_agenda_note" onClick={onNavigate}>Conecta Google desde Calendario <ArrowUpRight/></button> : <p className="home_agenda_note">Las reuniones terminadas dejan paso a la siguiente.</p>}</>;
}

function WidgetGallery({ data, projects, catalog, layout, onAdd, onClose, triggerRef }) {
    const [added, setAdded] = useState(0);
    useDialog(true, ".home_gallery", onClose);
    useEffect(() => () => triggerRef.current?.focus(), [triggerRef]);
    const descriptions={notes:"Escribe ideas y pendientes personales.",tasks:"Hoy, vencidas, próximas y sin fecha en una tarjeta.",projects:"Progreso y tareas completadas de tus proyectos.",activity:"Últimos cambios y avisos, con acceso a su origen.",shortcuts:"Tus módulos y proyectos más usados.",status:"Distribución de tareas y pendientes urgentes.",agenda:"Las próximas tres reuniones de hoy, internas y de Google.",weekly:"Carga y cumplimiento según la fecha límite de tus tareas."};
    const available=HOME_WIDGET_TYPES.filter(type=>!layout.some(widget=>widget.type===type));
    return createPortal(<div className="home_modal_backdrop home_gallery_backdrop home_rework_overlay" onPointerDown={event=>event.target===event.currentTarget&&onClose()}><section className="home_gallery" role="dialog" aria-modal="true" aria-label="Galería de widgets"><header><div><span>TU INICIO</span><h2>Agregar widgets</h2><p>Un lugar para cada cosa. Tamaño automático.</p></div><button type="button" aria-label="Cerrar galería" onClick={onClose}><X/></button></header><div className="home_gallery_grid">{available.map(type=>{const Icon=widgetIcons[type];return <article className="home_gallery_card" key={type}><i><Icon/></i><h3>{widgetNames[type]}</h3><p>{descriptions[type]}</p><button type="button" onClick={()=>{onAdd(type);setAdded(count=>count+1);}}><Plus/> Agregar</button></article>;})}{!available.length&&<p>Ya tienes todos los widgets. Puedes ordenarlos desde su asa de arrastre.</p>}</div><footer><span role="status">{added?`${added} widgets agregados`: "Sin widgets duplicados"}</span><button type="button" onClick={onClose}>Listo</button></footer></section></div>,document.body);

}

export default function HomeModule({ currentUser, notifications, onCreateProject, onCreateTask, onNavigate, onOpenProject, onOpenTask, onOpenTasks, onToggleTask, parseDueDate, projects, tasks }) {
    const { navigation_items } = useShell();
    const mobile = useMediaQuery("(max-width: 767px)"), tablet = useMediaQuery("(max-width: 1199px)"), wide = useMediaQuery("(min-width: 1600px)"), columns = mobile ? 1 : tablet ? 6 : wide ? 16 : 12;
    const storageKey = `bold_home_layout_v4:${currentUser?.id || "local"}`;
    const readLayout = () => {try {const saved=localStorage.getItem(storageKey);return saved !== null ? normalizeHomeLayout(JSON.parse(saved)) : migrateHomeLayout(JSON.parse(localStorage.getItem(`bold_home_layout:${currentUser?.id || "local"}`)));} catch {return defaultHomeLayout();}};
    const galleryTrigger = useRef(null), dashboardRef = useRef(null), positionsRef = useRef(new Map());
    const [layout, setLayout] = useState(readLayout);
    const layoutRef = useRef(layout), layoutKeyRef = useRef(storageKey), dragRef = useRef(null);
    layoutRef.current = layout;
    const [draggingId,setDraggingId]=useState(null),[dropTargetId,setDropTargetId]=useState(null);
    const [now,setNow]=useState(()=>new Date());
    useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);
    const data=useMemo(()=>buildHomeData(tasks,projects,parseDueDate,currentUser?.id,now,notifications),[tasks,projects,parseDueDate,currentUser?.id,now,notifications]);
    const {positions,height:dashboardHeight}=placeHomeWidgets(layout,{},columns);
    useLayoutEffect(() => {
        const previous = positionsRef.current, next = new Map();
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        dashboardRef.current?.querySelectorAll("[data-home-widget]").forEach(slot => {
            const id = slot.dataset.homeWidget, at = { left: slot.offsetLeft, top: slot.offsetTop }, before = previous.get(id);
            next.set(id, at);
            if (before && !reduced && (before.left !== at.left || before.top !== at.top)) {
                slot.getAnimations().forEach(animation => animation.cancel());
                slot.animate([{ transform: `translate(${before.left - at.left}px, ${before.top - at.top}px)` }, { transform: "translate(0, 0)" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
            }
        });
        positionsRef.current = next;
    }, [layout, columns]);
    const [openMenu, setOpenMenu] = useState(null), [picker, setPicker] = useState(null), [galleryOpen, setGalleryOpen] = useState(false);
    useEffect(() => {
        if (layoutKeyRef.current !== storageKey) {
            layoutKeyRef.current = storageKey;
            setLayout(readLayout());
            return;
        }
        if (!draggingId) try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch {}
    }, [layout, storageKey, draggingId]);
    useEffect(() => setOpenMenu(null), [columns]);
    useDialog(Boolean(picker), ".home_picker", () => setPicker(null));
    const update = (index, value) => setLayout(items => items.map((item, position) => position === index ? value : item));
    const move = (from, to) => { if (to < 0 || to >= layout.length || from === to) return; setLayout(items => { const next = [...items], [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); };
    const beginDrag = (event, id) => {
        if (event.button !== 0 || dragRef.current) return;
        event.preventDefault();
        setOpenMenu(null);
        const card = event.currentTarget.closest(".home_widget"), rect = card.getBoundingClientRect();
        const start = [...layoutRef.current], pointerId = event.pointerId;
        let ghost = null, lastMove = { x: event.clientX, y: event.clientY };
        const draw = point => { ghost.style.left = `${point.clientX - (event.clientX - rect.left)}px`; ghost.style.top = `${point.clientY - (event.clientY - rect.top)}px`; };
        const cleanup = cancel => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onEnd);
            window.removeEventListener("pointercancel", onCancel);
            window.removeEventListener("keydown", onKey);
            ghost?.remove(); dragRef.current = null; setDraggingId(null); setDropTargetId(null);
            if (cancel) setLayout(start);
        };
        const onMove = point => {
            if (point.pointerId !== pointerId) return;
            if (!ghost && Math.hypot(point.clientX - event.clientX, point.clientY - event.clientY) < 6) return;
            if (!ghost) {
                ghost = document.createElement("div");
                ghost.className = "bold_v3 home_drag_ghost";
                ghost.setAttribute("aria-hidden","true"); ghost.inert = true;
                const surface = document.createElement("div"); surface.className = "home_module home_rework"; surface.style.height = "100%"; surface.style.padding = "0";
                surface.appendChild(card.cloneNode(true)); ghost.appendChild(surface);
                ghost.style.width = `${rect.width}px`;
                ghost.style.height = `${rect.height}px`;
                document.body.appendChild(ghost);
                setDraggingId(id);
            }
            draw(point);
            if (point.clientY < 70) window.scrollBy(0, -14);
            else if (point.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
            if (Math.hypot(point.clientX - lastMove.x, point.clientY - lastMove.y) < 14) return;
            const dashboardBounds = dashboardRef.current?.getBoundingClientRect();
            if (!dashboardBounds || point.clientX < dashboardBounds.left || point.clientX > dashboardBounds.right) { setDropTargetId(null); return; }
            let slot = document.elementFromPoint(point.clientX, point.clientY)?.closest("[data-home-widget]");
            if (!slot) {
                const choices = [...dashboardRef.current.querySelectorAll("[data-home-widget]")].filter(item => item.dataset.homeWidget !== id);
                slot = choices.reduce((best, item) => {
                    const bounds = item.getBoundingClientRect();
                    const distance = Math.hypot(point.clientX - (bounds.left + bounds.width / 2), point.clientY - (bounds.top + bounds.height / 2));
                    return !best || distance < best.distance ? { item, distance } : best;
                }, null)?.item;
            }
            const targetId = slot?.dataset.homeWidget;
            if (!targetId || targetId === id) return;
            setDropTargetId(current => current === targetId ? current : targetId);
            const bounds = slot.getBoundingClientRect();
            const after = point.clientY > bounds.bottom ? true : point.clientY < bounds.top ? false : columns === 1 ? point.clientY > bounds.top + bounds.height / 2 : point.clientX > bounds.left + bounds.width / 2;
            const next = reorderHomeWidgets(layoutRef.current, id, targetId, after);
            if (next !== layoutRef.current) { layoutRef.current = next; setLayout(next); lastMove = { x: point.clientX, y: point.clientY }; }
        };
        const onEnd = point => { if (point.pointerId === pointerId) cleanup(false); };
        const onCancel = point => { if (point.pointerId === pointerId) cleanup(true); };
        const onKey = key => { if (key.key === "Escape") { key.preventDefault(); cleanup(true); } };
        dragRef.current = { cleanup };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("keydown", onKey);
    };
    useEffect(() => () => dragRef.current?.cleanup(true), []);
    const catalog = useMemo(() => [{ id: "create_task", label: "Crear una tarea", icon: Plus, action: onCreateTask }, { id: "create_project", label: "Crear un proyecto", icon: FolderPlus, action: onCreateProject }, ...navigation_items.filter(item => item.id !== "home").map(item => ({ id: `module:${item.id}`, label: `Abrir ${item.label}`, icon: item.id === "calendar" ? CalendarDays : item.id === "inbox" ? AtSign : item.id === "tasks" ? ListTodo : BarChart3, action: () => onNavigate(item.id) })), ...projects.map(project => ({ id: `project:${project.id}`, label: project.label, icon: FolderPlus, action: () => onOpenProject(project.id) }))], [navigation_items, projects, onCreateTask, onCreateProject, onNavigate, onOpenProject]);
    const greeting = now.getHours() < 12 ? "Buenos días" : now.getHours() < 19 ? "Buenas tardes" : "Buenas noches";
    const add = type => setLayout(items=>items.some(widget=>widget.type===type)?items:[...items,{id:`home_${type}_${crypto.randomUUID()}`,type,...(type==="tasks"?{tab:"today"}:{}),...(type==="shortcuts"?{shortcuts:["create_task","module:calendar"]}:{})}]);
    return <section className="home_module home_rework" data-tour="home"><header className="home_header" data-tour="home-header"><div><h1>{greeting}</h1><p>{dateText(now)} · Tu día, en un vistazo</p></div><div className="home_toolbar" data-tour="home-toolbar"><button ref={galleryTrigger} className="home_gallery_trigger" type="button" onClick={() => setGalleryOpen(true)}><Plus /> Agregar widget</button><button type="button" onClick={() => setLayout(defaultHomeLayout())}><RotateCcw /> Restaurar</button></div></header>
        <div ref={dashboardRef} className="home_dashboard" data-tour="home-dashboard" style={{ height: layout.length ? dashboardHeight : 190 }}>
            {!layout.length && <div className="home_dashboard_empty"><p>Tu tablero está vacío.</p><button type="button" onClick={() => setGalleryOpen(true)}>Explorar widgets</button></div>}
            {layout.map((widget, index) => {
                const configure = widget.type === "shortcuts" ? () => setPicker({ type: widget.type, index }) : null;
                return <HomeWidgetSlot widget={widget} position={positions[widget.id]} columns={columns} dragging={draggingId === widget.id} dropTarget={dropTargetId === widget.id} key={widget.id}>
                    <WidgetFrame widget={widget} index={index} openId={openMenu} setOpenId={setOpenMenu} move={move} remove={position => setLayout(items => items.filter((_, itemIndex) => itemIndex !== position))} configure={configure} update={update} beginDrag={beginDrag}>
                        {widget.type === "notes" ? <PrivateNotes heading={<WidgetHeading type="notes"/>} key={storageKey} storageKey={`bold_private_notes:${currentUser?.id || "local"}`}/> : widget.type === "agenda" ? <AgendaWidget now={now} onNavigate={()=>onNavigate("calendar")}/> : widget.type === "weekly" ? <WeeklyWidget data={data} onOpenTasks={onOpenTasks}/> : widget.type === "tasks" ? <TasksWidget widget={widget} data={data} projects={projects} onChange={value=>update(index,value)} onOpenTask={onOpenTask} onOpenTasks={onOpenTasks} onToggleTask={onToggleTask} onCreateTask={onCreateTask}/> : widget.type === "projects" ? <ProjectsWidget data={data} onOpenProject={onOpenProject} onOpenTasks={()=>onNavigate("projects")}/> : widget.type === "activity" ? <ActivityWidget activity={data.activity} onOpenTasks={()=>onNavigate("inbox")} onOpenTask={onOpenTask} onOpenProject={onOpenProject}/> : widget.type === "status" ? <StatusWidget data={data} onOpenTasks={onOpenTasks}/> : <ShortcutsWidget widget={widget} catalog={catalog}/>}

                    </WidgetFrame>
                </HomeWidgetSlot>;
            })}
        </div>
        {galleryOpen && <WidgetGallery data={data} projects={projects} catalog={catalog} layout={layout} onAdd={add} onClose={() => setGalleryOpen(false)} triggerRef={galleryTrigger} />}
        {picker && <div className="home_modal_backdrop home_rework_overlay" onPointerDown={event=>event.target===event.currentTarget&&setPicker(null)}><section className="home_picker home_picker_shortcuts" role="dialog" aria-modal="true" aria-label="Personalizar widget"><header><div><h2>Accesos rápidos</h2><p>Elige qué mostrar en tu Inicio.</p></div><button type="button" aria-label="Cerrar" onClick={()=>setPicker(null)}><X/></button></header><ShortcutPicker widget={layout[picker.index]} catalog={catalog} apply={value=>update(picker.index,value)} close={()=>setPicker(null)}/></section></div>}

    </section>;
}
