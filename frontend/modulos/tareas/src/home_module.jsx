import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, BarChart3, CalendarDays, Check, ChevronRight, Clock3, FolderPlus, GripVertical, MoreHorizontal, Plus, RotateCcw, Search, X } from "lucide-react";
import { useDialog } from "../../core/shared/use_dialog.js";
import { useMediaQuery } from "../../core/shared/use_media_query.js";
import { useShell } from "../../core/app_shell.jsx";
import { buildHomeData } from "./home_data.js";
import { defaultHomeLayout, HOME_WIDGET_TYPES, normalizeHomeLayout, placeHomeWidgets, reorderHomeWidgets } from "./home_layout.js";
import "./home.css";

const percentage = (part, total) => total ? Math.round(part / total * 100) : 0;
const dateText = date => date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
const widgetNames = { metrics: "Indicadores", tasks: "Mis tareas", projects: "Proyectos", activity: "Actividad reciente", shortcuts: "Navegación rápida", status: "Tareas por estado", deadlines: "Próximos vencimientos" };
const widgetIcons = { metrics: BarChart3, tasks: Check, projects: FolderPlus, activity: AtSign, shortcuts: ChevronRight, status: BarChart3, deadlines: CalendarDays };
const WidgetTitleContext = createContext(null);
function WidgetHeading({ type, title, action, onAction }) {
    const Icon = widgetIcons[type], editing = useContext(WidgetTitleContext);
    const [draft, setDraft] = useState(null);
    const save = () => { if (draft === null) return; editing?.save(draft.trim().slice(0, 60)); setDraft(null); };
    return <header className="home_widget_heading"><div><i><Icon /></i>{draft !== null ? <input className="home_widget_title_input" autoFocus value={draft} maxLength={60} aria-label="Nombre del widget" onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === "Enter") save(); if (event.key === "Escape") setDraft(null); }} /> : <h2 tabIndex={editing ? 0 : undefined} title={editing ? "Doble clic o F2 para cambiar el nombre" : undefined} onDoubleClick={editing ? () => setDraft(editing.title || title || widgetNames[type]) : undefined} onKeyDown={editing ? event => { if (event.key === "F2" || event.key === "Enter") { event.preventDefault(); setDraft(editing.title || title || widgetNames[type]); } } : undefined}>{editing?.title || title || widgetNames[type]}</h2>}</div>{onAction && <button type="button" onClick={onAction}>{action}</button>}</header>;
}
const metricNames = { assigned: "Mis tareas", today: "Vencen hoy", progress: "En curso" };

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
    return <article className={`home_widget home_widget_${widget.type} home_size_${widget.size} home_variant_compact`} onPointerDown={event => { if (event.target.closest(".home_widget_heading") && !event.target.closest("button, a, input, h2")) beginDrag(event, widget.id); }}>
        <div className="home_widget_tools"><button className="home_drag" type="button" aria-label="Mover widget. Arrastra o usa las flechas para cambiar su posición." onPointerDown={event => beginDrag(event, widget.id)} onKeyDown={event => { if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); move(index, index - 1); } if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(index, index + 1); } }}><GripVertical /></button><WidgetMenu id={widget.id} openId={openId} setOpenId={setOpenId}>{close => <><span className="home_menu_label">Tamaño</span>{[["small", "Pequeño"], ["medium", "Mediano"], ["large", "Grande"]].map(([size, label]) => <button type="button" className={widget.size === size ? "is_selected" : ""} aria-pressed={widget.size === size} key={size} onClick={() => { update(index, { ...widget, size }); close(); }}>{label}</button>)}<button type="button" onClick={() => { move(index, index - 1); close(); }}>Mover antes</button><button type="button" onClick={() => { move(index, index + 1); close(); }}>Mover después</button>{configure && <button type="button" onClick={() => { configure(); close(); }}>Personalizar contenido</button>}<button className="home_remove" type="button" onClick={() => { remove(index); close(); }}>Quitar widget</button></>}</WidgetMenu></div>
        <WidgetTitleContext.Provider value={{ title: widget.title, save: title => update(index, { ...widget, title }) }}><div className="home_widget_body">{children}</div></WidgetTitleContext.Provider>
    </article>;
}

function HomeWidgetSlot({ widget, position, columns, dragging, dropTarget, children, onMeasure }) {
    const slot = useRef(null), measureRef = useRef(onMeasure);
    measureRef.current = onMeasure;
    useLayoutEffect(() => {
        const card = slot.current?.firstElementChild;
        if (!card) return;
        const measure = () => measureRef.current(widget.id, card.offsetHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(card);
        return () => observer.disconnect();
    }, [widget.id, columns]);
    return <div ref={slot} data-home-widget={widget.id} className={`home_widget_slot${position.height ? " is_uniform" : ""}${dragging ? " is_dragging" : ""}${dropTarget ? " is_drop_target" : ""}`} style={{ top: position.top, left: `calc(${position.column / columns * 100}% + ${position.column * 14 / columns}px)`, width: `calc(${position.span / columns * 100}% - ${(1 - position.span / columns) * 14}px)`, height: position.height }}>{children}</div>;
}

function MetricsWidget({ widget, data }) {
    const values = { assigned: [data.assigned.length, "Asignadas a ti", Check], today: [data.dueToday.length, `${data.dueToday.filter(({ task }) => task.priority === "Alta").length} de prioridad alta`, Clock3], progress: [data.inProgress.length, `En ${new Set(data.inProgress.map(({ task }) => task.project_id)).size} proyectos`, BarChart3] };
    return <><WidgetHeading type="metrics" /><div className="home_metric_grid">{widget.metrics.map(id => { const [value, note, Icon] = values[id]; return <div key={id}><i><Icon /></i><strong>{value}</strong><span>{metricNames[id]}</span><small>{note}</small></div>; })}</div></>;
}

function TasksWidget({ widget, data, projects, onChange, onOpenTask, onOpenTasks, onToggleTask, onCreateTask }) {
    const visible = widget.tab === "upcoming" ? data.upcoming : widget.tab === "undated" ? data.undated : data.attention;
    return <><WidgetHeading type="tasks" action="Ver todas" onAction={onOpenTasks} /><div className="home_tabs" role="tablist">{[["today", "Hoy"], ["upcoming", "Próximas"], ["undated", "Sin fecha"]].map(([id, label]) => <button className={widget.tab === id ? "active" : ""} role="tab" aria-selected={widget.tab === id} onClick={() => onChange({ ...widget, tab: id })} key={id}>{label}</button>)}</div><div className="home_task_list">{visible.slice(0, 4).map(({ task }) => { const project = projects.find(item => item.id === task.project_id); return <div className="home_task" key={task.id} onClick={() => onOpenTask(task.id)} role="button" tabIndex="0" onKeyDown={event => event.key === "Enter" && onOpenTask(task.id)}><button className="home_task_check" aria-label={`Completar ${task.title}`} onClick={event => { event.stopPropagation(); onToggleTask(task.id); }} /><div><strong>{task.title}</strong><span className={`home_priority home_priority_${task.priority?.toLowerCase()}`}>{task.priority}</span></div><div className="home_task_project"><span style={{ background: project?.color }} /><strong>{project?.label || "Sin proyecto"}</strong><small>{task.due_label || "Sin fecha"}</small></div></div>; })}{!visible.length && <p className="home_empty">No tienes tareas en esta categoría.</p>}</div><button className="home_quick_add" onClick={onCreateTask}>+ Agregar tarea rápida</button></>;
}

function ProjectsWidget({ data, onOpenProject, onOpenTasks }) {
    return <><WidgetHeading type="projects" action="Ver todos" onAction={onOpenTasks} /><div className="home_projects_list">{data.projects.slice(0, 3).map(project => <button className="home_project" onClick={() => onOpenProject(project.id)} key={project.id}><div><span style={{ background: project.color }} /><strong>{project.label}</strong><b>{percentage(project.completed, project.total)}%</b></div><progress value={project.completed} max={project.total || 1} style={{ accentColor: project.color }} /><small>{project.completed} de {project.total} tareas completadas</small></button>)}{!data.projects.length && <p className="home_empty">Todavía no hay proyectos.</p>}</div></>;
}

function ActivityWidget({ activity = [], onOpenTasks, onOpenTask, onOpenProject }) {
    const icons = { task_created: Plus, project_created: FolderPlus, assignment: Plus, comment: AtSign, status_changed: Check };
    return <><WidgetHeading type="activity" action="Ver actividad" onAction={onOpenTasks} /><div className="home_activity_list">{activity.slice(0, 4).map(item => { const Icon = icons[item.type] || Check; const open = item.project_id ? () => onOpenProject(item.project_id) : item.task_id ? () => onOpenTask(item.task_id) : onOpenTasks; return <button type="button" className="home_activity_item" key={item.id} onClick={open}><i className={`home_activity_icon_${item.type}`}><Icon /></i><div><strong>{item.title}</strong><small>{item.time_label || (item.created_at && new Date(item.created_at).toLocaleString("es"))}{item.body ? ` · ${item.body}` : ""}</small></div></button>; })}{!activity.length && <p className="home_empty">Sin actividad reciente.</p>}</div></>;
}

function ShortcutPicker({ widget, catalog, apply, close }) {
    const [query, setQuery] = useState(""), [projectQuery, setProjectQuery] = useState(""), [selected, setSelected] = useState(widget.shortcuts || []);
    const toggle = id => setSelected(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
    const groups = [
        { title: "Accesos", items: catalog.filter(item => !item.id.startsWith("project:")), query, setQuery, placeholder: "Buscar acceso…" },
        { title: "Proyectos", items: catalog.filter(item => item.id.startsWith("project:")), query: projectQuery, setQuery: setProjectQuery, placeholder: "Buscar proyecto…" },
    ];
    return <><div className="home_picker_columns">{groups.map(group => <section className="home_picker_column" key={group.title}><h3>{group.title}</h3><label className="home_picker_search"><Search /><input className="home_picker_input" autoFocus={group.title === "Accesos"} value={group.query} onChange={event => group.setQuery(event.target.value)} placeholder={group.placeholder} /></label><div className="home_picker_list">{group.items.filter(item => item.label.toLowerCase().includes(group.query.toLowerCase())).map(item => <button className={selected.includes(item.id) ? "is_selected" : ""} type="button" key={item.id} onClick={() => toggle(item.id)}><span>{item.label}</span>{selected.includes(item.id) && <Check />}</button>)}{!group.items.length && <p className="home_picker_empty">No hay proyectos disponibles.</p>}</div></section>)}</div><footer><button type="button" onClick={close}>Cancelar</button><button className="is_primary" type="button" disabled={!selected.length} onClick={() => { apply({ ...widget, shortcuts: selected }); close(); }}>Aplicar</button></footer></>;
}

function ShortcutsWidget({ widget, catalog }) {
    const selected = widget.shortcuts.map(id => catalog.find(item => item.id === id)).filter(Boolean);
    return <><WidgetHeading type="shortcuts" /><div className="home_shortcuts">{selected.map(item => { const Icon = item.icon; return <button type="button" onClick={item.action} key={item.id}><i><Icon /></i><span>{item.label}</span><ChevronRight /></button>; })}{!selected.length && <p className="home_empty">Elige accesos desde los tres puntos.</p>}</div></>;
}

function StatusWidget({ data, onOpenTasks }) {
    const { completed, inProgress, pending } = data.statusCounts;
    const total = completed + inProgress + pending;
    return <><WidgetHeading type="status" action="Ver tareas" onAction={onOpenTasks} /><div className="home_status_content">{[["Completadas", completed, "#18b884"], ["En curso", inProgress, "#ffb72c"], ["Pendientes", pending, "#7e9cb9"]].map(([label, value, color]) => { const percent = percentage(value, total); return <div className="home_status_metric" key={label}><div className="home_status_ring" style={{ background: `conic-gradient(${color} ${percent}%, var(--bold_line) 0)` }}><span><strong>{value}</strong><small>{percent}%</small></span></div><strong>{label}</strong></div>; })}</div></>;
}

function DeadlinesWidget({ data, onOpenTask, onOpenTasks }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return <><WidgetHeading type="deadlines" action="Ver todas" onAction={onOpenTasks} /><div className="home_deadlines_list">{data.deadlines.map(({ task, due }) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><i><CalendarDays /></i><span><strong>{task.title}</strong><small>{due < today ? "Vencida · " : ""}{due.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</small></span><ChevronRight /></button>)}{!data.deadlines.length && <p className="home_empty">No tienes vencimientos próximos.</p>}</div></>;
}

function GalleryPreview({ type, data, projects, catalog }) {
    const widget = { type, variant: "compact", metrics: Object.keys(metricNames), tab: "today", shortcuts: ["create_task", "create_project"] };
    const noop = () => {};
    const content = type === "metrics" ? <MetricsWidget widget={widget} data={data} />
        : type === "tasks" ? <TasksWidget widget={widget} data={data} projects={projects} onChange={noop} onOpenTask={noop} onOpenTasks={noop} onToggleTask={noop} onCreateTask={noop} />
        : type === "projects" ? <ProjectsWidget data={data} onOpenProject={noop} onOpenTasks={noop} />
        : type === "activity" ? <ActivityWidget activity={data.activity} onOpenTasks={noop} onOpenTask={noop} onOpenProject={noop} />
        : type === "shortcuts" ? <ShortcutsWidget widget={widget} catalog={catalog} />
        : type === "status" ? <StatusWidget data={data} onOpenTasks={noop} />
        : <DeadlinesWidget data={data} onOpenTask={noop} onOpenTasks={noop} />;
    return <article className={`home_widget home_widget_${type} home_variant_compact`}><div className="home_widget_body">{content}</div></article>;
}

function WidgetGallery({ data, projects, catalog, onAdd, onClose, triggerRef }) {
    const [added, setAdded] = useState(0);
    useDialog(true, ".home_gallery", onClose);
    useEffect(() => () => triggerRef.current?.focus(), [triggerRef]);
    const descriptions = { metrics: "Tus cifras importantes de un vistazo", tasks: "Lo pendiente para hoy y los próximos días", projects: "Avance de tus proyectos", activity: "Últimos movimientos de tu equipo", shortcuts: "Enlaces a lo que usas más", status: "Distribución real de tus tareas", deadlines: "Tareas con fecha próxima" };
    return createPortal(<div className="home_modal_backdrop home_gallery_backdrop" onPointerDown={event => event.target === event.currentTarget && onClose()}><section className="home_gallery" role="dialog" aria-modal="true" aria-label="Galería de widgets"><header><div><span>PERSONALIZA TU INICIO</span><h2>Galería de widgets</h2><p>Elige y agrega varias copias.</p></div><button type="button" aria-label="Cerrar galería" onClick={onClose}><X /></button></header><div className="home_gallery_grid">{HOME_WIDGET_TYPES.map(type => <article className="home_gallery_card home_variant_compact" aria-label={widgetNames[type]} key={type}><div className={`home_gallery_preview home_gallery_preview_${type}`} inert><GalleryPreview type={type} data={data} projects={projects} catalog={catalog} /></div><div className="home_gallery_card_info"><p>{descriptions[type]}</p><button type="button" onClick={() => { onAdd(type); setAdded(count => count + 1); }}><Plus /> Agregar</button></div></article>)}</div><footer><span role="status">{added ? `${added} ${added === 1 ? "widget agregado" : "widgets agregados"} al tablero` : "Selecciona un widget para agregarlo"}</span><button type="button" onClick={onClose}>Listo</button></footer></section></div>, document.body);
}

export default function HomeModule({ currentUser, notifications, onCreateProject, onCreateTask, onNavigate, onOpenProject, onOpenTask, onOpenTasks, onToggleTask, parseDueDate, projects, tasks }) {
    const { navigation_items } = useShell();
    const mobile = useMediaQuery("(max-width: 767px)"), tablet = useMediaQuery("(max-width: 1199px)"), columns = mobile ? 1 : tablet ? 6 : 12;
    const storageKey = `bold_home_layout:${currentUser?.id || "local"}`;
    const galleryTrigger = useRef(null), dashboardRef = useRef(null), positionsRef = useRef(new Map());
    const [layout, setLayout] = useState(() => { try { return normalizeHomeLayout(JSON.parse(localStorage.getItem(storageKey))); } catch { return defaultHomeLayout(); } });
    const layoutRef = useRef(layout), layoutKeyRef = useRef(storageKey), dragRef = useRef(null);
    layoutRef.current = layout;
    const [draggingId, setDraggingId] = useState(null), [dropTargetId, setDropTargetId] = useState(null), [heights, setHeights] = useState({});
    const now = new Date(), data = buildHomeData(tasks, projects, parseDueDate, currentUser?.id, now, notifications);
    const desktopHeights = Object.fromEntries(layout.map(widget => {
        const taskCount = widget.tab === "upcoming" ? data.upcoming.length : widget.tab === "undated" ? data.undated.length : data.attention.length;
        const count = widget.type === "tasks" ? taskCount : widget.type === "projects" ? data.projects.length : widget.type === "activity" ? data.activity.length : widget.type === "deadlines" ? data.deadlines.length : 0;
        const shortcutColumns = widget.size === "small" ? 1 : columns === 6 ? 2 : widget.size === "large" ? 5 : 4;
        const height = widget.type === "tasks" ? 210 + Math.min(4, count) * 58 : widget.type === "projects" ? 110 + Math.min(3, count) * (widget.size === "small" ? 88 : 72) : widget.type === "activity" || widget.type === "deadlines" ? 110 + Math.min(4, count) * 60 : widget.type === "shortcuts" ? 110 + Math.ceil((widget.shortcuts?.length || 0) / shortcutColumns) * 55 : 260;
        return [widget.id, Math.min(340, Math.max(260, height))];
    }));
    const { positions, height: dashboardHeight } = placeHomeWidgets(layout, mobile ? heights : desktopHeights, columns);
    const measureWidget = (id, height) => setHeights(current => current[id] === height ? current : { ...current, [id]: height });
    useLayoutEffect(() => {
        const previous = positionsRef.current, next = new Map();
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        dashboardRef.current?.querySelectorAll("[data-home-widget]").forEach(slot => {
            const id = slot.dataset.homeWidget, at = { left: slot.offsetLeft, top: slot.offsetTop }, before = previous.get(id);
            next.set(id, at);
            if (before && !reduced && (before.left !== at.left || before.top !== at.top)) {
                slot.getAnimations().forEach(animation => animation.cancel());
                slot.animate([{ transform: `translate(${before.left - at.left}px, ${before.top - at.top}px)` }, { transform: "translate(0, 0)" }], { duration: 180, easing: "ease-out" });
            }
        });
        positionsRef.current = next;
    }, [layout, columns]);
    const [openMenu, setOpenMenu] = useState(null), [picker, setPicker] = useState(null), [galleryOpen, setGalleryOpen] = useState(false);
    useEffect(() => {
        if (layoutKeyRef.current !== storageKey) {
            layoutKeyRef.current = storageKey;
            try { setLayout(normalizeHomeLayout(JSON.parse(localStorage.getItem(storageKey)))); } catch { setLayout(defaultHomeLayout()); }
            return;
        }
        try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch {}
    }, [layout, storageKey]);
    useEffect(() => setOpenMenu(null), [columns]);
    useEffect(() => { if (!picker) return; const close = event => event.key === "Escape" && setPicker(null); document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [picker]);
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
                ghost = card.cloneNode(true);
                ghost.classList.add("home_drag_ghost");
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
    const catalog = useMemo(() => [{ id: "create_task", label: "Crear una tarea", icon: Plus, action: onCreateTask }, { id: "create_project", label: "Crear un proyecto", icon: FolderPlus, action: onCreateProject }, ...navigation_items.filter(item => item.id !== "home").map(item => ({ id: `module:${item.id}`, label: `Abrir ${item.label}`, icon: BarChart3, action: () => onNavigate(item.id) })), ...projects.map(project => ({ id: `project:${project.id}`, label: project.label, icon: FolderPlus, action: () => onOpenProject(project.id) }))], [navigation_items, projects, onCreateTask, onCreateProject, onNavigate, onOpenProject]);
    const greeting = now.getHours() < 12 ? "Buenos días" : now.getHours() < 19 ? "Buenas tardes" : "Buenas noches";
    const add = type => setLayout(items => [...items, { id: `home_${type}_${crypto.randomUUID()}`, type, variant: "compact", size: type === "metrics" ? "large" : "medium", ...(type === "metrics" ? { metrics: Object.keys(metricNames) } : {}), ...(type === "tasks" ? { tab: "today" } : {}), ...(type === "shortcuts" ? { shortcuts: ["create_task", "create_project"] } : {}) }]);
    return <section className="home_module" data-tour="home"><header className="home_header" data-tour="home-header"><div><h1>{greeting}</h1><p>{dateText(now)} · Esto es lo más importante para hoy</p></div><div className="home_toolbar" data-tour="home-toolbar"><button ref={galleryTrigger} className="home_gallery_trigger" type="button" onClick={() => setGalleryOpen(true)}><Plus /> Agregar widget</button><button type="button" onClick={() => setLayout(defaultHomeLayout())}><RotateCcw /> Restaurar</button></div></header>
        <div ref={dashboardRef} className="home_dashboard" data-tour="home-dashboard" style={{ height: layout.length ? dashboardHeight : 190 }}>
            {!layout.length && <div className="home_dashboard_empty"><p>Tu tablero está vacío.</p><button type="button" onClick={() => setGalleryOpen(true)}>Explorar widgets</button></div>}
            {layout.map((widget, index) => {
                const configure = ["metrics", "shortcuts"].includes(widget.type) ? () => setPicker({ type: widget.type, index }) : null;
                return <HomeWidgetSlot widget={widget} position={positions[widget.id]} columns={columns} dragging={draggingId === widget.id} dropTarget={dropTargetId === widget.id} onMeasure={measureWidget} key={widget.id}>
                    <WidgetFrame widget={widget} index={index} openId={openMenu} setOpenId={setOpenMenu} move={move} remove={position => setLayout(items => items.filter((_, itemIndex) => itemIndex !== position))} configure={configure} update={update} beginDrag={beginDrag}>
                        {widget.type === "metrics" ? <MetricsWidget widget={widget} data={data} /> : widget.type === "tasks" ? <TasksWidget widget={widget} data={data} projects={projects} onChange={value => update(index, value)} onOpenTask={onOpenTask} onOpenTasks={onOpenTasks} onToggleTask={onToggleTask} onCreateTask={onCreateTask} /> : widget.type === "projects" ? <ProjectsWidget data={data} onOpenProject={onOpenProject} onOpenTasks={() => onNavigate("projects")} /> : widget.type === "activity" ? <ActivityWidget activity={data.activity} onOpenTasks={() => onNavigate("inbox")} onOpenTask={onOpenTask} onOpenProject={onOpenProject} /> : widget.type === "status" ? <StatusWidget data={data} onOpenTasks={onOpenTasks} /> : widget.type === "deadlines" ? <DeadlinesWidget data={data} onOpenTask={onOpenTask} onOpenTasks={onOpenTasks} /> : <ShortcutsWidget widget={widget} catalog={catalog} />}
                    </WidgetFrame>
                </HomeWidgetSlot>;
            })}
        </div>
        {galleryOpen && <WidgetGallery data={data} projects={projects} catalog={catalog} onAdd={add} onClose={() => setGalleryOpen(false)} triggerRef={galleryTrigger} />}
        {picker && <div className="home_modal_backdrop" onPointerDown={event => event.target === event.currentTarget && setPicker(null)}><section className={`home_picker${picker.type === "shortcuts" ? " home_picker_shortcuts" : ""}`} role="dialog" aria-modal="true" aria-label="Personalizar widget"><header><div><span>PERSONALIZAR</span><h2>{widgetNames[layout[picker.index]?.type]}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setPicker(null)}><X /></button></header>{picker.type === "shortcuts" ? <ShortcutPicker widget={layout[picker.index]} catalog={catalog} apply={value => update(picker.index, value)} close={() => setPicker(null)} /> : <div className="home_metric_picker">{Object.entries(metricNames).map(([id, label]) => <button className={layout[picker.index].metrics.includes(id) ? "is_selected" : ""} type="button" key={id} onClick={() => { const widget = layout[picker.index], selected = widget.metrics.includes(id) ? widget.metrics.filter(item => item !== id) : [...widget.metrics, id]; if (selected.length) update(picker.index, { ...widget, metrics: selected }); }}><span>{label}</span>{layout[picker.index].metrics.includes(id) && <Check />}</button>)}</div>}</section></div>}
    </section>;
}
