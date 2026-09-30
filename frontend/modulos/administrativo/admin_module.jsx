import { BoldSelect as AdminSelect } from "../core/shared/bold_select.jsx";
import Swal from "sweetalert2";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, Check, ChevronDown, GripVertical, LayoutDashboard, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserPlus, Users, PlugZap } from "lucide-react";

import { useCore } from "../core/core_provider.jsx";
import { coreApi } from "../core/core_api.js";
import { adminApi } from "./admin_api.js";
import { useDialog } from "../core/shared/use_dialog.js";
import { useMediaQuery } from "../core/shared/use_media_query.js";
import Connectors from "./connectors.jsx";

const adminDialog = options => Swal.fire({
    confirmButtonColor: "#ef1f2d",
    cancelButtonText: "Cancelar",
    confirmButtonText: "Continuar",
    customClass: { popup: "admin_swal" },
    ...options,
});
async function askText(title, value = "", minimum = 1) {
    const result = await adminDialog({
        title, input: "text", inputValue: value, showCancelButton: true,
        inputValidator: value => value.trim().length < minimum ? `Ingresa al menos ${minimum} caracteres.` : undefined,
    });
    return result.isConfirmed ? result.value.trim() : null;
}
async function askTemporaryPassword() {
    const result = await adminDialog({
        title: "Establecer contraseña temporal",
        html: `<div class="admin_password_reset_form"><p>El empleado deberá reemplazarla al iniciar sesión. La contraseña no se mostrará nuevamente.</p><label>Nueva contraseña<input id="admin_new_password" type="password" autocomplete="new-password" maxlength="1024"></label><label>Confirmar contraseña<input id="admin_password_confirmation" type="password" autocomplete="new-password" maxlength="1024"></label><label>Motivo<textarea id="admin_password_reason" maxlength="1000"></textarea></label></div>`,
        showCancelButton: true,
        focusConfirm: false,
        preConfirm: () => {
            const password = document.getElementById("admin_new_password")?.value || "";
            const passwordConfirmation = document.getElementById("admin_password_confirmation")?.value || "";
            const reason = document.getElementById("admin_password_reason")?.value.trim() || "";
            if (password.length < 8) return Swal.showValidationMessage("La contraseña debe contener al menos 8 caracteres.");
            if (password !== passwordConfirmation) return Swal.showValidationMessage("Las contraseñas no coinciden.");
            if (reason.length < 8) return Swal.showValidationMessage("Ingresa un motivo de al menos 8 caracteres.");
            return { password, password_confirmation: passwordConfirmation, reason };
        },
    });
    return result.isConfirmed ? result.value : null;
}
async function confirmOrganization(title) {
    return (await adminDialog({ title, text: "El cambio quedará registrado en el historial.", icon: "question", showCancelButton: true })).isConfirmed;
}

const tabs = [
    ["dashboard", "Resumen", LayoutDashboard],
    ["employees", "Empleados", Users],
    ["audit", "Auditoría", Activity],
    ["organization", "Organización", Building2],
    ["connectors", "Conectores", PlugZap],
];

const metricLabels = {
    tasks_total: "Tareas totales",
    tasks_completed: "Completadas",
    tasks_overdue: "Vencidas",
    projects_active: "Proyectos activos",
};
const metricLabel = value => metricLabels[value] || value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const dateTime = value => value ? new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala" }).format(new Date(value)) : "—";
const positionLabel = row => `${row.role_title} · ${row.unit_name} · ${row.occupant_name || `Vacante ${row.display_order} (${String(row.id).slice(0, 4)})`}`;


function Loading({ error, onRetry }) {
    return <div className="admin_state"><p>{error || "Cargando información administrativa…"}</p>{error && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
}

const organizationMetricLabels = {
    employees_total: "Empleados totales", employees_active: "Empleados activos", accounts_active: "Cuentas activas",
    accounts_inactive: "Cuentas inactivas", accounts_pending_invitation: "Invitaciones pendientes",
    organizational_units: "Unidades organizativas", active_assignments: "Cargos activos",
};
const securityMetricLabels = {
    active_sessions: "Sesiones activas", mfa_enabled_accounts: "Cuentas con MFA",
    failed_logins_24h: "Accesos fallidos (24 h)", password_resets_24h: "Contraseñas restablecidas (24 h)",
};

function dashboardMetrics(data) {
    const accountsTotal = data.organization.accounts_active + data.organization.accounts_inactive;
    const metrics = [
        ...Object.entries(data.organization).map(([key, value]) => ({ id: `organization.${key}`, label: organizationMetricLabels[key] || metricLabel(key), value,
            total: key === "employees_active" ? data.organization.employees_total : ["accounts_active", "accounts_inactive", "accounts_pending_invitation"].includes(key) ? accountsTotal : null })),
        ...Object.entries(data.security).map(([key, value]) => ({ id: `security.${key}`, label: securityMetricLabels[key] || metricLabel(key), value,
            total: key === "mfa_enabled_accounts" ? data.organization.accounts_active : null })),
    ];
    for (const module of data.modules) for (const [key, value] of Object.entries(module.metrics)) metrics.push({
        id: `module.${module.code}.${key}`, label: `${module.title} · ${metricLabel(key)}`, value,
        total: ["tasks_completed", "tasks_overdue"].includes(key) ? module.metrics.tasks_total : null,
    });
    return metrics;
}

function WidgetMenu({ children, label = "Opciones del widget", add = false, onOpen }) {
    const [open, setOpen] = useState(false), root = useRef(null), trigger = useRef(null);
    function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
    useEffect(() => {
        if (!open) return;
        const outside = event => { if (!root.current?.contains(event.target)) close(); };
        const escape = event => { if (event.key === "Escape") { event.stopPropagation(); close(true); } };
        document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
    }, [open]);
    return <div className={`admin_widget_menu${add ? " admin_add_widget" : ""}${open ? " is_open" : ""}`} ref={root}><button ref={trigger} className="admin_widget_trigger" type="button" aria-label={label} aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }}>{add ? <><Plus size={16} /> Agregar widget</> : <MoreHorizontal size={19} />}</button>{open && <div className="admin_widget_popover">{typeof children === "function" ? children(() => close(true)) : children}</div>}</div>;
}

const metricGroup = id => id.startsWith("organization.") ? "Organización" : id.startsWith("security.") ? "Seguridad" : "Módulos";
const metricPercent = metric => metric.total > 0 ? Math.min(100, Math.round(metric.value / metric.total * 100)) : null;

function MetricList({ selected = [], metrics, visualization }) {
    const rows = selected.map(id => metrics.find(metric => metric.id === id)).filter(Boolean);
    if (visualization === "circle") return <div className="admin_metric_circles" style={{ "--metric-columns": Math.min(4, rows.length), "--metric-size": rows.length === 1 ? "112px" : rows.length <= 4 ? "96px" : "86px" }}>{rows.map(metric => { const percent = metricPercent(metric); return <div key={metric.id}><i style={percent === null ? {} : { "--metric-progress": `${percent}%` }}><strong>{metric.value}</strong>{percent !== null && <small>{percent}%</small>}</i><span>{metric.label}</span></div>; })}</div>;
    const proportional = rows.filter(metric => metric.total > 0); const maximum = Math.max(1, ...rows.filter(metric => !metric.total).map(metric => metric.value));
    return <div className="admin_metric_bars">{rows.map(metric => { const percent = metricPercent(metric); const width = percent ?? (proportional.length ? 0 : metric.value / maximum * 100); return <div key={metric.id}><span>{metric.label}</span><strong>{metric.value}</strong><i><b className={percent === null ? "is_count" : ""} style={{ width: `${width}%` }} /></i>{percent !== null && <small>{percent}% de {metric.total}</small>}</div>; })}</div>;
}

function MetricPicker({ widget, metrics, onApply, onRemove, close, busy }) {
    const [selected, setSelected] = useState(widget.metrics || []), [visualization, setVisualization] = useState(widget.visualization);
    const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    return <><div className="admin_metric_checks">{["Organización", "Seguridad", "Módulos"].map(group => { const options = metrics.filter(metric => metricGroup(metric.id) === group); return options.length > 0 && <fieldset key={group}><legend>{group}</legend>{options.map(metric => <label key={metric.id}><input type="checkbox" checked={selected.includes(metric.id)} onChange={() => toggle(metric.id)} /> <span>{metric.label}</span></label>)}</fieldset>; })}</div><strong>Visualización</strong><div className="admin_visual_options">{[["circle", "Circular"], ["bar", "Barra"]].map(([value, label]) => <button type="button" className={visualization === value ? "is_selected" : ""} key={value} onClick={() => setVisualization(value)}>{label}{visualization === value && <Check size={15} />}</button>)}</div><footer><button className="is_danger" type="button" disabled={busy} onClick={onRemove}>Quitar</button><button type="button" onClick={close}>Cancelar</button><button className="admin_primary" type="button" disabled={busy || !selected.length} onClick={() => { onApply({ ...widget, metrics: selected, visualization }); close(); }}>Aplicar</button></footer></>;
}

function WidgetHeader({ title, eyebrow, widget, metrics, onChange, onRemove, busy, drag }) {
    return <header><div><span className="admin_eyebrow">{eyebrow}</span><h2>{title}</h2></div><div className="admin_widget_actions"><button className="admin_drag_handle" type="button" draggable aria-label="Mover widget. Usa las flechas para cambiar su posición." onDragStart={drag.onDragStart} onKeyDown={drag.onKeyDown}><GripVertical size={18} /></button>{metrics && <WidgetMenu>{close => <MetricPicker key={(widget.metrics || []).join("|") + widget.visualization} widget={widget} metrics={metrics} onApply={onChange} onRemove={onRemove} close={close} busy={busy} />}</WidgetMenu>}{!metrics && <WidgetMenu>{close => <><button className="is_danger" type="button" disabled={busy} onClick={() => { onRemove(); close(); }}>Quitar widget</button></>}</WidgetMenu>}</div></header>;
}

function MetricWidget({ widget, metrics, onChange, onRemove, busy, drag }) {
    const selected = widget.metrics || [];
    const title = selected.length === 1 ? metrics.find(metric => metric.id === selected[0])?.label : `${selected.length} métricas`;
    return <article className="admin_dashboard_widget"><WidgetHeader eyebrow="MÉTRICAS" title={title || "Métricas"} widget={widget} metrics={metrics} onChange={onChange} onRemove={onRemove} busy={busy} drag={drag} /><div className="admin_widget_content"><MetricList selected={selected} metrics={metrics} visualization={widget.visualization} /></div></article>;
}

function ModulesWidget({ widget, metrics, onChange, onRemove, busy, drag }) {
    const selected = widget.metrics || metrics.map(metric => metric.id);
    return <section className="admin_dashboard_widget"><WidgetHeader eyebrow="PANORAMA MODULAR" title="Actividad de la aplicación" widget={{ ...widget, metrics: selected }} metrics={metrics} onChange={onChange} onRemove={onRemove} busy={busy} drag={drag} /><div className="admin_widget_content"><MetricList selected={selected} metrics={metrics} visualization={widget.visualization} /></div></section>;
}

function ActivityWidget({ widget, data, onRemove, busy, drag }) {
    return <section className="admin_dashboard_widget"><WidgetHeader eyebrow="ÚLTIMOS EVENTOS" title="Actividad reciente" widget={widget} onRemove={onRemove} busy={busy} drag={drag} /><div className="admin_widget_content admin_activity_list">{data.recent_activity.length ? data.recent_activity.slice(0, 8).map(item => <article key={`${item.module_code}:${item.id}`}><span className="admin_event_module">{item.module_code}</span><div><strong>{item.label || item.event_type}</strong><p>{item.actor || "Sistema"} · {item.unit || "General"}</p></div><time>{dateTime(item.occurred_at)}</time></article>) : <p>Sin actividad reciente registrada.</p>}</div></section>;
}

function packWidgetRows(layout, columns) {
    const rows = []; let row = [], used = 0;
    const finish = () => {
        if (!row.length) return;
        for (let spare = columns - used, index = 0; spare > 0; spare--, index = (index + 1) % row.length) row[index].width++;
        rows.push(row); row = []; used = 0;
    };
    layout.forEach((widget, index) => {
        const count = widget.type === "activity" ? 3 : (widget.metrics?.length ?? 0);
        const width = columns === 1 ? 1 : count > 2 || widget.type === "activity" ? Math.min(2, columns) : 1;
        if (used + width > columns) finish();
        row.push({ widget, index, width }); used += width;
        if (used === columns) finish();
    });
    finish(); return rows;
}

function Dashboard({ data, setNotice }) {
    const [layout, setLayout] = useState(data.layout), [busy, setBusy] = useState(false), [dragged, setDragged] = useState(null);
    const metrics = dashboardMetrics(data), moduleMetrics = metrics.filter(metric => metric.id.startsWith("module."));
    const usedTypes = new Set(layout.map(widget => widget.type));
    const mobile = useMediaQuery("(max-width: 600px)"), tablet = useMediaQuery("(max-width: 1000px)");
    const columns = mobile ? 1 : tablet ? 2 : 4, rows = packWidgetRows(layout, columns);
    async function update(next) { const previous = layout; setLayout(next); setBusy(true); try { const saved = await adminApi.saveDashboard(next); setLayout(saved.layout); setNotice("Tablero actualizado."); } catch (error) { setLayout(previous); setNotice(error.message, true); } finally { setBusy(false); } }
    const replace = (index, widget) => update(layout.map((item, position) => position === index ? widget : item));
    const remove = index => { if (layout.length > 1) update(layout.filter((_, position) => position !== index)); };
    const move = (from, to) => { if (!Number.isInteger(from) || from === to || to < 0 || to >= layout.length) return; const next = [...layout], [item] = next.splice(from, 1); next.splice(to, 0, item); update(next); };
    return <div className="admin_dashboard"><div className="admin_dashboard_toolbar"><div><h2>Tu tablero</h2><p>Elige, mueve y combina la información que quieres ver.</p></div><WidgetMenu label="Agregar widget" add>{close => <><button type="button" disabled={busy || layout.length >= 8} onClick={() => { update([...layout, { type: "metric", metrics: [metrics[0].id], visualization: "circle" }]); close(); }}>Widget de métricas</button>{!usedTypes.has("modules") && <button type="button" disabled={busy || layout.length >= 8} onClick={() => { update([...layout, { type: "modules", metrics: moduleMetrics.map(metric => metric.id), visualization: "bar" }]); close(); }}>Panorama modular</button>}{!usedTypes.has("activity") && <button type="button" disabled={busy || layout.length >= 8} onClick={() => { update([...layout, { type: "activity" }]); close(); }}>Actividad reciente</button>}</>}</WidgetMenu></div>
        <section className="admin_dashboard_grid">{rows.map((row, rowIndex) => <div className="admin_dashboard_row" style={{ "--dashboard-columns": columns }} key={rowIndex}>{row.map(({ widget, index, width }) => { const drag = { onDragStart: event => { setDragged(index); event.dataTransfer.effectAllowed = "move"; }, onKeyDown: event => { if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index, index - 1); } if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index, index + 1); } } }; return <div className="admin_widget_slot" key={`${widget.type}:${index}`} style={{ "--widget-width": width }} onDragOver={event => event.preventDefault()} onDrop={() => { move(dragged, index); setDragged(null); }}>{widget.type === "metric" ? <MetricWidget widget={widget} metrics={metrics} busy={busy} onChange={value => replace(index, value)} onRemove={() => remove(index)} drag={drag} /> : widget.type === "modules" ? <ModulesWidget widget={widget} metrics={moduleMetrics} busy={busy} onChange={value => replace(index, value)} onRemove={() => remove(index)} drag={drag} /> : <ActivityWidget widget={widget} data={data} busy={busy} onRemove={() => remove(index)} drag={drag} />}</div>; })}</div>)}</section>{layout.length >= 8 && <p className="admin_dashboard_limit">Puedes mostrar hasta ocho widgets.</p>}</div>;
}

function CreateEmployee({ positions, onCreate, onCancel, busy, temporaryPasswordEnabled }) {
    const [temporaryMode, setTemporaryMode] = useState(false);
    return <form className="admin_form" onSubmit={onCreate}>
        <h3>{temporaryMode ? "Crear empleado con acceso temporal" : "Crear empleado y enviar invitación"}</h3>
        <label>Nombre completo<input name="full_name" required maxLength="140" /></label>
        <label>Correo corporativo<input name="email" type="email" placeholder="nombre@bold.gt" required /></label>
        <label>Plaza inicial<AdminSelect name="position" label="Plaza inicial" options={[{ value: "", label: "Sin plaza por ahora" }, ...positions.filter(item => !item.occupied && item.is_open).map(item => ({ value: item.id, label: positionLabel(item) }))]} /></label>
        {temporaryPasswordEnabled && <label className="admin_experimental_toggle"><input type="checkbox" checked={temporaryMode} onChange={event => setTemporaryMode(event.target.checked)} /><span><strong>Acceso temporal experimental</strong><small>Disponible solo mientras se habilita el correo transaccional.</small></span></label>}
        {temporaryMode ? <section className="admin_temporary_password"><strong>Contraseña temporal</strong><p>Compártela fuera de la aplicación. No se mostrará ni podrá recuperarse después, y el empleado deberá reemplazarla al iniciar sesión.</p><label>Contraseña<input name="temporary_password" type="password" autoComplete="new-password" minLength="8" required /></label><label>Confirmar contraseña<input name="password_confirmation" type="password" autoComplete="new-password" minLength="8" required /></label></section> : <p>La cuenta se crea sin contraseña y recibirá un enlace de activación de un solo uso.</p>}
        <footer><button type="button" onClick={onCancel}>Cancelar</button><button className="admin_primary" type="submit" disabled={busy}>{busy ? "Creando…" : temporaryMode ? "Crear acceso temporal" : "Crear e invitar"}</button></footer>
    </form>;
}

function EmployeeDetail({ employee, employees, organization, sessions, onRefresh, onEditName, onAssignPosition, runAction, onPreviewOffboarding, offboarding, onExecuteOffboarding, busy }) {
    const [assigningPosition, setAssigningPosition] = useState(false);
    useEffect(() => setAssigningPosition(false), [employee.id]);
    const account = employee.account;
    const targets = employees.flatMap(item => item.id === employee.id ? [] : item.assignments.filter(row => row.is_active).map(row => ({ ...row, employee_name: item.full_name })));
    const vacantPositions = organization.positions.filter(item => !item.occupied && item.is_open);
    async function assignPosition(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const completed = await onAssignPosition({ position: form.get("position"), reason: form.get("reason") });
        if (completed) setAssigningPosition(false);
    }
    return <article className="admin_employee_detail">
        <header><div className="admin_person_avatar">{employee.full_name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</div><div><div className="admin_employee_name"><h2>{employee.full_name}</h2><button type="button" onClick={onEditName} disabled={busy} aria-label={`Editar nombre de ${employee.full_name}`} title="Editar nombre"><Pencil size={15} /></button></div><p>{account?.email || "Sin cuenta"}</p></div><span className={`admin_status ${account?.is_active ? "is_active" : ""}`}>{account?.is_active ? "Activa" : "Inactiva"}</span></header>
        <dl className="admin_detail_grid"><div><dt>MFA</dt><dd>{account?.mfa_enabled ? "Configurado" : "Sin configurar"}</dd></div><div><dt>Sesiones</dt><dd>{account?.active_sessions ?? 0}</dd></div><div><dt>Correo verificado</dt><dd>{account?.email_verified_at ? "Sí" : "Pendiente"}</dd></div><div><dt>Último acceso</dt><dd>{dateTime(account?.last_login)}</dd></div></dl>
        <section className="admin_employee_positions"><div className="admin_section_heading"><h3>Cargos</h3><button type="button" onClick={() => setAssigningPosition(current => !current)} disabled={!employee.is_active || !vacantPositions.length}>{assigningPosition ? "Cancelar" : "Asignar plaza"}</button></div>{employee.assignments.filter(row => row.is_active).map(row => <p key={row.id}>{row.role_title} · {row.unit_name}</p>)}{!employee.assignments.some(row => row.is_active) && <p>Sin cargo activo.</p>}{!vacantPositions.length && <small>No hay plazas abiertas y vacantes disponibles.</small>}
            {assigningPosition && <form className="admin_assignment_form" onSubmit={assignPosition}><label>Plaza vacante<AdminSelect name="position" label="Plaza vacante" required options={[{ value: "", label: "Seleccionar plaza" }, ...vacantPositions.map(item => ({ value: item.id, label: positionLabel(item) }))]} /></label><label>Motivo<textarea name="reason" minLength="8" maxLength="1000" required placeholder="Explica por qué se asigna esta plaza" /></label><button className="admin_primary" type="submit" disabled={busy}>{busy ? "Asignando…" : "Confirmar asignación"}</button></form>}
        </section>
        <section><h3>Seguridad de la cuenta</h3><div className="admin_action_grid">
            {!account?.has_usable_password && <button onClick={() => runAction("resend", "Reenviar invitación")}>Reenviar invitación</button>}
            <button onClick={() => runAction("sessions", "Cerrar todas las sesiones")}>Cerrar sesiones</button>
            <button onClick={() => runAction("password", "Enviar recuperación de contraseña")}>Recuperar contraseña</button>
            {!account?.is_superuser && <button onClick={() => runAction("set_password", "Establecer contraseña temporal")}>Cambiar contraseña</button>}
            <button onClick={() => runAction("mfa", "Restablecer MFA")}>Restablecer MFA</button>
            {account?.is_active ? <button className="is_danger" onClick={() => runAction("deactivate", "Desactivar cuenta")}>Desactivar cuenta</button> : <button onClick={() => runAction("reactivate", "Reactivar cuenta")}>Reactivar cuenta</button>}
        </div><p className="admin_security_note"><ShieldCheck size={16} /> Las acciones sensibles requieren MFA reciente del dueño y quedan auditadas.</p></section>
        {sessions?.length > 0 && <section><h3>Historial de sesiones</h3><div className="admin_session_list">{sessions.map(row => <p key={row.id}><span>{row.auth_strength} · {row.last_ip || "IP desconocida"}</span><time>{dateTime(row.last_used_at)}</time></p>)}</div></section>}
        <section className="admin_danger_zone"><h3>Baja y transferencia</h3><p>Previsualiza todas las responsabilidades antes de desactivar al empleado.</p><button type="button" onClick={onPreviewOffboarding}>Preparar baja</button>
            {offboarding && <form className="admin_offboarding" onSubmit={onExecuteOffboarding}><p><strong>{offboarding.modules.reduce((sum, module) => sum + module.resources.length, 0)}</strong> responsabilidades detectadas y <strong>{offboarding.active_sessions}</strong> sesiones activas.</p><label>Transferir por defecto a<AdminSelect name="default_target_assignment" label="Transferir por defecto a" required options={[{ value: "", label: "Seleccionar reemplazo" }, ...targets.map(row => ({ value: row.id, label: `${row.employee_name} · ${row.role_title} · ${row.unit_name}` }))]} /></label><label>Motivo<textarea name="reason" minLength="8" required /></label><button className="admin_danger_button" type="submit" disabled={busy}>Ejecutar baja y transferencia</button></form>}
        </section>
        <button className="admin_refresh_detail" type="button" onClick={onRefresh}><RefreshCw size={15} /> Actualizar ficha</button>
    </article>;
}

function Employees({ rows, organization, reload, refreshDirectory, setNotice, temporaryPasswordEnabled }) {
    const [selectedId, setSelectedId] = useState(rows[0]?.id || "");
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [offboarding, setOffboarding] = useState(null);
    const employee = rows.find(item => item.id === selectedId) || rows[0];
    const filtered = rows.filter(item => `${item.full_name} ${item.account?.email || ""}`.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => { if (employee) adminApi.sessions(employee.id).then(setSessions).catch(() => setSessions([])); }, [employee?.id]);
    async function create(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const temporaryPassword = form.get("temporary_password") || "";
        if (temporaryPassword && temporaryPassword !== form.get("password_confirmation")) {
            setNotice("Las contraseñas temporales no coinciden.", true);
            return;
        }
        if (temporaryPassword) {
            const code = await askText("Crear acceso temporal. Código MFA", "", 6);
            if (!code) return;
            setBusy(true);
            try { await coreApi.stepUpMfa(code); }
            catch (error) { setNotice(error.message, true); setBusy(false); return; }
        }
        setBusy(true);
        try {
            await adminApi.createEmployee({
                full_name: form.get("full_name"),
                email: form.get("email"),
                position: form.get("position") || null,
                ...(temporaryPassword ? { temporary_password: temporaryPassword } : {}),
            });
            setCreating(false);
            setNotice(temporaryPassword ? "Empleado creado. Deberá cambiar la contraseña temporal al iniciar sesión." : "Empleado creado; la invitación fue enviada.");
            await Promise.all([reload(), refreshDirectory()]);
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function runAction(kind, label) {
        if (!employee) return;
        if (kind === "resend") { try { await adminApi.resendInvitation(employee.id); setNotice("Invitación reenviada."); } catch (error) { setNotice(error.message, true); } return; }
        const code = await askText(`${label}. Código MFA`, "", 6);
        if (!code) return;
        setBusy(true);
        try { await coreApi.stepUpMfa(code); }
        catch (error) { setNotice(error.message, true); setBusy(false); return; }
        setBusy(false);
        const passwordReset = kind === "set_password" ? await askTemporaryPassword() : null;
        if (kind === "set_password" && !passwordReset) return;
        const reason = passwordReset?.reason || await askText(`${label}. Motivo`, "", 8);
        if (!reason) return;
        setBusy(true);
        try {
            if (kind === "sessions") await adminApi.revokeSessions(employee.id, reason);
            if (kind === "password") await adminApi.sendPasswordReset(employee.id, reason);
            if (kind === "set_password") await adminApi.setTemporaryPassword(employee.id, passwordReset);
            if (kind === "mfa") await adminApi.resetMfa(employee.id, reason);
            if (kind === "deactivate") await adminApi.deactivateAccount(employee.id, reason);
            if (kind === "reactivate") await adminApi.reactivateAccount(employee.id, reason);
            setNotice(`${label} completado.`); await reload();
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function assignPosition(body) {
        if (!employee) return false;
        const code = await askText("Asignar plaza. Código MFA", "", 6);
        if (!code) return false;
        setBusy(true);
        try {
            await coreApi.stepUpMfa(code);
            await adminApi.assignPosition(employee.id, body.position, body.reason);
            setNotice("Plaza asignada correctamente.");
            await Promise.all([reload(), refreshDirectory()]);
            return true;
        } catch (error) {
            setNotice(error.message, true);
            return false;
        } finally {
            setBusy(false);
        }
    }
    async function editName() {
        if (!employee) return;
        const fullName = await askText("Editar nombre del empleado", employee.full_name, 2);
        if (!fullName || fullName === employee.full_name) return;
        const reason = await askText("Motivo del cambio", "", 8);
        if (!reason) return;
        setBusy(true);
        try {
            await adminApi.updateEmployee(employee.id, { full_name: fullName, reason });
            setNotice("Nombre del empleado actualizado.");
            await Promise.all([reload(), refreshDirectory()]);
        } catch (error) {
            setNotice(error.message, true);
        } finally {
            setBusy(false);
        }
    }
    async function preview() { try { setOffboarding(await adminApi.offboardingPreview(employee.id)); } catch (error) { setNotice(error.message, true); } }
    async function executeOffboarding(event) {
        event.preventDefault();
        const confirmed = await adminDialog({
            title: "¿Confirmar baja del empleado?",
            text: "Se desactivará al empleado, se transferirán sus responsabilidades y se cerrarán sus sesiones.",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Confirmar baja",
        });
        if (!confirmed.isConfirmed) return;
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
            await adminApi.offboard(employee.id, {
                reason: form.get("reason"),
                default_target_assignment: form.get("default_target_assignment"),
                allow_unassigned: false,
            });
            setOffboarding(null);
            setNotice("Baja completada y responsabilidades transferidas.");
            await reload();
        } catch (error) {
            setNotice(error.message, true);
        } finally {
            setBusy(false);
        }
    }

    return <div className="admin_directory"><aside><div className="admin_directory_tools"><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empleado" /></label><button type="button" aria-label="Crear empleado" onClick={() => setCreating(true)}><UserPlus size={18} /></button></div><div className="admin_employee_list">{filtered.map(item => <button className={item.id === employee?.id ? "is_selected" : ""} type="button" key={item.id} onClick={() => { setSelectedId(item.id); setOffboarding(null); }}><span>{item.full_name}</span><small>{item.account?.email || "Sin cuenta"}</small></button>)}</div></aside><main>{creating ? <CreateEmployee positions={organization.positions} onCreate={create} onCancel={() => setCreating(false)} busy={busy} temporaryPasswordEnabled={temporaryPasswordEnabled} /> : employee ? <EmployeeDetail employee={employee} employees={rows} organization={organization} sessions={sessions} onRefresh={reload} onEditName={editName} onAssignPosition={assignPosition} runAction={runAction} onPreviewOffboarding={preview} offboarding={offboarding} onExecuteOffboarding={executeOffboarding} busy={busy} /> : <p>No hay empleados.</p>}</main></div>;
}

export function Audit({ page, onPage }) {
    const rows = page.results;
    const [query, setQuery] = useState("");
    const [module, setModule] = useState("");
    const filtered = rows.filter(row => (!module || row.module_code === module) && `${row.permission_name || ""} ${row.event_type} ${row.actor_email || ""} ${row.target_type || ""}`.toLowerCase().includes(query.toLowerCase()));
    const modules = { administration: "Administración", authentication: "Autenticación", permissions: "Permisos" };
    const outcomes = { success: "Correcto", failure: "Fallido", denied: "Denegado", error: "Error" };
    const eventNames = {
        "permission.checked": "Comprobación de permiso", "websocket.ticket_issued": "Conexión en tiempo real autorizada",
        "login.succeeded": "Inicio de sesión correcto", "login.password_failed": "Contraseña de inicio de sesión incorrecta",
        "login.mfa_failed": "Código MFA incorrecto", "login.mfa_challenge_rejected": "Verificación MFA rechazada",
        "password.changed": "Contraseña cambiada", "password.reset_requested": "Recuperación de contraseña solicitada",
        "password.reset_completed": "Contraseña restablecida", "mfa.step_up_succeeded": "Verificación MFA completada",
        "mfa.step_up_failed": "Verificación MFA fallida", "mfa.enrollment_started": "Configuración MFA iniciada",
        "mfa.enrolled": "MFA configurado", "mfa.disabled": "MFA desactivado", "mfa.recovery_code_used": "Código de recuperación utilizado",
        "administration.employee_created": "Empleado creado", "administration.employee_updated": "Datos del empleado actualizados", "administration.organizational_unit_created": "Unidad organizacional creada",
        "administration.organizational_unit_updated": "Unidad organizacional actualizada", "administration.organizational_unit_deleted": "Unidad organizacional eliminada",
        "administration.job_role_created": "Cargo creado", "administration.job_role_updated": "Cargo actualizado", "administration.job_role_deleted": "Cargo eliminado",
        "administration.position_created": "Plaza creada", "administration.position_updated": "Plaza actualizada",
        "administration.catalog_option_created": "Opción de catálogo creada", "administration.catalog_option_updated": "Opción de catálogo actualizada",
        "administration.catalog_option_deleted": "Opción de catálogo eliminada", "administration.session_revoked": "Sesión revocada",
        "administration.temporary_password_set": "Contraseña temporal establecida por el propietario",
        "password.admin_reset": "Contraseña restablecida por el propietario",
    };
    const eventName = row => row.permission_name || eventNames[row.event_type] || row.event_type.replaceAll(".", " · ").replaceAll("_", " ");
    return <section className="admin_panel admin_audit_panel">
        <header className="admin_audit_header">
            <div><span className="admin_eyebrow">TRAZABILIDAD</span><h2>Eventos del sistema</h2><p>{filtered.length} de {rows.length} eventos</p></div>
            <div className="admin_audit_filters">
                <label className="admin_search"><Search size={16} /><input aria-label="Buscar evento o actor" placeholder="Buscar evento o actor" value={query} onChange={event => setQuery(event.target.value)} /></label>
                <AdminSelect label="Filtrar por módulo" value={module} onValueChange={setModule} options={[{ value: "", label: "Todos los módulos" }, ...Object.entries(modules).map(([value, label]) => ({ value, label }))]} />
            </div>
        </header>
        <div className="admin_audit_table">
            <table>
                <thead><tr><th scope="col">Fecha</th><th scope="col">Evento</th><th scope="col">Actor</th><th scope="col">Resultado</th></tr></thead>
                <tbody>{filtered.map(row => <tr key={`${row.module_code}:${row.id}`}>
                    <td><time dateTime={row.occurred_at}>{dateTime(row.occurred_at)}</time></td>
                    <td><span className="admin_event_module">{modules[row.module_code] || row.module_code}</span><strong className="admin_event_name">{eventName(row)}</strong>
                        <details className="admin_event_details"><summary>Ver detalles</summary><dl>
                            <dt>Código del evento</dt><dd>{row.event_type}</dd>
                            {row.permission_name && <><dt>Permiso</dt><dd>{row.permission_name}</dd></>}
                            {row.target_type && <><dt>Tipo</dt><dd>{row.target_type}</dd></>}
                            {row.target_id && <><dt>Registro</dt><dd>{row.target_id}</dd></>}
                            {row.correlation_id && <><dt>Correlación</dt><dd>{row.correlation_id}</dd></>}
                        </dl></details>
                    </td>
                    <td>{row.actor_email || "Sistema"}{row.unit_name && <small className="admin_event_unit">{row.unit_name}</small>}</td>
                    <td><span className={`admin_outcome is_${row.outcome}`} title={row.outcome}>{outcomes[row.outcome] || row.outcome}</span></td>
                </tr>)}</tbody>
            </table>
        </div>
        {!filtered.length && <p className="admin_empty">No hay eventos que coincidan con la búsqueda.</p>}
        <footer className="admin_audit_pagination"><span>{page.count} eventos en total</span><div><button type="button" disabled={!page.previous} onClick={() => onPage(page.page - 1)}>Anterior</button><strong>Página {page.page}</strong><button type="button" disabled={!page.next} onClick={() => onPage(page.page + 1)}>Siguiente</button></div></footer>
    </section>;
}

function RoleEditor({ role, levels, onSave, onClose }) {
    const [submitting, setSubmitting] = useState(false);
    useDialog(!submitting, ".admin_role_editor", onClose);
    async function save(event) {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        setSubmitting(true);
        if (!await onSave(role, values)) setSubmitting(false);
    }
    return <div className="admin_modal_backdrop">
        <form className="admin_form admin_role_editor" role="dialog" aria-modal="true" aria-labelledby="role_editor_title" onSubmit={save}>
            <header><div><span className="admin_eyebrow">CATÁLOGO DE CARGOS</span><h2 id="role_editor_title">Editar cargo</h2></div></header>
            <label>Nombre<input name="title" defaultValue={role.title} required maxLength={120} /></label>
            <label>Nivel<AdminSelect name="level" label="Nivel del cargo" defaultValue={role.level || ""} options={[{ value: "", label: "Sin nivel" }, ...levels.map(level => ({ value: level, label: level }))]} /></label>
            <label>Descripción<textarea name="description" defaultValue={role.description || ""} /></label>
            <label>Motivo de la edición<textarea name="reason" minLength={8} maxLength={1000} required /></label>
            <footer><button type="button" disabled={submitting} onClick={onClose}>Cancelar</button><button className="admin_primary" type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar cambios"}</button></footer>
        </form>
    </div>;
}

function UnitEditor({ unit, units, unitTypes, sensitivities, onSave, onClose }) {
    const [submitting, setSubmitting] = useState(false);
    useDialog(!submitting, ".admin_unit_editor", onClose);
    const descendants = new Set();
    let frontier = [String(unit.id)];
    while (frontier.length) {
        const parent = frontier.pop();
        for (const candidate of units) {
            if (String(candidate.parent_unit || "") !== parent || descendants.has(String(candidate.id))) continue;
            descendants.add(String(candidate.id));
            frontier.push(String(candidate.id));
        }
    }
    const parentOptions = units.filter(candidate => String(candidate.id) !== String(unit.id) && !descendants.has(String(candidate.id)));
    async function save(event) {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        setSubmitting(true);
        if (!await onSave(unit, values)) setSubmitting(false);
    }
    return <div className="admin_modal_backdrop">
        <form className="admin_form admin_role_editor admin_unit_editor" role="dialog" aria-modal="true" aria-labelledby="unit_editor_title" onSubmit={save}>
            <header><div><span className="admin_eyebrow">ESTRUCTURA ORGANIZACIONAL</span><h2 id="unit_editor_title">Editar o mover unidad</h2></div></header>
            <label>Nombre<input name="name" defaultValue={unit.name} required maxLength={120} /></label>
            <label>Tipo<AdminSelect name="unit_type" label="Tipo de unidad" defaultValue={unit.unit_type} required options={unitTypes.map(row => ({ value: row.value, label: row.value }))} /></label>
            <label>Sensibilidad<AdminSelect name="sensitivity_level" label="Sensibilidad" defaultValue={unit.sensitivity_level} required options={sensitivities.map(row => ({ value: row.value, label: row.value }))} /></label>
            {unit.is_control_plane ? <><label>Unidad superior<input value="Raíz de la organización" disabled /></label><input type="hidden" name="parent_unit" value="" /></> : <label>Unidad superior<AdminSelect name="parent_unit" label="Unidad superior" defaultValue={unit.parent_unit || ""} options={[{ value: "", label: "Ninguna · mover a la raíz" }, ...parentOptions.map(row => ({ value: row.id, label: row.name }))]} /></label>}
            <p className="admin_editor_hint">Al cambiar la unidad superior se moverá esta rama completa, incluidas sus subunidades y plazas.</p>
            <label>Motivo de la edición<textarea name="reason" minLength={8} maxLength={1000} required /></label>
            <footer><button type="button" disabled={submitting} onClick={onClose}>Cancelar</button><button className="admin_primary" type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar cambios"}</button></footer>
        </form>
    </div>;
}

function ReportingPosition({ units, positions }) {
    const rootRef = useRef(null);
    const [unit, setUnit] = useState("");
    const [role, setRole] = useState("");
    const [position, setPosition] = useState("");

    useEffect(() => {
        const form = rootRef.current?.closest("form");
        const reset = () => {
            setUnit("");
            setRole("");
            setPosition("");
            if (rootRef.current) rootRef.current.open = false;
        };
        form?.addEventListener("reset", reset);
        return () => form?.removeEventListener("reset", reset);
    }, []);

    useEffect(() => {
        const closeOutside = event => {
            if (rootRef.current?.open && !rootRef.current.contains(event.target)) rootRef.current.open = false;
        };
        const closeEscape = event => {
            if (event.key === "Escape" && rootRef.current?.open) {
                rootRef.current.open = false;
                rootRef.current.querySelector("summary")?.focus();
            }
        };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("keydown", closeEscape);
        };
    }, []);

    const availableRoles = [...new Map(positions.filter(row => String(row.unit) === String(unit)).map(row => [String(row.job_role), { value: row.job_role, label: row.role_title }])).values()];
    const availablePositions = positions.filter(row => String(row.unit) === String(unit) && String(row.job_role) === String(role));
    const selected = positions.find(row => String(row.id) === String(position));
    return <details className="admin_reporting" ref={rootRef}>
        <summary className="admin_select_trigger" aria-label="Reportar a"><span>{selected ? positionLabel(selected) : "Sin jefatura"}</span><ChevronDown size={16} /></summary>
        <div className="admin_reporting_menu">
            <button type="button" className="admin_reporting_none" onClick={event => {
                setUnit(""); setRole(""); setPosition(""); event.currentTarget.closest("details").open = false;
            }}>Sin jefatura</button>
            <label>Departamento de jefatura<AdminSelect label="Departamento de jefatura" value={unit} onValueChange={value => { setUnit(value); setRole(""); setPosition(""); }} options={[{ value: "", label: "Seleccionar" }, ...units.map(row => ({ value: row.id, label: row.name }))]} /></label>
            {unit && <label>Cargo de jefatura<AdminSelect label="Cargo de jefatura" value={role} onValueChange={value => { setRole(value); setPosition(""); }} options={[{ value: "", label: "Seleccionar" }, ...availableRoles]} /></label>}
            {role && <label>Plaza de jefatura<AdminSelect label="Plaza de jefatura" value={position} onValueChange={value => setPosition(value)} options={[{ value: "", label: "Seleccionar" }, ...availablePositions.map(row => ({ value: row.id, label: positionLabel(row) }))]} /></label>}
            {selected && <button type="button" className="admin_reporting_done" onClick={event => { event.currentTarget.closest("details").open = false; }}>Listo</button>}
        </div>
        <input type="hidden" name="reports_to_position" value={position} />
    </details>;
}

export function OrganizationManager({ data: initialData }) {
    const setNotice = (message, isError = false) => adminDialog({ title: isError ? "No se pudo guardar" : "Cambio guardado", text: message, icon: isError ? "error" : "success" });
    const [editingRole, setEditingRole] = useState(null);
    const [editingUnit, setEditingUnit] = useState(null);
    const [data, setData] = useState(initialData);
    const [kind, setKind] = useState("unit");
    const [unitType, setUnitType] = useState("department");
    const [sensitivity, setSensitivity] = useState("normal");
    const [roleLevel, setRoleLevel] = useState("");
    const [deleteLevel, setDeleteLevel] = useState("");
    const [deleteConfirmation, setDeleteConfirmation] = useState("");
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const [roleActionsUnlocked, setRoleActionsUnlocked] = useState(false);
    const [showRoleMfa, setShowRoleMfa] = useState(false);
    const [deleteRoleTarget, setDeleteRoleTarget] = useState(null);
    const [roleDeleteConfirmation, setRoleDeleteConfirmation] = useState("");
    const [roleDeleteConfirmed, setRoleDeleteConfirmed] = useState(false);
    const [deleteUnitTarget, setDeleteUnitTarget] = useState(null);
    const [unitDeleteConfirmation, setUnitDeleteConfirmation] = useState("");
    const [unitDeleteConfirmed, setUnitDeleteConfirmed] = useState(false);
    const [deleteOptionTarget, setDeleteOptionTarget] = useState(null);
    const [optionDeleteConfirmation, setOptionDeleteConfirmation] = useState("");
    const [optionDeleteConfirmed, setOptionDeleteConfirmed] = useState(false);
    const [positionUnit, setPositionUnit] = useState("");
    const [busy, setBusy] = useState(false);
    const [section, setSection] = useState("structure");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [parentUnit, setParentUnit] = useState("");
    useDialog(drawerOpen, ".admin_organization_drawer", () => { if (!busy) setDrawerOpen(false); });
    const levels = [...new Set([...(data.role_levels || []).map(row => row.value), ...data.roles.map(row => row.level?.trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "es"));
    const levelOptions = roleLevel && !levels.includes(roleLevel) ? [roleLevel, ...levels] : levels;
    const nextOrder = Math.max(0, ...data.positions.filter(row => String(row.unit) === String(positionUnit)).map(row => Number(row.display_order) || 0)) + 1;
    async function submit(event) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        if (!await confirmOrganization("¿Crear registro?")) return;
        setBusy(true);
        try {
            const reason = form.get("reason");
            if (kind === "unit") await adminApi.createUnit({ name: form.get("name"), unit_type: form.get("unit_type"), sensitivity_level: form.get("sensitivity_level"), parent_unit: form.get("parent_unit") || null, reason });
            if (kind === "role") await adminApi.createRole({ title: form.get("title"), level: form.get("level") || null, description: form.get("description") || null, reason });
            if (kind === "position") await adminApi.createPosition({ unit: form.get("unit"), job_role: form.get("job_role"), reports_to_position: form.get("reports_to_position") || null, reason });
            formElement.reset();
            setUnitType("department"); setSensitivity("normal"); setRoleLevel(""); setPositionUnit("");
            setParentUnit(""); setDrawerOpen(false);
            setNotice("Registro organizacional creado y auditado.");
            setData(await adminApi.organization());
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function removeLevel() {
        if (!await confirmOrganization("¿Eliminar nivel?")) return;
        setBusy(true);
        try {
            await adminApi.deleteRoleLevel({ level: deleteLevel, confirmation: deleteConfirmation, confirmed: deleteConfirmed });
            setData(await adminApi.organization()); setRoleLevel(""); setDeleteLevel(""); setDeleteConfirmation(""); setDeleteConfirmed(false);
            setNotice("Nivel eliminado de los cargos asociados.");
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function editRole(role, values) {
        if (!await confirmOrganization("¿Actualizar cargo?")) return false;
        setBusy(true);
        try {
            await adminApi.updateRole(role.id, { title: values.title.trim(), level: values.level || null, description: values.description.trim() || null, reason: values.reason.trim() });
            setData(await adminApi.organization());
            setEditingRole(null);
            await setNotice("Cargo actualizado.");
            return true;
        } catch (error) { await setNotice(error.message, true); return false; }
        finally { setBusy(false); }
    }
    async function removeRole() {
        if (!await confirmOrganization("¿Eliminar cargo?")) return;
        const role = deleteRoleTarget;
        const reason = await askText("Motivo de la eliminación", "", 8); if (!reason) return;
        setBusy(true);
        try { await adminApi.deleteRole(role.id, reason); setData(await adminApi.organization()); setDeleteRoleTarget(null); setRoleDeleteConfirmation(""); setRoleDeleteConfirmed(false); setNotice("Cargo eliminado."); }
        catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function editUnit(unit, values) {
        if (!await confirmOrganization("¿Actualizar unidad?")) return;
        setBusy(true);
        try {
            await adminApi.updateUnit(unit.id, {
                name: values.name.trim(),
                unit_type: values.unit_type,
                sensitivity_level: values.sensitivity_level,
                parent_unit: values.parent_unit || null,
                reason: values.reason.trim(),
            });
            setData(await adminApi.organization());
            setEditingUnit(null);
            await setNotice("Unidad actualizada y ubicada correctamente.");
            return true;
        } catch (error) { await setNotice(error.message, true); return false; }
        finally { setBusy(false); }
    }
    async function removeUnit() {
        if (!await confirmOrganization("¿Eliminar unidad?")) return;
        const unit = deleteUnitTarget;
        const reason = await askText("Motivo de la eliminación", "", 8); if (!reason) return;
        setBusy(true);
        try { await adminApi.deleteUnit(unit.id, reason); setData(await adminApi.organization()); setDeleteUnitTarget(null); setUnitDeleteConfirmation(""); setUnitDeleteConfirmed(false); setNotice("Unidad eliminada."); }
        catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function unlockRoleActions(event) {
        event.preventDefault(); const code = new FormData(event.currentTarget).get("code"); setBusy(true);
        try { await coreApi.stepUpMfa(code); setRoleActionsUnlocked(true); setShowRoleMfa(false); setNotice("Edición de cargos desbloqueada por 10 minutos."); setTimeout(() => setRoleActionsUnlocked(false), 600000); }
        catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function manageOption(action, kindName, current, setCurrent) {
        const options = kindName === "unit_type" ? data.unit_types : data.sensitivity_levels;
        const option = options.find(row => row.value === current);
        if (action !== "add" && !option) return;
        if (action === "delete") { setDeleteOptionTarget({ option, setCurrent }); setOptionDeleteConfirmation(""); setOptionDeleteConfirmed(false); return; }
        const value = await askText(action === "add" ? "Nombre de la nueva opción" : "Nuevo nombre", action === "edit" ? current : "");
        if (!value || !await confirmOrganization("¿Actualizar catálogo?")) return;
        setBusy(true);
        try {
            if (action === "add") await adminApi.createOrganizationOption({ kind: kindName, value });
            if (action === "edit") await adminApi.updateOrganizationOption(option.id, { value });
            setData(await adminApi.organization()); setCurrent(value); setNotice("Catálogo actualizado.");
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function removeOption() {
        if (!await confirmOrganization("¿Eliminar opción?")) return;
        setBusy(true);
        try {
            await adminApi.deleteOrganizationOption(deleteOptionTarget.option.id); deleteOptionTarget.setCurrent(""); setData(await adminApi.organization());
            setDeleteOptionTarget(null); setOptionDeleteConfirmation(""); setOptionDeleteConfirmed(false); setNotice("Opción eliminada.");
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    const optionActions = (kindName, current, setter) => <div className="admin_select_actions"><button type="button" onClick={() => manageOption("add", kindName, current, setter)}>+ Agregar</button><button type="button" disabled={!current} onClick={() => manageOption("edit", kindName, current, setter)}>Editar</button><button type="button" disabled={!current} onClick={() => manageOption("delete", kindName, current, setter)}>Eliminar</button></div>;
    const levelActions = <div className="admin_select_actions"><button type="button" onClick={async () => {
        const result = await adminDialog({
            title: "Agregar nivel", input: "text", showCancelButton: true,
            inputValidator: value => !value.trim() ? "Ingresa un nombre." : levels.some(level => level.normalize("NFKC").toLocaleLowerCase("es") === value.trim().normalize("NFKC").toLocaleLowerCase("es")) ? "Ya existe un nivel con ese nombre." : undefined,
        });
        if (result.isConfirmed) {
            const level = result.value.trim();
            setBusy(true);
            try {
                await adminApi.createOrganizationOption({ kind: "role_level", value: level });
                setData(await adminApi.organization());
                setRoleLevel(level);
                setNotice("Nivel agregado al catálogo.");
            } catch (error) { setNotice(error.message, true); }
            finally { setBusy(false); }
        }
    }}>+ Agregar nivel</button><button type="button" disabled={!roleLevel} onClick={() => { setDeleteLevel(roleLevel); setDeleteConfirmation(""); setDeleteConfirmed(false); }}>Eliminar nivel</button></div>;
    const openCreate = (type, context = "") => { setKind(type); setRoleLevel(""); setPositionUnit(type === "position" ? context : ""); setParentUnit(type === "unit" ? context : ""); setDrawerOpen(true); };
    return <><div className="admin_organization_workspace"><header className="admin_organization_toolbar"><div><span className="admin_eyebrow">GESTIÓN ORGANIZACIONAL</span><h2>Estructura y catálogos</h2><p>Organiza unidades, cargos y plazas desde una sola vista.</p></div><div className="admin_organization_create"><button type="button" onClick={() => openCreate("unit")}><Plus size={16} /> Nueva unidad</button><button type="button" onClick={() => openCreate("role")}><Plus size={16} /> Nuevo cargo</button><button className="admin_primary" type="button" onClick={() => openCreate("position")}><Plus size={16} /> Nueva plaza</button></div></header><nav className="admin_organization_tabs" aria-label="Secciones de organización"><button className={section === "structure" ? "is_active" : ""} type="button" onClick={() => setSection("structure")}>Estructura</button><button className={section === "catalogs" ? "is_active" : ""} type="button" onClick={() => setSection("catalogs")}>Catálogos</button><button className="admin_unlock_editing" type="button" onClick={() => setShowRoleMfa(true)}><ShieldCheck size={16} /> {roleActionsUnlocked ? "Edición desbloqueada" : "Desbloquear edición"}</button></nav>{section === "structure" ? <OrganizationStructure data={data} actionsUnlocked={roleActionsUnlocked} onUnlock={() => setShowRoleMfa(true)} onCreate={openCreate} onEditUnit={setEditingUnit} onDeleteUnit={unit => { setDeleteUnitTarget(unit); setUnitDeleteConfirmation(""); setUnitDeleteConfirmed(false); }} setData={setData} setNotice={setNotice} /> : <OrganizationCatalog data={data} actionsUnlocked={roleActionsUnlocked} onUnlock={() => setShowRoleMfa(true)} onCreate={openCreate} onEditRole={setEditingRole} onDeleteRole={role => { setDeleteRoleTarget(role); setRoleDeleteConfirmation(""); setRoleDeleteConfirmed(false); }} onManageOption={manageOption} />}</div>{drawerOpen && <div className="admin_organization_drawer_backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDrawerOpen(false); }}><form className="admin_form admin_catalog_form admin_organization_drawer" role="dialog" aria-modal="true" aria-labelledby="organization_drawer_title" onSubmit={submit}><header><div><span className="admin_eyebrow">NUEVO REGISTRO</span><h2 id="organization_drawer_title">{kind === "unit" ? "Nueva unidad" : kind === "role" ? "Nuevo cargo" : "Nueva plaza"}</h2></div><button type="button" aria-label="Cerrar" onClick={() => setDrawerOpen(false)}>×</button></header>
        {kind === "unit" && <><label>Nombre<input name="name" required /></label><label>Tipo<AdminSelect name="unit_type" label="Tipo" value={unitType} required onValueChange={setUnitType} options={data.unit_types.map(row => ({ value: row.value, label: row.value }))} /></label><label>Sensibilidad<AdminSelect name="sensitivity_level" label="Sensibilidad" value={sensitivity} required onValueChange={setSensitivity} options={data.sensitivity_levels.map(row => ({ value: row.value, label: row.value }))} /></label><label>Unidad superior<AdminSelect name="parent_unit" label="Unidad superior" value={parentUnit} onValueChange={setParentUnit} options={[{ value: "", label: "Ninguna" }, ...data.units.map(row => ({ value: row.id, label: row.name }))]} /></label></>}
        {kind === "role" && <><label>Título<input name="title" required /></label><label>Nivel<AdminSelect name="level" label="Nivel" value={roleLevel} onValueChange={setRoleLevel} options={[{ value: "", label: "Sin nivel" }, ...levelOptions.map(level => ({ value: level, label: level }))]} menuFooter={levelActions} /></label><label>Descripción<textarea name="description" /></label></>}
        {kind === "position" && <>
            <label>Unidad<AdminSelect
                name="unit"
                label="Unidad"
                value={positionUnit}
                required
                onValueChange={setPositionUnit}
                options={[{ value: "", label: "Seleccionar" }, ...data.units.map(row => ({ value: row.id, label: row.name }))]}
            /></label>
            <label>Cargo<AdminSelect
                name="job_role"
                label="Cargo"
                required
                options={[{ value: "", label: "Seleccionar" }, ...data.roles.map(row => ({ value: row.id, label: row.title }))]}
            /></label>
            <div className="admin_reporting_field">
                <span>Reportar a</span>
                <ReportingPosition units={data.units} positions={data.positions} />
            </div>
            <label>Orden<input type="number" value={positionUnit ? nextOrder : ""} readOnly /></label>
        </>}
        <label>Motivo<textarea name="reason" minLength="8" required /></label>
        <footer>
            <span>Los cambios quedan registrados en auditoría.</span>
            <button className="admin_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Crear registro"}</button>
        </footer>
    </form></div>}{editingUnit && <UnitEditor unit={editingUnit} units={data.units} unitTypes={data.unit_types} sensitivities={data.sensitivity_levels} onSave={editUnit} onClose={() => setEditingUnit(null)} />}{editingRole && <RoleEditor role={editingRole} levels={levels} onSave={editRole} onClose={() => setEditingRole(null)} />}{showRoleMfa && <div className="admin_modal_backdrop"><form className="admin_delete_level" role="dialog" aria-modal="true" onSubmit={unlockRoleActions}><h3>Verificación MFA</h3><p>Ingresa el código de tu aplicación autenticadora.</p><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required autoFocus /><footer><button type="button" onClick={() => setShowRoleMfa(false)} disabled={busy}>Cancelar</button><button className="admin_primary" disabled={busy} type="submit">Verificar</button></footer></form></div>}{deleteUnitTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar unidad</h3><p>Solo pueden eliminarse unidades vacías. Reubica antes sus subunidades y plazas.</p><p>Para continuar, escribe <strong>{deleteUnitTarget.name}</strong>:</p><input value={unitDeleteConfirmation} onChange={event => setUnitDeleteConfirmation(event.target.value)} placeholder={deleteUnitTarget.name} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={unitDeleteConfirmed} onChange={event => setUnitDeleteConfirmed(event.target.checked)} /> Confirmo que deseo eliminar esta unidad vacía.</label><footer><button type="button" onClick={() => setDeleteUnitTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || unitDeleteConfirmation !== deleteUnitTarget.name || !unitDeleteConfirmed} onClick={removeUnit}>Eliminar unidad</button></footer></section></div>}{deleteRoleTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar cargo</h3><p>Para eliminar, escribe el cargo seleccionado:</p><input value={roleDeleteConfirmation} onChange={event => setRoleDeleteConfirmation(event.target.value)} placeholder={deleteRoleTarget.title} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={roleDeleteConfirmed} onChange={event => setRoleDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteRoleTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || roleDeleteConfirmation !== deleteRoleTarget.title || !roleDeleteConfirmed} onClick={removeRole}>Eliminar cargo</button></footer></section></div>}{deleteOptionTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar opción</h3><p>Para eliminar, escribe la opción seleccionada:</p><input value={optionDeleteConfirmation} onChange={event => setOptionDeleteConfirmation(event.target.value)} placeholder={deleteOptionTarget.option.value} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={optionDeleteConfirmed} onChange={event => setOptionDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteOptionTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || optionDeleteConfirmation !== deleteOptionTarget.option.value || !optionDeleteConfirmed} onClick={removeOption}>Eliminar opción</button></footer></section></div>}{deleteLevel && <div className="admin_modal_backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDeleteLevel(""); }}><section className="admin_delete_level" role="dialog" aria-modal="true" aria-labelledby="delete_level_title"><h3 id="delete_level_title">Eliminar nivel</h3><p>Para eliminar, escribe el nivel seleccionado:</p><input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder={deleteLevel} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteLevel("")} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || deleteConfirmation !== deleteLevel || !deleteConfirmed} onClick={removeLevel}>Eliminar nivel</button></footer></section></div>}</>;
}

function OrganizationStructure({ data, actionsUnlocked, onUnlock, onCreate, onEditUnit, onDeleteUnit, setData, setNotice }) {
    const roots = data.units.filter(unit => !unit.parent_unit || !data.units.some(row => String(row.id) === String(unit.parent_unit)));
    const [expanded, setExpanded] = useState(() => new Set(roots.map(unit => String(unit.id))));
    const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [sensitivity, setSensitivityFilter] = useState("");
    const normalized = query.trim().toLocaleLowerCase("es");
    const positionsFor = unit => data.positions.filter(position => String(position.unit) === String(unit.id) && (status === "all" || status === "occupied" && position.occupied || status === "vacant" && !position.occupied));
    const childrenFor = unit => data.units.filter(child => String(child.parent_unit) === String(unit.id));
    const matches = unit => (!sensitivity || unit.sensitivity_level === sensitivity) && (!normalized || unit.name.toLocaleLowerCase("es").includes(normalized) || positionsFor(unit).some(position => `${position.role_title} ${position.occupant_name || "vacante"}`.toLocaleLowerCase("es").includes(normalized)) || childrenFor(unit).some(matches));
    const togglePosition = async position => {
        if (position.is_protected) return setNotice("La plaza del propietario está protegida y no admite modificaciones.", true);
        if (!actionsUnlocked) return onUnlock();
        const reason = await askText(`Motivo para ${position.is_open ? "cerrar" : "abrir"} la plaza`, "", 8); if (!reason) return;
        try { await adminApi.updatePosition(position.id, { is_open: !position.is_open, reason }); setData(await adminApi.organization()); setNotice("Disponibilidad de la plaza actualizada."); } catch (error) { setNotice(error.message, true); }
    };
    function UnitNode({ unit, depth = 0 }) {
        if (!matches(unit)) return null;
        const children = childrenFor(unit), positions = positionsFor(unit), open = expanded.has(String(unit.id)) || Boolean(normalized);
        return <div className="admin_org_branch" style={{ "--tree-depth": depth }}><article className="admin_org_unit"><button className="admin_org_expand" type="button" aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); open ? next.delete(String(unit.id)) : next.add(String(unit.id)); return next; })}><ChevronDown size={17} /></button><Building2 size={19} /><div><strong>{unit.name}</strong><span>{unit.unit_type} · sensibilidad {unit.sensitivity_level}</span></div><span className="admin_org_count">{unit.is_control_plane ? "Estructural" : `${positions.length} plazas`}</span><WidgetMenu>{close => <><button type="button" onClick={() => { onCreate("unit", unit.id); close(); }}>Agregar subunidad</button><button type="button" onClick={() => { onCreate("position", unit.id); close(); }}>Agregar plaza</button><button type="button" onClick={() => { actionsUnlocked ? onEditUnit(unit) : onUnlock(); close(); }}>{unit.is_control_plane ? "Editar unidad" : "Editar o mover"}</button>{!unit.is_control_plane && <button className="is_danger" type="button" onClick={() => { actionsUnlocked ? onDeleteUnit(unit) : onUnlock(); close(); }}>Eliminar unidad</button>}</>}</WidgetMenu></article>{open && <div className="admin_org_children">{positions.map(position => { const manager = data.positions.find(row => String(row.id) === String(position.reports_to_position)); return <article className={`admin_org_position ${position.is_protected ? "is_protected" : ""}`} key={position.id}><span className={`admin_position_state ${position.occupied ? "is_occupied" : ""}`} /><div><strong>{position.role_title}</strong><span>{position.occupant_name || "Plaza vacante"}{manager ? ` · reporta a ${manager.role_title}` : ""}</span></div><span className={`admin_status ${position.is_protected || position.is_open ? "is_active" : ""}`}>{position.is_protected ? "Protegida" : position.is_open ? "Abierta" : "Cerrada"}</span>{!position.is_protected && <WidgetMenu>{close => <><button type="button" onClick={() => { togglePosition(position); close(); }}>{position.is_open ? "Cerrar plaza" : "Abrir plaza"}</button></>}</WidgetMenu>}</article>; })}{children.map(child => <UnitNode unit={child} depth={depth + 1} key={child.id} />)}</div>}</div>;
    }
    return <section className="admin_org_structure"><div className="admin_org_filters"><label><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar unidad, cargo o empleado" /></label><AdminSelect label="Estado" value={status} onValueChange={setStatus} options={[{ value: "all", label: "Todas las plazas" }, { value: "occupied", label: "Ocupadas" }, { value: "vacant", label: "Vacantes" }]} /><AdminSelect label="Sensibilidad" value={sensitivity} onValueChange={setSensitivityFilter} options={[{ value: "", label: "Toda sensibilidad" }, ...data.sensitivity_levels.map(row => ({ value: row.value, label: row.value }))]} /></div><div className="admin_org_tree">{roots.map(unit => <UnitNode unit={unit} key={unit.id} />)}{!roots.some(matches) && <p className="admin_empty">No se encontraron resultados.</p>}</div></section>;
}

function OrganizationCatalog({ data, actionsUnlocked, onUnlock, onCreate, onEditRole, onDeleteRole, onManageOption }) {
    const [query, setQuery] = useState(""); const filtered = data.roles.filter(role => `${role.title} ${role.level || ""}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
    const optionPanel = (title, kind, options) => <section className="admin_catalog_card"><header><div><span className="admin_eyebrow">CATÁLOGO</span><h3>{title}</h3></div><button type="button" onClick={() => onManageOption("add", kind, "", () => {})}><Plus size={16} /> Agregar</button></header><div className="admin_catalog_chips">{options.map(option => <span key={option.id}>{option.value}{actionsUnlocked && <button type="button" aria-label={`Editar ${option.value}`} onClick={() => onManageOption("edit", kind, option.value, () => {})}><Pencil size={13} /></button>}</span>)}</div></section>;
    return <div className="admin_catalog_workspace"><section className="admin_catalog_roles"><header><div><span className="admin_eyebrow">CARGOS</span><h2>Catálogo de cargos</h2></div><button className="admin_primary" type="button" onClick={() => onCreate("role")}><Plus size={16} /> Nuevo cargo</button></header><label className="admin_catalog_search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cargo o nivel" /></label><div>{filtered.map(role => <article key={role.id}><div><strong>{role.title}</strong><span>{role.level || "Sin nivel"}</span><small>{role.description || "Sin descripción"}</small></div><WidgetMenu>{close => <><button type="button" onClick={() => { actionsUnlocked ? onEditRole(role) : onUnlock(); close(); }}>Editar</button><button className="is_danger" type="button" onClick={() => { actionsUnlocked ? onDeleteRole(role) : onUnlock(); close(); }}>Eliminar</button></>}</WidgetMenu></article>)}</div></section><div className="admin_catalog_side">{optionPanel("Tipos de unidad", "unit_type", data.unit_types)}{optionPanel("Sensibilidades", "sensitivity", data.sensitivity_levels)}<section className="admin_catalog_card"><header><div><span className="admin_eyebrow">CATÁLOGO</span><h3>Niveles de cargo</h3></div></header><div className="admin_catalog_chips">{data.role_levels.map(option => <span key={option.id}>{option.value}</span>)}</div></section></div></div>;
}

function Organization({ data }) {
    return <OrganizationManager data={data} />;
}

export default function AdministrationModule() {
    const core = useCore();
    const [active, setActive] = useState("dashboard");
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [notice, setNoticeState] = useState(null);
    const [auditLoading, setAuditLoading] = useState(false);
    const setNotice = (message, isError = false) => { setNoticeState({ message, isError }); setTimeout(() => setNoticeState(null), 6000); };
    async function load() { setError(""); try { const [dashboard, employees, organization] = await Promise.all([adminApi.dashboard(), adminApi.employees(), adminApi.organization()]); setData({ dashboard, employees, audit: null, organization }); } catch (loadError) { setError(loadError.message); } }
    async function loadAudit(page = 1) { setAuditLoading(true); try { const audit = await adminApi.auditEvents(page); setData(current => ({ ...current, audit: { ...audit, page } })); } catch (loadError) { setNotice(loadError.message, true); } finally { setAuditLoading(false); } }
    useEffect(() => { load(); }, []);
    useEffect(() => { if (active === "audit" && data && !data.audit && !auditLoading) loadAudit(); }, [active, data?.audit]);
    useEffect(() => {
        const navigate = event => {
            if (event.detail?.module !== "administration") return;
            if (tabs.some(([id]) => id === event.detail.view)) setActive(event.detail.view);
        };
        globalThis.addEventListener("bold:global-search:navigate", navigate);
        return () => globalThis.removeEventListener("bold:global-search:navigate", navigate);
    }, []);
    const title = useMemo(() => tabs.find(([id]) => id === active)?.[1] || "Administración", [active]);
    if (!core.activeUnit?.is_control_plane) return <div className="admin_state"><p>El módulo Administrativo está reservado a la unidad de Dirección.</p></div>;
    if (!core.account?.is_superuser) return <div className="admin_state"><p>El módulo Administrativo está reservado al dueño de la empresa.</p></div>;
    if (!data) return <Loading error={error} onRetry={load} />;
    return <section className="administration_module"><header className="admin_module_header"><div><h1>{title}</h1><p>Vista global, cuentas, seguridad y trazabilidad organizacional.</p></div><nav>{tabs.map(([id, label, Icon]) => <button className={active === id ? "is_active" : ""} type="button" key={id} onClick={() => setActive(id)}><Icon size={16} />{label}</button>)}</nav></header>{notice && <p className={`admin_notice ${notice.isError ? "is_error" : ""}`} role={notice.isError ? "alert" : "status"}>{notice.message}</p>}{active === "dashboard" && <Dashboard data={data.dashboard} setNotice={setNotice} />}{active === "employees" && <Employees rows={data.employees} organization={data.organization} reload={load} refreshDirectory={core.refreshDirectory} setNotice={setNotice} temporaryPasswordEnabled={Boolean(data.dashboard.features?.temporary_password_provisioning)} />}{active === "audit" && (data.audit ? <Audit page={data.audit} onPage={loadAudit} /> : <div className="admin_state"><p>Cargando los eventos más recientes…</p></div>)}{active === "organization" && <Organization data={data.organization} />}{active === "connectors" && <Connectors />}</section>;
}
