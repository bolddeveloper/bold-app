import { BoldSelect as AdminSelect } from "../core/shared/bold_select.jsx";
import Swal from "sweetalert2";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, ChevronDown, LayoutDashboard, Pencil, RefreshCw, Search, ShieldCheck, UserPlus, Users } from "lucide-react";

import { useCore } from "../core/core_provider.jsx";
import { coreApi } from "../core/core_api.js";
import { adminApi } from "./admin_api.js";
import { useDialog } from "../core/shared/use_dialog.js";

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
async function confirmOrganization(title) {
    return (await adminDialog({ title, text: "El cambio quedará registrado en el historial.", icon: "question", showCancelButton: true })).isConfirmed;
}

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
const positionLabel = row => `${row.role_title} · ${row.unit_name} · ${row.occupant_name || `Vacante ${row.display_order} (${String(row.id).slice(0, 4)})`}`;


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
        <label>Plaza inicial<AdminSelect name="position" label="Plaza inicial" options={[{ value: "", label: "Sin plaza por ahora" }, ...positions.filter(item => !item.occupied && item.is_open).map(item => ({ value: item.id, label: positionLabel(item) }))]} /></label>
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

function Employees({ rows, organization, reload, refreshDirectory, setNotice }) {
    const [selectedId, setSelectedId] = useState(rows[0]?.id || "");
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [offboarding, setOffboarding] = useState(null);
    const employee = rows.find(item => item.id === selectedId) || rows[0];
    const filtered = rows.filter(item => `${item.full_name} ${item.account?.email || ""}`.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => { if (employee) adminApi.sessions(employee.id).then(setSessions).catch(() => setSessions([])); }, [employee?.id]);
    async function create(event) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await adminApi.createEmployee({ full_name: form.get("full_name"), email: form.get("email"), position: form.get("position") || null }); setCreating(false); setNotice("Empleado creado; la invitación fue enviada."); await Promise.all([reload(), refreshDirectory()]); } catch (error) { setNotice(error.message, true); } finally { setBusy(false); } }
    async function runAction(kind, label) {
        if (!employee) return;
        if (kind === "resend") { try { await adminApi.resendInvitation(employee.id); setNotice("Invitación reenviada."); } catch (error) { setNotice(error.message, true); } return; }
        const code = await askText(`${label}. Código MFA`, "", 6);
        if (!code) return;
        setBusy(true);
        try { await coreApi.stepUpMfa(code); }
        catch (error) { setNotice(error.message, true); setBusy(false); return; }
        setBusy(false);
        const reason = await askText(`${label}. Motivo`, "", 8);
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

    return <div className="admin_directory"><aside><div className="admin_directory_tools"><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empleado" /></label><button type="button" aria-label="Crear empleado" onClick={() => setCreating(true)}><UserPlus size={18} /></button></div><div className="admin_employee_list">{filtered.map(item => <button className={item.id === employee?.id ? "is_selected" : ""} type="button" key={item.id} onClick={() => { setSelectedId(item.id); setOffboarding(null); }}><span>{item.full_name}</span><small>{item.account?.email || "Sin cuenta"}</small></button>)}</div></aside><main>{creating ? <CreateEmployee positions={organization.positions} onCreate={create} onCancel={() => setCreating(false)} busy={busy} /> : employee ? <EmployeeDetail employee={employee} employees={rows} organization={organization} sessions={sessions} onRefresh={reload} runAction={runAction} onPreviewOffboarding={preview} offboarding={offboarding} onExecuteOffboarding={executeOffboarding} busy={busy} /> : <p>No hay empleados.</p>}</main></div>;
}

export function Audit({ rows }) {
    const [query, setQuery] = useState("");
    const [module, setModule] = useState("");
    const filtered = rows.filter(row => (!module || row.module_code === module) && `${row.event_type} ${row.actor_email || ""} ${row.target_type || ""}`.toLowerCase().includes(query.toLowerCase()));
    const modules = { administration: "Administración", authentication: "Autenticación", permissions: "Permisos" };
    const outcomes = { success: "Correcto", failure: "Fallido", denied: "Denegado", error: "Error" };
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
                    <td><span className="admin_event_module">{modules[row.module_code] || row.module_code}</span><strong className="admin_event_name">{row.event_type}</strong>
                        {(row.target_type || row.target_id || row.correlation_id) && <details className="admin_event_details"><summary>Ver referencia</summary><dl>
                            {row.target_type && <><dt>Tipo</dt><dd>{row.target_type}</dd></>}
                            {row.target_id && <><dt>Registro</dt><dd>{row.target_id}</dd></>}
                            {row.correlation_id && <><dt>Correlación</dt><dd>{row.correlation_id}</dd></>}
                        </dl></details>}
                    </td>
                    <td>{row.actor_email || "Sistema"}{row.unit_name && <small className="admin_event_unit">{row.unit_name}</small>}</td>
                    <td><span className={`admin_outcome is_${row.outcome}`} title={row.outcome}>{outcomes[row.outcome] || row.outcome}</span></td>
                </tr>)}</tbody>
            </table>
        </div>
        {!filtered.length && <p className="admin_empty">No hay eventos que coincidan con la búsqueda.</p>}
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
    async function editUnit(unit) {
        const name = await askText("Nombre de la unidad", unit.name); if (!name) return;
        const reason = await askText("Motivo de la edición", "", 8); if (!reason) return;
        if (!await confirmOrganization("¿Actualizar unidad?")) return;
        setBusy(true);
        try { await adminApi.updateUnit(unit.id, { name, reason }); setData(await adminApi.organization()); setNotice("Unidad actualizada."); }
        catch (error) { setNotice(error.message, true); } finally { setBusy(false); }
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
    return <><form className="admin_form admin_catalog_form" onSubmit={submit}><header><div><span className="admin_eyebrow">GESTIÓN ORGANIZACIONAL</span><h2>Agregar al catálogo</h2></div><AdminSelect label="Tipo de registro" value={kind} onValueChange={value => { setKind(value); setRoleLevel(""); setPositionUnit(""); }} options={[{ value: "unit", label: "Unidad o departamento" }, { value: "role", label: "Cargo" }, { value: "position", label: "Plaza" }]} /></header>
        {kind === "unit" && <><label>Nombre<input name="name" required /></label><label>Tipo<AdminSelect name="unit_type" label="Tipo" value={unitType} required onValueChange={setUnitType} options={data.unit_types.map(row => ({ value: row.value, label: row.value }))} menuFooter={optionActions("unit_type", unitType, setUnitType)} /></label><label>Sensibilidad<AdminSelect name="sensitivity_level" label="Sensibilidad" value={sensitivity} required onValueChange={setSensitivity} options={data.sensitivity_levels.map(row => ({ value: row.value, label: row.value }))} menuFooter={optionActions("sensitivity", sensitivity, setSensitivity)} /></label><label>Unidad superior<AdminSelect name="parent_unit" label="Unidad superior" options={[{ value: "", label: "Ninguna" }, ...data.units.map(row => ({ value: row.id, label: row.name }))]} /></label></>}
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
    </form>{editingRole && <RoleEditor role={editingRole} levels={levels} onSave={editRole} onClose={() => setEditingRole(null)} />}<OrganizationCatalog data={data} actionsUnlocked={roleActionsUnlocked} onUnlock={() => setShowRoleMfa(true)} onEditRole={setEditingRole} onDeleteRole={role => { setDeleteRoleTarget(role); setRoleDeleteConfirmation(""); setRoleDeleteConfirmed(false); }} onEditUnit={editUnit} onDeleteUnit={unit => { setDeleteUnitTarget(unit); setUnitDeleteConfirmation(""); setUnitDeleteConfirmed(false); }} />{showRoleMfa && <div className="admin_modal_backdrop"><form className="admin_delete_level" role="dialog" aria-modal="true" onSubmit={unlockRoleActions}><h3>Verificación MFA</h3><p>Ingresa el código de tu aplicación autenticadora.</p><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required autoFocus /><footer><button type="button" onClick={() => setShowRoleMfa(false)} disabled={busy}>Cancelar</button><button className="admin_primary" disabled={busy} type="submit">Verificar</button></footer></form></div>}{deleteUnitTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar unidad</h3><p>Para eliminar, escribe la unidad seleccionada:</p><input value={unitDeleteConfirmation} onChange={event => setUnitDeleteConfirmation(event.target.value)} placeholder={deleteUnitTarget.name} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={unitDeleteConfirmed} onChange={event => setUnitDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteUnitTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || unitDeleteConfirmation !== deleteUnitTarget.name || !unitDeleteConfirmed} onClick={removeUnit}>Eliminar unidad</button></footer></section></div>}{deleteRoleTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar cargo</h3><p>Para eliminar, escribe el cargo seleccionado:</p><input value={roleDeleteConfirmation} onChange={event => setRoleDeleteConfirmation(event.target.value)} placeholder={deleteRoleTarget.title} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={roleDeleteConfirmed} onChange={event => setRoleDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteRoleTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || roleDeleteConfirmation !== deleteRoleTarget.title || !roleDeleteConfirmed} onClick={removeRole}>Eliminar cargo</button></footer></section></div>}{deleteOptionTarget && <div className="admin_modal_backdrop"><section className="admin_delete_level" role="dialog" aria-modal="true"><h3>Eliminar opción</h3><p>Para eliminar, escribe la opción seleccionada:</p><input value={optionDeleteConfirmation} onChange={event => setOptionDeleteConfirmation(event.target.value)} placeholder={deleteOptionTarget.option.value} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={optionDeleteConfirmed} onChange={event => setOptionDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteOptionTarget(null)} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || optionDeleteConfirmation !== deleteOptionTarget.option.value || !optionDeleteConfirmed} onClick={removeOption}>Eliminar opción</button></footer></section></div>}{deleteLevel && <div className="admin_modal_backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDeleteLevel(""); }}><section className="admin_delete_level" role="dialog" aria-modal="true" aria-labelledby="delete_level_title"><h3 id="delete_level_title">Eliminar nivel</h3><p>Para eliminar, escribe el nivel seleccionado:</p><input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder={deleteLevel} autoFocus /><label className="admin_confirm_check"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} /> ¿Estás seguro de la eliminación?</label><footer><button type="button" onClick={() => setDeleteLevel("")} disabled={busy}>Cancelar</button><button type="button" className="admin_danger_button" disabled={busy || deleteConfirmation !== deleteLevel || !deleteConfirmed} onClick={removeLevel}>Eliminar nivel</button></footer></section></div>}</>;
}

function OrganizationCatalog({ data, actionsUnlocked, onUnlock, onEditRole, onDeleteRole, onEditUnit, onDeleteUnit }) {
    return <div className="admin_organization"><section className="admin_panel"><header><div><span className="admin_eyebrow">ESTRUCTURA</span><h2>Departamentos y unidades</h2></div><button className="admin_unlock_roles" type="button" aria-label="Desbloquear edición de unidades" onClick={onUnlock}><Pencil size={17} /></button></header>{data.units.map(unit => <article key={unit.id}><div><strong>{unit.name}</strong><span>{unit.unit_type}</span></div><small>{unit.positions} plazas · sensibilidad {unit.sensitivity_level}</small>{actionsUnlocked && <div className="admin_catalog_actions"><button type="button" onClick={() => onEditUnit(unit)}>Editar</button><button type="button" onClick={() => onDeleteUnit(unit)}>Eliminar</button></div>}</article>)}</section><section className="admin_panel"><header><div><span className="admin_eyebrow">CATÁLOGO</span><h2>Cargos</h2></div><button className="admin_unlock_roles" type="button" aria-label="Desbloquear edición de cargos" onClick={onUnlock}><Pencil size={17} /></button></header>{data.roles.map(role => <article key={role.id}><div><strong>{role.title}</strong><span>{role.level || "Sin nivel"}</span></div><small>{role.description || "Sin descripción"}</small>{actionsUnlocked && <div className="admin_catalog_actions"><button type="button" onClick={() => onEditRole(role)}>Editar</button><button type="button" onClick={() => onDeleteRole(role)}>Eliminar</button></div>}</article>)}</section></div>;
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
    return <section className="administration_module"><header className="admin_module_header"><div><span className="admin_eyebrow">GOBIERNO DE LA APLICACIÓN</span><h1>{title}</h1><p>Vista global, cuentas, seguridad y trazabilidad organizacional.</p></div><nav>{tabs.map(([id, label, Icon]) => <button className={active === id ? "is_active" : ""} type="button" key={id} onClick={() => setActive(id)}><Icon size={16} />{label}</button>)}</nav></header>{notice && <p className={`admin_notice ${notice.isError ? "is_error" : ""}`} role={notice.isError ? "alert" : "status"}>{notice.message}</p>}{active === "dashboard" && <Dashboard data={data.dashboard} />}{active === "employees" && <Employees rows={data.employees} organization={data.organization} reload={load} refreshDirectory={core.refreshDirectory} setNotice={setNotice} />}{active === "audit" && <Audit rows={data.audit} />}{active === "organization" && <Organization data={data.organization} />}</section>;
}
