import { useState } from "react";
import { buildReport } from "./report_data.js";
import "./reports.css";

const percent = (part, total) => total ? Math.round(part / total * 100) : 0;

export default function ReportsModule({ tasks, projects, parseDueDate }) {
    const [days, setDays] = useState(30);
    const [downloaded, setDownloaded] = useState(false);
    const report = buildReport(tasks, projects, days, parseDueDate);
    const completion = percent(report.completed, report.total);
    const active = percent(report.active, report.total);
    const maximum = Math.max(1, ...report.weeks.map(week => week.count));
    function downloadReport() {
        const rows = [["Informe BOLD", new Date().toLocaleDateString("es")], ["Período por vencimiento", days ? `Últimos ${days} días` : "Todo el período"], ["Tareas totales", report.total], ["Completadas", report.completed], ["En curso", report.active], ["Retrasadas", report.overdue], [], ["Proyecto", "Completadas", "Total", "Progreso"], ...report.projects.map(project => [project.label, project.completed, project.total, `${percent(project.completed, project.total)}%`])];
        const csv = rows.map(row => row.map(value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `informe-bold-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setDownloaded(true);
    }
    return <section className="reports_module">
        <header className="reports_header">
            <div><h1>Informes</h1><p>Resumen del rendimiento de BOLD Workspace</p></div>
            <div className="reports_actions">
                <select aria-label="Período del informe" value={days} onChange={event => { setDays(Number(event.target.value)); setDownloaded(false); }}>
                    <option value={30}>Últimos 30 días</option><option value={7}>Últimos 7 días</option><option value={90}>Últimos 90 días</option><option value={0}>Todo el período</option>
                </select>
                <button className="primary_button" onClick={downloadReport}>+ Crear informe</button>
            </div>
        </header>
        <p className="reports_scope">{days ? "Tareas con vencimiento en el período seleccionado." : "Todas las tareas, incluidas las que no tienen fecha."} <span role="status">{downloaded ? "Informe CSV descargado." : ""}</span></p>
        <div className="reports_metrics">
            {[["Tareas totales", report.total, null], ["Completadas", report.completed, `${completion}%`], ["En curso", report.active, `${active}%`], ["Retrasadas", report.overdue, `${percent(report.overdue, report.total)}%`]].map(([label, value, badge], index) => <article className={`reports_metric reports_metric_${index}`} key={label}><h2>{label}</h2><div><strong>{value}</strong>{badge && <span>{badge}</span>}</div></article>)}
        </div>
        <div className="reports_charts">
            <article className="reports_card"><h2>Tareas completadas por semana</h2><p>Agrupadas por vencimiento · últimas seis semanas</p>
                <div className="reports_bars" role="img" aria-label={report.weeks.map(week => `${week.label}: ${week.count} completadas`).join("; ")}>
                    {report.weeks.map((week, index) => <div className="reports_bar_column" key={week.label}><div className="reports_bar_space"><div className="reports_bar" style={{ height: `${week.count / maximum * 100}%`, opacity: .35 + index * .13 }} title={`${week.count} completadas`}>{week.count > 0 && <span>{week.count}</span>}</div></div><small>{week.label}</small></div>)}
                </div>
                {!report.weeks.some(week => week.count) && <p className="reports_empty">Sin tareas completadas con vencimiento en estas semanas.</p>}
            </article>
            <article className="reports_card"><h2>Estado del trabajo</h2><p>Distribución de tareas del período</p>
                <div className="reports_donut" role="img" aria-label={`${completion}% completado, ${report.active} en curso, ${report.pending} por hacer`} style={{ background: `conic-gradient(#e73535 0 ${completion}%, #4d99df ${completion}% ${completion + active}%, #efeeec ${completion + active}% 100%)` }}><div><strong>{completion}%</strong><span>completado</span></div></div>
                <ul className="reports_legend">{[["Completadas", report.completed, "#e73535"], ["En curso", report.active, "#4d99df"], ["Por hacer", report.pending, "#cbc9cc"]].map(([label, count, color]) => <li key={label}><i style={{ background: color }} />{label}<strong>{count}</strong></li>)}</ul>
            </article>
        </div>
        <article className="reports_card reports_projects"><h2>Progreso por proyecto</h2>
            {report.projects.map(project => <div className="reports_project" key={project.id}><strong>{project.label}</strong><progress aria-label={`Progreso de ${project.label}`} value={project.completed} max={project.total || 1} style={{ accentColor: project.color || "#e73535", color: project.color || "#e73535" }} /><b>{percent(project.completed, project.total)}%</b><span>{project.completed} / {project.total}</span></div>)}
            {!report.total && <p>No hay tareas en este período. Selecciona otro período para ver más datos.</p>}
        </article>
    </section>;
}

