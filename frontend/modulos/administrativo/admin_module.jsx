import { useEffect, useMemo, useState } from "react";
import { Activity, Building2, LayoutDashboard, RefreshCw, Search, ShieldCheck, UserPlus, Users } from "lucide-react";

import { useCore } from "../core/core_provider.jsx";
import { adminApi } from "./admin_api.js";

const tabs = [
    ["dashboard", "Resumen", LayoutDashboard],
    ["employees", "Empleados", Users],
    ["audit", "Auditoría", Activity],
    ["organization", "Organización", Building2],
];

const metricLabel = value => value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const dateTime = value => value ? new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala" }).format(new Date(value)) : "—";

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
            <div className="admin_module_grid">{data.modules.map(module => <article className="admin_module_card" key={module.code}><h3>{module.title}</h3><div>{Object.entries(module.metrics).map(([key, value]) => <p key={key}><span>{metricLabel(key)}</span><strong>{value}</strong></p>)}</div>{module.by_unit?.length > 0 && <small>{module.by_unit.length} departamentos con actividad</small>}</article>)}</div>
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
        <label>Plaza inicial<select name="position"><option value="">Sin plaza por ahora</option>{positions.filter(item => !item.occupied && item.is_open).map(item => <option value={item.id} key={item.id}>{item.role_title} · {item.unit_name}</option>)}</select></label>
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
            {offboarding && <form className="admin_offboarding" onSubmit={onExecuteOffboarding}><p><strong>{offboarding.modules.reduce((sum, module) => sum + module.resources.length, 0)}</strong> responsabilidades detectadas y <strong>{offboarding.active_sessions}</strong> sesiones activas.</p><label>Transferir por defecto a<select name="default_target_assignment" required><option value="">Seleccionar reemplazo</option>{targets.map(row => <option value={row.id} key={row.id}>{row.employee_name} · {row.role_title} · {row.unit_name}</option>)}</select></label><label>Motivo<textarea name="reason" minLength="8" required /></label><button className="admin_danger_button" type="submit" disabled={busy}>Ejecutar baja y transferencia</button></form>}
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
    return <section className="admin_panel"><header className="admin_audit_header"><div><span className="admin_eyebrow">TRAZABILIDAD</span><h2>Auditoría del sistema</h2></div><div><input placeholder="Buscar evento o actor" value={query} onChange={event => setQuery(event.target.value)} /><select value={module} onChange={event => setModule(event.target.value)}><option value="">Todos los módulos</option><option value="administration">Administrativo</option><option value="authentication">Autenticación</option><option value="permissions">Permisos</option></select></div></header><div className="admin_audit_table"><div className="admin_audit_row is_header"><span>Fecha</span><span>Módulo</span><span>Evento</span><span>Actor</span><span>Resultado</span></div>{filtered.map(row => <div className="admin_audit_row" key={`${row.module_code}:${row.id}`}><time>{dateTime(row.occurred_at)}</time><span>{row.module_code}</span><strong>{row.event_type}</strong><span>{row.actor_email || "Sistema"}</span><span className={`admin_outcome is_${row.outcome}`}>{row.outcome}</span></div>)}</div></section>;
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
    return <><form className="admin_form admin_catalog_form" onSubmit={submit}><header><div><span className="admin_eyebrow">GESTIÓN ORGANIZACIONAL</span><h2>Agregar al catálogo</h2></div><select value={kind} onChange={event => setKind(event.target.value)}><option value="unit">Unidad o departamento</option><option value="role">Cargo</option><option value="position">Plaza</option></select></header>
        {kind === "unit" && <><label>Nombre<input name="name" required /></label><label>Tipo<input name="unit_type" placeholder="department" required /></label><label>Sensibilidad<select name="sensitivity_level"><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Unidad superior<select name="parent_unit"><option value="">Ninguna</option>{data.units.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></>}
        {kind === "role" && <><label>Título<input name="title" required /></label><label>Nivel<input name="level" /></label><label>Descripción<textarea name="description" /></label></>}
        {kind === "position" && <><label>Unidad<select name="unit" required><option value="">Seleccionar</option>{data.units.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Cargo<select name="job_role" required><option value="">Seleccionar</option>{data.roles.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label>Reporta a<select name="reports_to_position"><option value="">Ninguna plaza</option>{data.positions.map(row => <option key={row.id} value={row.id}>{row.role_title} · {row.unit_name}</option>)}</select></label><label>Orden<input name="display_order" type="number" defaultValue="0" /></label></>}
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
