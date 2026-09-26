import { BoldSelect } from "../core/shared/bold_select.jsx";
import { CalendarDateField } from "../tareas/src/task_app.jsx";
import { Children, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, KeyRound, RefreshCw, ShieldCheck, X } from "lucide-react";
import Swal from "sweetalert2";

import { coreApi } from "../core/core_api.js";
import { useCore } from "../core/core_provider.jsx";
import { is_using_real_backend } from "../core/http_client.js";
import { permissionsApi } from "./permissions_api.js";
import { fetchConsistentPermissionSnapshot } from "./permissions_state.js";
import "./permissions.css";


function PermissionSelect({ children, onChange, ...props }) {
    const options = Children.toArray(children).map(child => ({ value: child.props.value, label: child.props.children }));
    return <BoldSelect {...props} options={options} onValueChange={value => onChange?.({ target: { value } })} />;
}

const permissionDialog = options => Swal.fire({
    confirmButtonColor: "#ef1f2d",
    cancelButtonText: "Cancelar",
    customClass: { popup: "permissions_swal" },
    showCancelButton: true,
    ...options,
});

async function askRevocationReason() {
    const result = await permissionDialog({
        title: "Motivo de la revocación",
        input: "text",
        inputValidator: value => value.trim().length < 8 ? "Escribe al menos 8 caracteres." : undefined,
        confirmButtonText: "Revocar",
    });
    return result.isConfirmed ? result.value.trim() : null;
}

const scopeLabels = {
    global: "Global",
    own_unit: "Unidad propia",
    sub_tree: "Unidad y subárbol",
    specific_unit: "Unidad específica",
};
const riskLabels = { low: "Bajo", medium: "Medio", high: "Alto", critical: "Crítico" };

function isoFromLocal(value) {
    return value ? new Date(value).toISOString() : null;
}

function defaultExpiry(hours = 24, ceiling = null) {
    const ceilingTime = ceiling ? new Date(ceiling).getTime() : Number.POSITIVE_INFINITY;
    const date = new Date(Math.min(Date.now() + hours * 60 * 60 * 1000, ceilingTime));
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

function maximumGrantHours(permission) {
    if (permission?.risk_level === "critical") return 8;
    if (permission?.risk_level === "high") return 24;
    return 24 * 7;
}

function accessRuleState(row) {
    if (row.status === "revoked") return "Revocada";
    if (row.valid_from && new Date(row.valid_from) > new Date()) return "Programada";
    if (row.valid_until && new Date(row.valid_until) <= new Date()) return "Expirada";
    return row.effective ? "Vigente" : "Inactiva";
}

function authorityState(row) {
    if (!row.is_active || row.revoked_at) return "Revocada";
    if (row.valid_until && new Date(row.valid_until) <= new Date()) return "Expirada";
    return row.effective ? "Vigente" : "Cadena inactiva";
}

function Empty({ children }) {
    return <p className="permissions_empty">{children}</p>;
}

function StepUp({ onVerified }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function submit(event) {
        event.preventDefault();
        const formElement = event.currentTarget;
        setBusy(true); setError("");
        try {
            await coreApi.stepUpMfa(new FormData(formElement).get("code"));
            formElement.reset();
            await onVerified();
        } catch (failure) {
            setError(failure.message);
        } finally {
            setBusy(false);
        }
    }
    return <form className="permissions_step_up" onSubmit={submit}>
        <div><strong>Confirmación MFA requerida</strong><span>Ingresa un código TOTP reciente antes de modificar accesos.</span></div>
        <label className="permissions_visually_hidden" htmlFor="permissions_step_up_code">Código TOTP</label>
        <input id="permissions_step_up_code" name="code" inputMode="numeric" autoComplete="one-time-code" minLength="6" maxLength="8" placeholder="Código TOTP" required />
        <button type="submit" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
        {error ? <p role="alert">{error}</p> : null}
    </form>;
}

function MyAccess({ rows, unitName, units, unitId, onUnitChange }) {
    const allowed = rows.filter(row => row.allowed);
    const denied = rows.filter(row => !row.allowed);
    return <section className="permissions_panel">
        <header><div><h2>Mis accesos efectivos</h2><p>Decisiones actuales para {unitName || "la unidad seleccionada"}.</p></div>{units.length > 1 ? <label className="permissions_unit_picker">Unidad<PermissionSelect value={unitId} onChange={event => onUnitChange(event.target.value)}>{units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</PermissionSelect></label> : null}</header>
        <div className="permissions_summary"><strong>{allowed.length}</strong><span>permitidos</span><strong>{denied.length}</strong><span>denegados</span></div>
        {rows.length ? <div className="permissions_cards">
            {rows.map(row => <article className={`permission_card ${row.allowed ? "permission_allowed" : "permission_denied"}`} key={row.code}>
                <span>{row.allowed ? <Check size={16} /> : <X size={16} />}</span>
                <div><strong>{row.code}</strong><small>{row.reason}</small></div>
                <em>{riskLabels[row.risk_level] || row.risk_level}</em>
            </article>)}
        </div> : <Empty>No hay permisos activos registrados para esta unidad.</Empty>}
    </section>;
}

function RolePolicies({ data, catalog, units, revision, onChanged, canMutate }) {
    const roles = data.roles.filter(item => item.level?.toLowerCase() !== "owner");
    const [role, setRole] = useState(roles[0]?.id || "");
    const [permission, setPermission] = useState(catalog[0]?.id || "");
    const [scope, setScope] = useState("own_unit");
    const [effect, setEffect] = useState("allow");
    const [unit, setUnit] = useState("");
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const needsUnit = ["specific_unit", "sub_tree"].includes(scope);
    const selectedRules = data.rules.filter(row => row.job_role === role && row.permission === permission);
    async function submit(event) {
        event.preventDefault(); setBusy(true); setError("");
        try {
            const targetUnit = needsUnit ? unit : null;
            const preservedRules = selectedRules
                .filter(row => !(row.scope_type === scope && (row.target_unit || null) === targetUnit))
                .map(row => ({
                    effect: row.effect,
                    scope_type: row.scope_type,
                    ...(row.target_unit ? { target_unit: row.target_unit } : {}),
                }));
            const result = await permissionsApi.replaceRolePolicy({
                job_role: role,
                permission,
                rules: [...preservedRules, { effect, scope_type: scope, ...(needsUnit ? { target_unit: unit } : {}) }],
                reason,
                expected_revision: revision,
            });
            setReason(""); await onChanged(result.revision);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    }
    async function remove() {
        if (!role || !permission || reason.trim().length < 8) { setError("Escribe un motivo de al menos 8 caracteres."); return; }
        if (!(await permissionDialog({
            title: "¿Quitar todas las reglas?",
            text: "Se quitarán las reglas de este permiso para el cargo seleccionado.",
            icon: "warning",
            confirmButtonText: "Quitar reglas",
        })).isConfirmed) return;
        setBusy(true); setError("");
        try {
            const result = await permissionsApi.replaceRolePolicy({ job_role: role, permission, rules: [], reason, expected_revision: revision });
            setReason(""); await onChanged(result.revision);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    }
    return <section className="permissions_panel">
        <header><div><h2>Políticas por cargo</h2><p>Cada guardado reemplaza atómicamente las reglas del permiso seleccionado.</p></div></header>
        {canMutate ? <form className="permissions_form" onSubmit={submit}>
            <label>Cargo<PermissionSelect value={role} onChange={event => setRole(event.target.value)} required>{roles.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</PermissionSelect></label>
            <label>Permiso<PermissionSelect value={permission} onChange={event => setPermission(event.target.value)} required>{catalog.map(item => <option value={item.id} key={item.id}>{item.code}</option>)}</PermissionSelect></label>
            <label>Efecto<PermissionSelect value={effect} onChange={event => setEffect(event.target.value)}><option value="allow">Permitir</option><option value="deny">Denegar</option></PermissionSelect></label>
            <label>Alcance<PermissionSelect value={scope} onChange={event => setScope(event.target.value)}>{Object.entries(scopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</PermissionSelect></label>
            {needsUnit ? <label>Unidad<PermissionSelect value={unit} onChange={event => setUnit(event.target.value)} required><option value="">Seleccionar…</option>{units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</PermissionSelect></label> : null}
            <label className="permissions_reason">Motivo<textarea value={reason} onChange={event => setReason(event.target.value)} minLength="8" required /></label>
            <div className="permissions_form_actions"><button type="submit" disabled={busy}>Guardar regla</button><button type="button" className="permissions_danger" onClick={remove} disabled={busy}>Quitar todas</button></div>
        </form> : <p className="permissions_read_only">Confirma tu MFA para modificar estas políticas.</p>}
        {error ? <p className="permissions_error" role="alert">{error}</p> : null}
        <div className="permissions_rule_list">{selectedRules.length ? selectedRules.map(row => <span key={row.id}>{row.effect === "allow" ? "Permitir" : "Denegar"} · {scopeLabels[row.scope_type]}{row.target_unit_name ? ` · ${row.target_unit_name}` : ""}</span>) : <Empty>Este cargo no tiene una regla configurada para el permiso.</Empty>}</div>
    </section>;
}

function AccessRules({ rows, catalog, directory, units, revision, onChanged, canGrant, canRevoke, activeAssignmentId, actorEmail, isOwner }) {
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [permissionIds, setPermissionIds] = useState([]);
    const delegableCatalog = catalog.filter(item => item.is_delegable);
    const selectedPermissions = permissionIds.map(id => catalog.find(item => item.id === id)).filter(Boolean);
    const maximumHours = selectedPermissions.length ? Math.min(...selectedPermissions.map(maximumGrantHours)) : 24;
    function addPermission(permissionId) {
        if (permissionId) setPermissionIds(current => current.includes(permissionId) ? current : [...current, permissionId]);
    }
    async function submit(event) {
        event.preventDefault();
        if (!permissionIds.length) { setError("Selecciona al menos un permiso."); return; }
        setBusy(true); setError("");
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const createdIds = [];
        let currentRevision = revision;
        try {
            for (const permissionId of permissionIds) {
                const result = await permissionsApi.createGrant({
                    grantee_assignment: form.get("assignment"), permission: permissionId,
                    effect: form.get("effect"), scope_type: "specific_unit", target_unit: form.get("unit"),
                    valid_until: isoFromLocal(form.get("valid_until")), reason: form.get("reason"),
                    expected_revision: currentRevision,
                });
                createdIds.push(permissionId);
                currentRevision = result.revision;
            }
            formElement.reset(); setPermissionIds([]); await onChanged(currentRevision);
        } catch (failure) {
            setPermissionIds(current => current.filter(id => !createdIds.includes(id)));
            if (createdIds.length) await onChanged(currentRevision);
            setError(failure.message);
        }
        finally { setBusy(false); }
    }
    async function revoke(row) {
        const reason = await askRevocationReason();
        if (!reason) return;
        setBusy(true);
        try { const result = await permissionsApi.revokeGrant(row.id, { reason, expected_revision: revision }); await onChanged(result.revision); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    }
    return <section className="permissions_panel">
        <header><div><h2>Excepciones y accesos temporales</h2><p>El otorgante se deriva de tu sesión; nunca se acepta desde el navegador.</p></div></header>
        {canGrant || canRevoke ? <form className="permissions_form" onSubmit={submit}>
            <label>Empleado<PermissionSelect name="assignment" required><option value="">Seleccionar…</option>{directory.map(item => <option value={item.id} key={item.id}>{item.name} · {item.unit_name}</option>)}</PermissionSelect></label>
            <label className="permissions_permission_picker">Permisos<PermissionSelect value="" onChange={event => addPermission(event.target.value)}><option value="">Agregar permiso…</option>{delegableCatalog.filter(item => !permissionIds.includes(item.id)).map(item => <option value={item.id} key={item.id}>{item.code}</option>)}</PermissionSelect><span className="permissions_chips">{selectedPermissions.map(item => <span className="permissions_chip" key={item.id}>{item.code}<button type="button" aria-label={`Quitar ${item.code}`} onClick={() => setPermissionIds(current => current.filter(id => id !== item.id))}><X size={14} /></button></span>)}</span></label>
            <label>Efecto<PermissionSelect name="effect">{canGrant ? <option value="allow">Acceso temporal</option> : null}{canRevoke ? <option value="deny">Denegación individual</option> : null}</PermissionSelect></label>
            <label>Unidad<PermissionSelect name="unit" required>{units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</PermissionSelect></label>
            <label>Vence<CalendarDateField key={maximumHours} name="valid_until" withTime defaultValue={defaultExpiry(maximumHours)} required /><small>Máximo permitido para la selección: {maximumHours} h.</small></label>
            <label className="permissions_reason">Motivo<textarea name="reason" minLength="8" required /></label>
            <div className="permissions_form_actions"><button type="submit" disabled={busy || !permissionIds.length}>Crear {permissionIds.length || ""} {permissionIds.length === 1 ? "regla" : "reglas"}</button></div>
        </form> : null}
        {error ? <p className="permissions_error" role="alert">{error}</p> : null}
        <div className="permissions_table_wrap"><table><caption className="permissions_visually_hidden">Reglas individuales de acceso</caption><thead><tr><th>Empleado</th><th>Permiso</th><th>Regla</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map(row => { const hasCapability = row.effect === "deny" ? canGrant : canRevoke; const belongsToActor = isOwner ? row.grantee_email !== actorEmail : row.granted_by_assignment === activeAssignmentId; const mayRevoke = hasCapability && belongsToActor && row.status === "active" && !row.revoked_at; return <tr key={row.id}><td>{row.grantee_name}<small>{row.grantee_email}</small></td><td>{row.permission_code}</td><td>{row.effect} · {scopeLabels[row.scope_type]}</td><td>{row.valid_until ? new Date(row.valid_until).toLocaleString() : "Sin vencimiento"}</td><td>{accessRuleState(row)}</td><td>{mayRevoke ? <button type="button" disabled={busy} className="permissions_text_button" aria-label={`Revocar regla de ${row.grantee_name}`} onClick={() => revoke(row)}>Revocar</button> : null}</td></tr>; })}</tbody></table>{rows.length ? null : <Empty>No hay reglas individuales.</Empty>}</div>
    </section>;
}

function Authorities({ rows, catalog, directory, units, revision, onChanged, canCreate, canPassDelegation, delegationValidUntil, activeAssignmentId, actorEmail, isOwner }) {
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const delegableCatalog = catalog.filter(item => item.is_delegable);
    const [permissionId, setPermissionId] = useState(delegableCatalog[0]?.id || "");
    const selectedPermission = catalog.find(item => item.id === permissionId);
    const [sensitivity, setSensitivity] = useState(selectedPermission?.risk_level || "low");
    async function submit(event) {
        event.preventDefault(); setError(""); const formElement = event.currentTarget; const form = new FormData(formElement);
        const canGrant = form.has("can_grant_access");
        const canRevoke = form.has("can_revoke_access");
        const canDelegate = form.has("can_delegate_authority");
        if (!canGrant && !canRevoke && !canDelegate) {
            setError("Selecciona al menos una capacidad para la autoridad.");
            return;
        }
        setBusy(true);
        try {
            const result = await permissionsApi.createAuthority({
                assignment: form.get("assignment"), permissions: [permissionId],
                scope_type: "sub_tree", target_unit: form.get("unit"), max_sensitivity_level: sensitivity,
                valid_until: isoFromLocal(form.get("valid_until")), max_grant_duration_seconds: 604800,
                delegation_depth_remaining: canDelegate ? 1 : 0,
                can_grant_access: canGrant,
                can_revoke_access: canRevoke,
                can_delegate_authority: canDelegate,
                reason: form.get("reason"), expected_revision: revision,
            });
            formElement.reset(); await onChanged(result.revision);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    }
    async function revoke(row) {
        const reason = await askRevocationReason();
        if (!reason) return;
        setBusy(true);
        try { const result = await permissionsApi.revokeAuthority(row.id, { reason, expected_revision: revision }); await onChanged(result.revision); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    }
    return <section className="permissions_panel">
        <header><div><h2>Autoridades delegadas</h2><p>Una autoridad solo puede entregar un subconjunto de su alcance y permisos.</p></div></header>
        {canCreate ? <form className="permissions_form" onSubmit={submit}>
            <label>Responsable<PermissionSelect name="assignment" required><option value="">Seleccionar…</option>{directory.map(item => <option value={item.id} key={item.id}>{item.name} · {item.job_role_title}</option>)}</PermissionSelect></label>
            <label>Permiso permitido<PermissionSelect name="permission" value={permissionId} onChange={event => { const next = catalog.find(item => item.id === event.target.value); setPermissionId(event.target.value); setSensitivity(next?.risk_level || "low"); }} required>{delegableCatalog.map(item => <option value={item.id} key={item.id}>{item.code}</option>)}</PermissionSelect></label>
            <label>Raíz del subárbol<PermissionSelect name="unit" required>{units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</PermissionSelect></label>
            <label>Sensibilidad máxima<PermissionSelect name="sensitivity" value={sensitivity} onChange={event => setSensitivity(event.target.value)}>{Object.entries(riskLabels).filter(([risk]) => ["low", "medium", "high", "critical"].indexOf(risk) >= ["low", "medium", "high", "critical"].indexOf(selectedPermission?.risk_level || "low")).map(([risk, label]) => <option value={risk} key={risk}>{label}</option>)}</PermissionSelect></label>
            <label>Vence<CalendarDateField name="valid_until" withTime defaultValue={defaultExpiry(isOwner ? 24 * 30 : 24 * 7, delegationValidUntil)} required /></label>
            <fieldset className="permissions_capabilities"><legend>Capacidades delegadas</legend><label><input name="can_grant_access" type="checkbox" /> Otorgar accesos</label><label><input name="can_revoke_access" type="checkbox" /> Revocar o denegar</label>{canPassDelegation ? <label><input name="can_delegate_authority" type="checkbox" /> Permitir una subdelegación adicional</label> : null}</fieldset>
            <label className="permissions_reason">Motivo<textarea name="reason" minLength="8" required /></label>
            <div className="permissions_form_actions"><button type="submit" disabled={busy}>Delegar autoridad</button></div>
        </form> : null}
        {error ? <p className="permissions_error" role="alert">{error}</p> : null}
        <div className="permissions_table_wrap"><table><caption className="permissions_visually_hidden">Autoridades delegadas</caption><thead><tr><th>Responsable</th><th>Alcance</th><th>Permisos</th><th>Vence</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map(row => { const belongsToActor = isOwner ? row.assignment_email !== actorEmail : row.granted_by_assignment === activeAssignmentId; const mayRevoke = canCreate && belongsToActor && row.is_active && !row.revoked_at; return <tr key={row.id}><td>{row.assignment_name}<small>{row.assignment_email}</small></td><td>{scopeLabels[row.scope_type]}{row.target_unit_name ? ` · ${row.target_unit_name}` : ""}</td><td>{row.permission_codes.join(", ")}</td><td>{row.valid_until ? new Date(row.valid_until).toLocaleString() : "—"}</td><td>{authorityState(row)}</td><td>{mayRevoke ? <button className="permissions_text_button" disabled={busy} type="button" aria-label={`Revocar autoridad de ${row.assignment_name}`} onClick={() => revoke(row)}>Revocar</button> : null}</td></tr>; })}</tbody></table>{rows.length ? null : <Empty>No hay autoridades delegadas.</Empty>}</div>
    </section>;
}

function Audit({ rows }) {
    return <section className="permissions_panel"><header><div><h2>Auditoría de permisos</h2><p>Historial inmutable con actor, motivo, resultado y revisión.</p></div></header><div className="permissions_table_wrap"><table><caption className="permissions_visually_hidden">Auditoría de cambios de permisos</caption><thead><tr><th>Fecha</th><th>Evento</th><th>Actor</th><th>Objetivo</th><th>Motivo</th><th>Rev.</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Date(row.occurred_at).toLocaleString()}</td><td>{row.event_type}<small>{row.outcome}</small></td><td>{row.actor_email || "Sistema"}</td><td>{row.target_type} · {row.target_id}</td><td>{row.reason}</td><td>{row.revision ?? "—"}</td></tr>)}</tbody></table>{rows.length ? null : <Empty>Aún no hay cambios registrados.</Empty>}</div></section>;
}

export default function PermissionsModule() {
    const core = useCore();
    const real = is_using_real_backend();
    const [tab, setTab] = useState("mine");
    const [state, setState] = useState({ loading: true, error: "", access: null, catalog: [], policies: { roles: [], rules: [] }, grants: [], authorities: [], effective: [], audit: [], revision: 0 });
    const loadGeneration = useRef(0);
    const [selectedUnitId, setSelectedUnitId] = useState(core.activeUnit?.id || core.units?.[0]?.id || "");
    const unit = core.units?.find(item => item.id === selectedUnitId) || core.activeUnit || core.units?.[0];
    const unitName = unit?.name || unit?.label;
    const directory = useMemo(() => core.directory || [], [core.directory]);

    async function load() {
        const generation = ++loadGeneration.current;
        if (!real || !unit?.id) { setState(current => ({ ...current, loading: false })); return; }
        const requestedUnitId = unit.id;
        setState(current => ({ ...current, loading: true, error: "" }));
        try {
            const snapshot = await fetchConsistentPermissionSnapshot({
                api: permissionsApi,
                unitId: requestedUnitId,
            });
            if (generation !== loadGeneration.current) return;
            setState({ loading: false, error: "", ...snapshot });
        } catch (failure) {
            if (generation !== loadGeneration.current) return;
            setState(current => ({
                ...current,
                loading: false,
                error: failure.message,
                access: current.access ? {
                    ...current.access,
                    can_manage_role_policies: false,
                    can_grant_access: false,
                    can_revoke_access: false,
                    can_delegate_authority: false,
                    can_read_audit: false,
                    mfa_recent: false,
                } : null,
            }));
        }
    }
    useEffect(() => { setSelectedUnitId(core.activeUnit?.id || core.units?.[0]?.id || ""); }, [core.activeAssignment?.id]);
    useEffect(() => { load(); }, [core.activeAssignment?.id, unit?.id]);
    useEffect(() => {
        if (!state.access?.mfa_recent || !state.access?.mfa_valid_until) return undefined;
        const delay = new Date(state.access.mfa_valid_until).getTime() - Date.now() + 100;
        const timer = window.setTimeout(load, Math.max(delay, 100));
        return () => window.clearTimeout(timer);
    }, [state.access?.mfa_recent, state.access?.mfa_valid_until]);
    async function changed(revision) {
        globalThis.dispatchEvent?.(new CustomEvent("bold:permissions-changed", { detail: { revision } }));
        await load();
    }
    if (!real) return <div className="permissions_module"><section className="permissions_panel"><h1>Permisos</h1><p>Activa el backend real para probar las políticas y autoridades.</p></section></div>;
    const access = state.access || {};
    const eligibleDirectory = directory.filter(item => (
        item.personId !== core.activeAssignment?.personId
        && !item.account_is_superuser
    ));
    const mfaReady = Boolean(access.mfa_recent);
    const tabs = [
        ["mine", "Mis accesos"],
        ...(access.can_manage_role_policies ? [["policies", "Políticas por cargo"]] : []),
        ...(access.can_grant_access || access.can_revoke_access || state.grants.length ? [["grants", "Accesos individuales"]] : []),
        ...(access.can_delegate_authority || state.authorities.length ? [["authorities", "Autoridades"]] : []),
        ...(access.can_read_audit ? [["audit", "Auditoría"]] : []),
    ];
    return <div className="permissions_module">
        <header className="permissions_header"><div><span><ShieldCheck size={19} /> Seguridad y acceso</span><h1>Permisos</h1><p>Políticas efectivas, excepciones y delegación con trazabilidad.</p></div><button type="button" onClick={load} aria-label="Actualizar"><RefreshCw size={18} /></button></header>
        {state.error ? <div className="permissions_banner permissions_banner_error" role="alert"><AlertTriangle size={18} /><span>{state.error}</span></div> : null}
        {state.loading ? <div className="permissions_banner" role="status"><RefreshCw size={18} /><span>Cargando políticas…</span></div> : null}
        {!state.loading && (access.can_manage_role_policies || access.can_grant_access || access.can_revoke_access || access.can_delegate_authority) && !access.mfa_recent ? <StepUp onVerified={load} /> : null}
        <nav className="permissions_tabs" aria-label="Secciones de permisos" role="tablist">{tabs.map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{id === "mine" ? <KeyRound size={15} /> : null}{label}</button>)}</nav>
        {!state.loading && tab === "mine" ? <MyAccess rows={state.effective} unitName={unitName} units={core.units || []} unitId={unit?.id || ""} onUnitChange={setSelectedUnitId} /> : null}
        {!state.loading && tab === "policies" ? <RolePolicies data={state.policies} catalog={state.catalog} units={core.units || []} revision={state.revision} onChanged={changed} canMutate={Boolean(access.can_manage_role_policies && mfaReady)} /> : null}
        {!state.loading && tab === "grants" ? <AccessRules rows={state.grants} catalog={state.catalog} directory={eligibleDirectory} units={core.units || []} revision={state.revision} onChanged={changed} canGrant={Boolean(access.can_grant_access && mfaReady)} canRevoke={Boolean(access.can_revoke_access && mfaReady)} activeAssignmentId={core.activeAssignment?.id} actorEmail={core.account?.email} isOwner={Boolean(access.is_owner)} /> : null}
        {!state.loading && tab === "authorities" ? <Authorities rows={state.authorities} catalog={state.catalog} directory={eligibleDirectory} units={core.units || []} revision={state.revision} onChanged={changed} canCreate={Boolean(access.can_delegate_authority && mfaReady)} canPassDelegation={Boolean(access.is_owner || Number(access.max_delegation_depth_remaining) > 1)} delegationValidUntil={access.delegation_valid_until_ceiling} activeAssignmentId={core.activeAssignment?.id} actorEmail={core.account?.email} isOwner={Boolean(access.is_owner)} /> : null}
        {!state.loading && tab === "audit" ? <Audit rows={state.audit} /> : null}
    </div>;
}
