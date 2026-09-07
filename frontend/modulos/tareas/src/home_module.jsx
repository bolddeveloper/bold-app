import { useState } from "react";
import { AtSign, BarChart3, Check, ChevronRight, Clock3, FolderPlus, Plus } from "lucide-react";
import { buildHomeData } from "./home_data.js";
import "./home.css";

const percentage = (part, total) => total ? Math.round(part / total * 100) : 0;
const dateText = date => date.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

export default function HomeModule({ currentUser, notifications, onCreateProject, onCreateTask, onOpenProject, onOpenReports, onOpenTask, onOpenTasks, onToggleTask, parseDueDate, projects, tasks }) {
    const [tab, setTab] = useState("today");
    const now = new Date();
    const data = buildHomeData(tasks, projects, parseDueDate, currentUser?.id, now);
    const visibleTasks = tab === "today" ? data.dueToday : tab === "upcoming" ? data.upcoming : data.undated;
    const hour = now.getHours();
    const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
    const activityIcons = { assignment: Plus, comment: AtSign, status_changed: Check };
    return <section className="home_module">
        <header className="home_header"><h1>{greeting}</h1><p>{dateText(now)} · Esto es lo más importante para hoy</p></header>
        <div className="home_metrics">
            <article className="home_metric home_metric_primary"><div><span>Mis tareas</span><strong>{data.assigned.length}</strong><small>Asignadas a ti</small></div><i><Check /></i></article>
            <article className="home_metric"><div><span>Vencen hoy</span><strong>{data.dueToday.length}</strong><small>{data.dueToday.filter(({ task }) => task.priority === "Alta").length} de prioridad alta</small></div><i className="home_metric_red"><Clock3 /></i></article>
            <article className="home_metric"><div><span>En curso</span><strong>{data.inProgress.length}</strong><small>En {new Set(data.inProgress.map(({ task }) => task.project_id)).size} proyectos</small></div><i className="home_metric_blue"><span>{data.inProgress.length}</span></i></article>
        </div>
        <div className="home_grid">
            <article className="home_card home_tasks_card">
                <div className="home_card_header"><h2>Mis tareas</h2><button onClick={onOpenTasks}>Ver todas</button></div>
                <div className="home_tabs" role="tablist">{[["today", "Hoy"], ["upcoming", "Próximas"], ["undated", "Sin fecha"]].map(([id, label]) => <button className={tab === id ? "active" : ""} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} key={id}>{label}</button>)}</div>
                <div className="home_task_list">{visibleTasks.slice(0, 4).map(({ task }) => {
                    const project = projects.find(item => item.id === task.project_id);
                    return <div className="home_task" key={task.id} onClick={() => onOpenTask(task.id)} role="button" tabIndex="0" onKeyDown={event => event.key === "Enter" && onOpenTask(task.id)}>
                        <button className="home_task_check" aria-label={`Completar ${task.title}`} onClick={event => { event.stopPropagation(); onToggleTask(task.id); }} />
                        <div><strong>{task.title}</strong><span className={`home_priority home_priority_${task.priority?.toLowerCase()}`}>{task.priority}</span></div>
                        <div className="home_task_project"><span style={{ background: project?.color }} /> <strong>{project?.label || "Sin proyecto"}</strong><small>{task.due_label || "Sin fecha"}</small></div>
                    </div>;
                })}{!visibleTasks.length && <p className="home_empty">No tienes tareas en esta categoría.</p>}</div>
                <button className="home_quick_add" onClick={onCreateTask}>+ Agregar tarea rápida</button>
            </article>
            <article className="home_card home_projects_card"><div className="home_card_header"><h2>Progreso de proyectos</h2><button onClick={onOpenTasks}>Ver todas</button></div>
                {data.projects.slice(0, 3).map(project => <button className="home_project" onClick={() => onOpenProject(project.id)} key={project.id}><div><span style={{ background: project.color }} /><strong>{project.label}</strong><b>{percentage(project.completed, project.total)}%</b></div><progress value={project.completed} max={project.total || 1} style={{ accentColor: project.color }} /><small>{project.completed} de {project.total} tareas completadas</small></button>)}
            </article>
            <article className="home_card home_activity"><div className="home_card_header"><h2>Actividad reciente</h2><button onClick={onOpenTasks}>Ver actividad</button></div>
                {notifications.slice(0, 3).map(item => { const Icon = activityIcons[item.type] || Check; return <div className="home_activity_item" key={item.id}><i><Icon size={17} /></i><div><strong>{item.title}</strong><small>{item.time_label} · {item.body}</small></div></div>; })}
            </article>
            <article className="home_card home_shortcuts"><h2>Accesos rápidos</h2>
                <button onClick={onCreateTask}><i className="shortcut_red"><Plus /></i><span>Crear una tarea</span><ChevronRight /></button>
                <button onClick={onCreateProject}><i className="shortcut_blue"><FolderPlus /></i><span>Crear un proyecto</span><ChevronRight /></button>
                <button onClick={onOpenReports}><i className="shortcut_green"><BarChart3 /></i><span>Abrir informes</span><ChevronRight /></button>
            </article>
        </div>
    </section>;
}
