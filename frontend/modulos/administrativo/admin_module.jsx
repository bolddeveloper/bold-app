import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, Check, ChevronDown, LayoutDashboard, RefreshCw, Search, ShieldCheck, UserPlus, Users } from "lucide-react";

import { useCore } from "../core/core_provider.jsx";
import { adminApi } from "./admin_api.js";

const tabs = [
    ["dashboard", "Resumen", LayoutDashboard],
    ["employees", "Empleados", Users],
    ["audit", "Auditoría", Activity],
    ["organization", "Organización", Building2],
];

const metricLabels = {
    tasks_total: "Tareas totales",
    tasks_completed: "Completadas",
    tasks_overdue: "Vencidas",
    projects_active: "Proyectos activos",
};
const metricLabel = value => metricLabels[value] || value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const dateTime = value => value ? new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala" }).format(new Date(value)) : "—";

function AdminSelect({ defaultValue = "", label, name, onValueChange, options, required = false, value }) {
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue);
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const currentValue = controlled ? value : internalValue;
    const selected = options.find(option => String(option.value) === String(currentValue)) || options[0];

    useEffect(() => {
        if (!open) return undefined;
        const closeOutside = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
        const closeEscape = event => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeEscape);
        return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
    }, [open]);

    useEffect(() => {
        if (controlled) return undefined;
        const form = rootRef.current?.closest("form");
        const reset = () => { setInternalValue(defaultValue); setOpen(false); };
        form?.addEventListener("reset", reset);
        return () => form?.removeEventListener("reset", reset);
    }, [controlled, defaultValue]);

    function select(nextValue) {
        if (!controlled) setInternalValue(nextValue);
        onValueChange?.(nextValue);
        setOpen(false);
        triggerRef.current?.focus();
    }

    function moveSelection(direction) {
        const currentIndex = Math.max(0, options.findIndex(option => String(option.value) === String(currentValue)));
        select(options[(currentIndex + direction + options.length) % options.length].value);
    }

    return <div className={`admin_select ${open ? "is_open" : ""}`} ref={rootRef}>
        {name && <select className="admin_select_native" name={name} value={currentValue} required={required} tabIndex={-1} aria-hidden="true" onChange={() => {}} onInvalid={event => { event.preventDefault(); triggerRef.current?.focus(); }}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
        <button ref={triggerRef} className="admin_select_trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open ? moveSelection(event.key === "ArrowDown" ? 1 : -1) : setOpen(true); }
        }}>
            <span>{selected?.label || "Seleccionar"}</span><ChevronDown size={16} />
        </button>
        {open && <div className="admin_select_menu" role="listbox" aria-label={label}>
            {options.map(option => <button className={String(option.value) === String(currentValue) ? "is_selected" : ""} type="button" role="option" aria-selected={String(option.value) === String(currentValue)} key={option.value} onClick={() => select(option.value)}><span>{option.label}</span>{String(option.value) === String(currentValue) && <Check size={15} />}</button>)}
        </div>}
    </div>;
}

function Loading({ error, onRetry }) {
    return <div className="admin_state"><p>{error || "Cargando información administrativa…"}</p>{error && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
}

function Dashboard({ data }) {
    const baseMetrics = [
        ["Empleados activos", data.organization.employees_active],
        ["Cuentas activas", data.organization.accounts_active],
        ["Sesiones activas", data.security.active_sessions],
        ["Cuentas con MFA", data.security.mfa_enabled_accounts],
    ];
    return <div className="admin_dashboard">
        <section className="admin_metric_grid">{baseMetrics.map(([label, value]) => <article className="admin_metric_card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
        <section className="admin_panel"><header><div><span className="admin_eyebrow">PANORAMA MODULAR</span><h2>Actividad de la aplicación</h2></div></header>
            <div className="admin_module_grid">{data.modules.map(module => <article className="admin_module_card" data-module={module.code} key={module.code}><h3>{module.title}</h3><div>{Object.entries(module.metrics).map(([key, value]) => <p data-metric={key} key={key}><span>{metricLabel(key)}</span><strong>{value}</strong></p>)}</div>{module.by_unit?.length > 0 && <small>{module.by_unit.length} departamentos con actividad</small>}</article>)}</div>
        </section>
        <section className="admin_panel"><header><div><span className="admin_eyebrow">ÚLTIMOS EVENTOS</span><h2>Actividad reciente</h2></div></header>
            <div className="admin_activity_list">{data.recent_activity.length ? data.recent_activity.map(item => <article key={`${item.module_code}:${item.id}`}><span className="admin_event_module">{item.module_code}</span><div><strong>{item.label || item.event_type}</strong><p>{item.actor || "Sistema"} · {item.unit || "General"}</p></div><time>{dateTime(item.occurred_at)}</time></article>) : <p>Sin actividad reciente registrada.</p>}</div>
        </section>
    </div>;
}

function CreateEmployee({ positions, onCreate, onCancel, busy }) {
    return <form className="admin_form" onSubmit={onCreate}>
        <h3>Crear empleado y enviar invitación</h3>
        <label>Nombre completo<input name="full_name" required maxLength="140" /></label>
        <label>Correo corporativo<input name="email" type="email" placeholder="nombre@bold.gt" required /></label>
        <label>Plaza inicial<AdminSelect name="position" label="Plaza inicial" options={[{ value: "", label: "Sin plaza por ahora" }, ...positions.filter(item => !item.occupied && item.is_open).map(item => ({ value: item.id, label: `${item.role_title} · ${item.unit_name}` }))]} /></label>
        <p>La cuenta se crea sin contraseña y recibirá un enlace de activación de un solo uso.</p>
        <footer><button type="button" onClick={onCancel}>Cancelar</button><button className="admin_primary" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear e invitar"}</button></footer>
    </form>;
}

function EmployeeDetail({ employee, employees, organization, sessions, onRefresh, runAction, onPreviewOffboarding, offboarding, onExecuteOffboarding, busy }) {
    const account = employee.account;
    const targets = employees.flatMap(item => item.id === employee.id ? [] : item.assignments.filter(row => row.is_active).map(row => ({ ...row, employee_name: item.full_name })));
    return <article className="admin_employee_detail">
        <header><div className="admin_person_avatar">{employee.full_name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</div><div><h2>{employee.full_name}</h2><p>{account?.email || "Sin cuenta"}</p></div><span className={`admin_status ${account?.is_active ? "is_active" : ""}`}>{account?.is_active ? "Activa" : "Inactiva"}</span></header>
        <dl className="admin_detail_grid"><div><dt>MFA</dt><dd>{account?.mfa_enabled ? "Configurado" : "Sin configurar"}</dd></div><div><dt>Sesiones</dt><dd>{account?.active_sessions ?? 0}</dd></div><div><dt>Correo verificado</dt><dd>{account?.email_verified_at ? "Sí" : "Pendiente"}</dd></div><div><dt>Último acceso</dt><dd>{dateTime(account?.last_login)}</dd></div></dl>
        <section><h3>Cargos</h3>{employee.assignments.filter(row => row.is_active).map(row => <p key={row.id}>{row.role_title} · {row.unit_name}</p>)}{!employee.assignments.some(row => row.is_active) && <p>Sin cargo activo.</p>}</section>
        <section><h3>Seguridad de la cuenta</h3><div className="admin_action_grid">
            {!account?.has_usable_password && <button onClick={() => runAction("resend", "Reenviar invitación")}>Reenviar invitación</button>}
            <button onClick={() => runAction("sessions", "Cerrar todas las sesiones")}>Cerrar sesiones</button>
            <button onClick={() => runAction("password", "Enviar recuperación de contraseña")}>Recuperar contraseña</button>
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

function Employees({ rows, organization, reload, setNotice }) {
    const [selectedId, setSelectedId] = useState(rows[0]?.id || "");
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [offboarding, setOffboarding] = useState(null);
    const employee = rows.find(item => item.id === selectedId) || rows[0];
    const filtered = rows.filter(item => `${item.full_name} ${item.account?.email || ""}`.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => { if (employee) adminApi.sessions(employee.id).then(setSessions).catch(() => setSessions([])); }, [employee?.id]);
    async function create(event) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await adminApi.createEmployee({ full_name: form.get("full_name"), email: form.get("email"), position: form.get("position") || null }); setCreating(false); setNotice("Empleado creado; la invitación fue enviada."); await reload(); } catch (error) { setNotice(error.message, true); } finally { setBusy(false); } }
    async function runAction(kind, label) {
        if (!employee) return;
        if (kind === "resend") { try { await adminApi.resendInvitation(employee.id); setNotice("Invitación reenviada."); } catch (error) { setNotice(error.message, true); } return; }
        const reason = globalThis.prompt?.(`${label}. Escribe el motivo (mínimo 8 caracteres):`)?.trim();
        if (!reason) return;
        setBusy(true);
        try {
            if (kind === "sessions") await adminApi.revokeSessions(employee.id, reason);
            if (kind === "password") await adminApi.sendPasswordReset(employee.id, reason);
            if (kind === "mfa") await adminApi.resetMfa(employee.id, reason);
            if (kind === "deactivate") await adminApi.deactivateAccount(employee.id, reason);
            if (kind === "reactivate") await adminApi.reactivateAccount(employee.id, reason);
            setNotice(`${label} completado.`); await reload();
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    async function preview() { try { setOffboarding(await adminApi.offboardingPreview(employee.id)); } catch (error) { setNotice(error.message, true); } }
    async function executeOffboarding(event) { event.preventDefault(); if (!globalThis.confirm?.("Esta operación desactivará al empleado, transferirá responsabilidades y cerrará sus sesiones. ¿Continuar?")) return; const form = new FormData(event.currentTarget); setBusy(true); try { await adminApi.offboard(employee.id, { reason: form.get("reason"), default_target_assignment: form.get("default_target_assignment"), allow_unassigned: false }); setOffboarding(null); setNotice("Baja completada y responsabilidades transferidas."); await reload(); } catch (error) { setNotice(error.message, true); } finally { setBusy(false); } }

    return <div className="admin_directory"><aside><div className="admin_directory_tools"><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empleado" /></label><button type="button" aria-label="Crear empleado" onClick={() => setCreating(true)}><UserPlus size={18} /></button></div><div className="admin_employee_list">{filtered.map(item => <button className={item.id === employee?.id ? "is_selected" : ""} type="button" key={item.id} onClick={() => { setSelectedId(item.id); setOffboarding(null); }}><span>{item.full_name}</span><small>{item.account?.email || "Sin cuenta"}</small></button>)}</div></aside><main>{creating ? <CreateEmployee positions={organization.positions} onCreate={create} onCancel={() => setCreating(false)} busy={busy} /> : employee ? <EmployeeDetail employee={employee} employees={rows} organization={organization} sessions={sessions} onRefresh={reload} runAction={runAction} onPreviewOffboarding={preview} offboarding={offboarding} onExecuteOffboarding={executeOffboarding} busy={busy} /> : <p>No hay empleados.</p>}</main></div>;
}

function Audit({ rows }) {
    const [query, setQuery] = useState("");
    const [module, setModule] = useState("");
    const filtered = rows.filter(row => (!module || row.module_code === module) && `${row.event_type} ${row.actor_email || ""} ${row.target_type || ""}`.toLowerCase().includes(query.toLowerCase()));
    return <section className="admin_panel"><header className="admin_audit_header"><div><span className="admin_eyebrow">TRAZABILIDAD</span><h2>Auditoría del sistema</h2></div><div><input placeholder="Buscar evento o actor" value={query} onChange={event => setQuery(event.target.value)} /><AdminSelect label="Filtrar por módulo" value={module} onValueChange={setModule} options={[{ value: "", label: "Todos los módulos" }, { value: "administration", label: "Administrativo" }, { value: "authentication", label: "Autenticación" }, { value: "permissions", label: "Permisos" }]} /></div></header><div className="admin_audit_table"><div className="admin_audit_row is_header"><span>Fecha</span><span>Módulo</span><span>Evento</span><span>Actor</span><span>Resultado</span></div>{filtered.map(row => <div className="admin_audit_row" key={`${row.module_code}:${row.id}`}><time>{dateTime(row.occurred_at)}</time><span>{row.module_code}</span><strong>{row.event_type}</strong><span>{row.actor_email || "Sistema"}</span><span className={`admin_outcome is_${row.outcome}`}>{row.outcome}</span></div>)}</div></section>;
}

function OrganizationManager({ data: initialData, setNotice = message => globalThis.alert?.(message) }) {
    const [data, setData] = useState(initialData);
    const [kind, setKind] = useState("unit");
    const [busy, setBusy] = useState(false);
    async function submit(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
            const reason = form.get("reason");
            if (kind === "unit") await adminApi.createUnit({ name: form.get("name"), unit_type: form.get("unit_type"), sensitivity_level: form.get("sensitivity_level"), parent_unit: form.get("parent_unit") || null, reason });
            if (kind === "role") await adminApi.createRole({ title: form.get("title"), level: form.get("level") || null, description: form.get("description") || null, reason });
            if (kind === "position") await adminApi.createPosition({ unit: form.get("unit"), job_role: form.get("job_role"), reports_to_position: form.get("reports_to_position") || null, display_order: Number(form.get("display_order") || 0), reason });
            event.currentTarget.reset();
            setNotice("Registro organizacional creado y auditado.");
            setData(await adminApi.organization());
        } catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
    }
    return <><form className="admin_form admin_catalog_form" onSubmit={submit}><header><div><span className="admin_eyebrow">GESTIÓN ORGANIZACIONAL</span><h2>Agregar al catálogo</h2></div><AdminSelect label="Tipo de registro" value={kind} onValueChange={setKind} options={[{ value: "unit", label: "Unidad o departamento" }, { value: "role", label: "Cargo" }, { value: "position", label: "Plaza" }]} /></header>
        {kind === "unit" && <><label>Nombre<input name="name" required /></label><label>Tipo<input name="unit_type" placeholder="department" required /></label><label>Sensibilidad<AdminSelect name="sensitivity_level" label="Sensibilidad" defaultValue="normal" options={[{ value: "normal", label: "Normal" }, { value: "high", label: "Alta" }, { value: "critical", label: "Crítica" }]} /></label><label>Unidad superior<AdminSelect name="parent_unit" label="Unidad superior" options={[{ value: "", label: "Ninguna" }, ...data.units.map(row => ({ value: row.id, label: row.name }))]} /></label></>}
        {kind === "role" && <><label>Título<input name="title" required /></label><label>Nivel<input name="level" /></label><label>Descripción<textarea name="description" /></label></>}
        {kind === "position" && <><label>Unidad<AdminSelect name="unit" label="Unidad" required options={[{ value: "", label: "Seleccionar" }, ...data.units.map(row => ({ value: row.id, label: row.name }))]} /></label><label>Cargo<AdminSelect name="job_role" label="Cargo" required options={[{ value: "", label: "Seleccionar" }, ...data.roles.map(row => ({ value: row.id, label: row.title }))]} /></label><label>Reporta a<AdminSelect name="reports_to_position" label="Reporta a" options={[{ value: "", label: "Ninguna plaza" }, ...data.positions.map(row => ({ value: row.id, label: `${row.role_title} · ${row.unit_name}` }))]} /></label><label>Orden<input name="display_order" type="number" defaultValue="0" /></label></>}
        <label>Motivo<textarea name="reason" minLength="8" required /></label><footer><span>Los catálogos conservan su historial; no hay borrado físico.</span><button className="admin_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Crear registro"}</button></footer>
    </form><OrganizationCatalog data={data} /></>;
}

function OrganizationCatalog({ data }) {
    return <div className="admin_organization"><section className="admin_panel"><header><div><span className="admin_eyebrow">ESTRUCTURA</span><h2>Departamentos y unidades</h2></div></header>{data.units.map(unit => <article key={unit.id}><div><strong>{unit.name}</strong><span>{unit.unit_type}</span></div><small>{unit.positions} plazas · sensibilidad {unit.sensitivity_level}</small></article>)}</section><section className="admin_panel"><header><div><span className="admin_eyebrow">CATÁLOGO</span><h2>Cargos</h2></div></header>{data.roles.map(role => <article key={role.id}><div><strong>{role.title}</strong><span>{role.level || "Sin nivel"}</span></div><small>{role.description || "Sin descripción"}</small></article>)}</section></div>;
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
    const setNotice = (message, isError = false) => { setNoticeState({ message, isError }); setTimeout(() => setNoticeState(null), 6000); };
    async function load() { setError(""); try { const [dashboard, employees, audit, organization] = await Promise.all([adminApi.dashboard(), adminApi.employees(), adminApi.auditEvents(), adminApi.organization()]); setData({ dashboard, employees, audit, organization }); } catch (loadError) { setError(loadError.message); } }
    useEffect(() => { load(); }, []);
    const title = useMemo(() => tabs.find(([id]) => id === active)?.[1] || "Administración", [active]);
    if (!core.account?.is_superuser) return <div className="admin_state"><p>El módulo Administrativo está reservado al dueño de la empresa.</p></div>;
    if (!data) return <Loading error={error} onRetry={load} />;
    return <section className="administration_module"><header className="admin_module_header"><div><span className="admin_eyebrow">GOBIERNO DE LA APLICACIÓN</span><h1>{title}</h1><p>Vista global, cuentas, seguridad y trazabilidad organizacional.</p></div><nav>{tabs.map(([id, label, Icon]) => <button className={active === id ? "is_active" : ""} type="button" key={id} onClick={() => setActive(id)}><Icon size={16} />{label}</button>)}</nav></header>{notice && <p className={`admin_notice ${notice.isError ? "is_error" : ""}`} role={notice.isError ? "alert" : "status"}>{notice.message}</p>}{active === "dashboard" && <Dashboard data={data.dashboard} />}{active === "employees" && <Employees rows={data.employees} organization={data.organization} reload={load} setNotice={setNotice} />}{active === "audit" && <Audit rows={data.audit} />}{active === "organization" && <Organization data={data.organization} />}</section>;
}
