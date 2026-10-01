import { Children, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, KeyRound, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import Swal from "sweetalert2";
import { BoldSelect } from "../core/shared/bold_select.jsx";
import { CalendarDateField } from "../tareas/src/task_app.jsx";
import { coreApi } from "../core/core_api.js";
import { useCore } from "../core/core_provider.jsx";
import { is_using_real_backend } from "../core/http_client.js";
import { permissionsApi } from "./permissions_api.js";
import { fetchConsistentPermissionSnapshot } from "./permissions_state.js";
import "./permissions.css";

function Select({ children, onChange, ...props }) { const options = Children.toArray(children).map(x => ({ value: x.props.value, label: x.props.children })); return <BoldSelect {...props} options={options} onValueChange={value => onChange?.({ target: { value } })} />; }
const dialog = options => Swal.fire({ confirmButtonColor: "#ef1f2d", cancelButtonText: "Cancelar", showCancelButton: true, customClass: { container: "permissions_swal_container", popup: "permissions_swal" }, ...options });
const scopes = {
    global: "Global",
    own_unit: "Unidad propia",
    own_sub_tree: "Unidad propia y subárbol",
    created_by_me: "Tareas creadas por mí",
    sub_tree: "Unidad específica y subárbol",
    specific_unit: "Unidad específica",
};
const roleScopes = {
    global: scopes.global,
    own_unit: scopes.own_unit,
    own_sub_tree: scopes.own_sub_tree,
    specific_unit: scopes.specific_unit,
};
const creatorScopedPermissions = new Set(["tasks.task.update", "tasks.task.delete", "tasks.task.assign"]);
function roleScopeOptions(permission, effect, includeCreator = true) {
    const options = Object.entries(roleScopes);
    if (includeCreator && effect === "allow" && creatorScopedPermissions.has(permission?.code)) {
        options.push(["created_by_me", scopes.created_by_me]);
    }
    return options;
}
const risks = { low: "Bajo", medium: "Medio", high: "Alto", critical: "Crítico" };
const nameOf = p => p?.description || p?.resource || p?.code || "Permiso";
const presetDefinitions = [
    { id: "read", label: "Solo consulta", description: "Lectura y consulta de catálogos", actions: new Set(["read", "list", "view"]) },
    { id: "collaborate", label: "Colaboración", description: "Consulta, creación y comentarios", actions: new Set(["read", "list", "view", "create", "comment"]) },
    { id: "operate", label: "Operación", description: "Todas las reglas ordinarias aptas para lote", actions: null },
];
const iso = value => value ? new Date(value).toISOString() : null;
function expiry(hours = 24, ceiling) { const d = new Date(Math.min(Date.now() + hours * 3600000, ceiling ? new Date(ceiling).getTime() : Infinity)); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function grantState(x) { if (x.status === "revoked") return "Revocada"; if (x.valid_from && new Date(x.valid_from) > new Date()) return "Programada"; if (x.valid_until && new Date(x.valid_until) <= new Date()) return "Expirada"; return x.effective ? "Vigente" : "Inactiva"; }
function authorityState(x) { if (!x.is_active || x.revoked_at) return "Revocada"; if (x.valid_until && new Date(x.valid_until) <= new Date()) return "Expirada"; return x.effective ? "Vigente" : "Cadena inactiva"; }
function Status({ children, good }) { const danger = /deneg|revoc|expir|inactiv/i.test(children); return <span className={`permissions_status ${good || (!danger && /vigente|permit|success/i.test(children)) ? "success" : danger ? "danger" : "neutral"}`}>{children}</span>; }
const decisionLabel = row => row.reason_code === "mfa_step_up_required" ? "Requiere MFA" : row.allowed ? "Permitido" : "Denegado";
const isMfaError = error => error?.fields?.code === "mfa_step_up_required" || /mfa_step_up_required|MFA.*reciente/i.test(error?.message || "");
function permissionError(error) {
    if (isMfaError(error)) return "Tu confirmación MFA expiró. Verifica nuevamente tu identidad para continuar.";
    const detail = error?.fields?.detail;
    if (Array.isArray(detail)) return detail.join(" ");
    return detail || error?.message || "No se pudo completar la operación.";
}
function FormError({ error, onMfa }) {
    if (!error) return null;
    return <div className="permissions_form_error" role="alert"><AlertTriangle /><div><strong>No se pudo completar la acción</strong><span>{permissionError(error)}</span>{isMfaError(error) && onMfa && <button type="button" onClick={onMfa}>Verificar MFA</button>}</div></div>;
}
const Empty = ({ children }) => <p className="permissions_empty">{children}</p>;

function Drawer({ title, subtitle, close, children, wide }) {
    const box = useRef(), previous = useRef(document.activeElement), dirty = useRef(false), closeRef = useRef(close); closeRef.current = close;
    async function requestClose() { if (dirty.current && !(await dialog({ title: "¿Descartar cambios?", text: "Los datos sin guardar se perderán.", icon: "warning", confirmButtonText: "Descartar" })).isConfirmed) return; closeRef.current(); }
    useEffect(() => { box.current?.focus(); const key = e => e.key === "Escape" && requestClose(); document.addEventListener("keydown", key); return () => { document.removeEventListener("keydown", key); previous.current?.focus?.(); }; }, []);
    return createPortal(<div className="permissions_drawer_backdrop" onMouseDown={e => e.target === e.currentTarget && requestClose()}><aside className={`permissions_drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" tabIndex={-1} ref={box} onInput={() => { dirty.current = true; }}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={requestClose} aria-label="Cerrar"><X /></button></header><div className="permissions_drawer_body">{children}</div></aside></div>, document.body);
}
function Filters({ query, setQuery, children }) { return <div className="permissions_filters"><label className="permissions_search"><Search size={16} /><input aria-label="Buscar" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar…" /></label>{children}</div>; }
function Unlock({ done }) { const [error, setError] = useState(null); const [busy, setBusy] = useState(false); async function submit(e) { e.preventDefault(); setBusy(true); try { await coreApi.stepUpMfa(new FormData(e.currentTarget).get("code")); await done(); } catch (x) { setError(x); } finally { setBusy(false); } } return <form className="permissions_drawer_form" onSubmit={submit}><div className="permissions_callout"><LockKeyhole /><p>Confirma tu identidad para habilitar acciones sensibles durante diez minutos.</p></div><label>Código TOTP<input name="code" inputMode="numeric" autoComplete="one-time-code" minLength="6" maxLength="8" autoFocus required /></label><FormError error={error} /><button disabled={busy}>{busy ? "Verificando…" : "Desbloquear edición"}</button></form>; }

function Summary({ state, units, unit, setUnit, go }) { const allowed = state.effective.filter(x => x.allowed), denied = state.effective.filter(x => !x.allowed), groups = Object.entries(state.effective.reduce((a, x) => { (a[x.module_code || "General"] ||= []).push(x); return a; }, {})); return <div className="permissions_stack"><section className="permissions_metrics"><article><span>Permitidos</span><strong>{allowed.length}</strong><small>{unit?.name}</small></article><article><span>Requieren atención</span><strong>{denied.length}</strong><small>denegados o pendientes de MFA</small></article><article><span>Accesos activos</span><strong>{state.grants.filter(x => grantState(x) === "Vigente").length}</strong><button onClick={() => go("grants")}>Ver accesos</button></article><article><span>Autoridades vigentes</span><strong>{state.authorities.filter(x => authorityState(x) === "Vigente").length}</strong><button onClick={() => go("authorities")}>Ver autoridades</button></article></section><section className="permissions_panel"><header><div><h2>Mis accesos efectivos</h2><p>Qué puedes hacer y por qué.</p></div>{units.length > 1 && <label className="permissions_unit_picker">Unidad<Select value={unit?.id} onChange={e => setUnit(e.target.value)}>{units.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>}</header>{groups.map(([module, rows]) => <section className="permissions_group" key={module}><h3>{module}</h3><div className="permissions_cards">{rows.map(row => { const p = state.catalog.find(x => x.id === row.permission), needsMfa = row.reason_code === "mfa_step_up_required"; return <article className="permission_card" key={row.code}><span className={row.allowed ? "allowed" : "denied"}>{row.allowed ? <Check /> : needsMfa ? <LockKeyhole /> : <X />}</span><div><strong>{nameOf(p)}</strong><code>{row.code}</code><small>{row.reason}</small></div><Status good={row.allowed}>{decisionLabel(row)}</Status></article>; })}</div></section>)}</section></div>; }

function Policies({ state, units, changed, unlocked, unlock, roleId, setRoleId }) {
    const roles = state.policies.roles.filter(x => x.level?.toLowerCase() !== "owner"), [query, setQuery] = useState(""), [risk, setRisk] = useState(""), [edit, setEdit] = useState(null), [selected, setSelected] = useState([]), [bulkOpen, setBulkOpen] = useState(false);
    const role = roles.find(x => x.id === roleId) || roles[0];
    const visible = state.catalog.filter(x => `${nameOf(x)} ${x.code} ${x.module_code}`.toLowerCase().includes(query.toLowerCase()) && (!risk || x.risk_level === risk));
    const groups = Object.entries(visible.reduce((a, x) => { (a[x.module_code || "General"] ||= []).push(x); return a; }, {})).sort(([left], [right]) => left.localeCompare(right, "es"));
    const selectedPermissions = state.catalog.filter(permission => selected.includes(permission.id));
    useEffect(() => { if (role?.id && roleId !== role.id) setRoleId(role.id); }, [role?.id, roleId, setRoleId]);
    useEffect(() => { setSelected([]); setBulkOpen(false); }, [role?.id]);
    function toggleModule(items) {
        const ids = items.filter(item => item.is_bulk_assignable).map(item => item.id), allSelected = ids.length > 0 && ids.every(id => selected.includes(id));
        setSelected(current => allSelected ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]);
    }
    function applyPreset(preset) {
        setSelected(state.catalog.filter(permission => permission.is_bulk_assignable && (!preset.actions || preset.actions.has(permission.action))).map(permission => permission.id));
    }
    function togglePermission(permission) {
        if (!permission.is_bulk_assignable) return;
        setSelected(current => current.includes(permission.id) ? current.filter(id => id !== permission.id) : [...current, permission.id]);
    }
    function openBulk() { unlocked ? setBulkOpen(true) : unlock(); }
    return <section className="permissions_panel"><header><div><h2>Políticas por cargo</h2><p>Permisos base organizados por módulo.</p></div><label>Cargo<Select value={role?.id || ""} onChange={e => setRoleId(e.target.value)}>{roles.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</Select></label></header>
        {!unlocked && <div className="permissions_callout permissions_policy_lock"><LockKeyhole /><div><strong>Edición protegida con MFA</strong><p>Verifica tu identidad antes de modificar las políticas de un cargo.</p><button type="button" onClick={unlock}>Desbloquear edición</button></div></div>}
        <section className="permissions_presets" aria-label="Preselecciones de permisos"><div><strong>Preselección rápida</strong><small>Prepara un conjunto seguro; después puedes quitar elementos o ajustar cada regla.</small></div>{presetDefinitions.map(preset => <button type="button" key={preset.id} onClick={() => applyPreset(preset)}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</section>
        <Filters query={query} setQuery={setQuery}><Select value={risk} onChange={e => setRisk(e.target.value)}><option value="">Todos los riesgos</option>{Object.entries(risks).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Filters>
        {selected.length > 0 && <div className="permissions_bulk_bar"><div><strong>{selected.length} permiso{selected.length === 1 ? "" : "s"} seleccionado{selected.length === 1 ? "" : "s"}</strong><small>Se aplicará una sola operación auditada.</small></div><button type="button" onClick={() => setSelected([])}>Limpiar</button><button className="permissions_primary" type="button" onClick={openBulk}>{unlocked ? "Configurar selección" : "Desbloquear y configurar"}</button></div>}
        <div className="permissions_catalog">{groups.map(([module, items]) => { const eligible = items.filter(item => item.is_bulk_assignable), allSelected = eligible.length > 0 && eligible.every(item => selected.includes(item.id)); return <details className="permissions_policy_group" key={module} open><summary><span>{module}</span><div className="permissions_policy_group_meta"><small>{items.length} permiso{items.length === 1 ? "" : "s"}</small><button type="button" disabled={!eligible.length} className={allSelected ? "is_selected" : ""} aria-pressed={allSelected} onClick={event => { event.preventDefault(); event.stopPropagation(); toggleModule(items); }}>{allSelected ? <Check size={14} /> : null}{allSelected ? "Seleccionado" : "Preseleccionar módulo"}</button></div></summary><div className="permissions_policy_items">{items.map(p => { const rules = state.policies.rules.filter(x => x.job_role === role?.id && x.permission === p.id), chosen = selected.includes(p.id); return <article key={p.id} className={chosen ? "is_selected" : ""}><button className="permissions_policy_select" type="button" disabled={!p.is_bulk_assignable} aria-pressed={chosen} aria-label={p.is_bulk_assignable ? `Seleccionar ${nameOf(p)} para lote` : `${nameOf(p)} requiere configuración individual`} onClick={() => togglePermission(p)}>{chosen ? <Check size={15} /> : null}</button><button className="permissions_policy_edit" type="button" onClick={() => unlocked ? setEdit(p) : unlock()}><div><strong>{nameOf(p)}</strong><code>{p.code}</code>{!p.is_bulk_assignable && <small className="permissions_sensitive">Configuración individual</small>}</div><div>{rules.length ? rules.map(x => <Status key={x.id} good={x.effect === "allow"}>{x.effect === "allow" ? "Permitir" : "Denegar"} · {scopes[x.scope_type]}</Status>) : <Status>Sin regla</Status>}<Status>{risks[p.risk_level]}</Status></div></button></article>; })}</div></details>; })}</div>
        {edit && <Drawer title="Configurar política" subtitle={role.title} close={() => setEdit(null)}><PolicyForm role={role} permission={edit} rules={state.policies.rules.filter(x => x.job_role === role.id && x.permission === edit.id)} units={units} revision={state.revision} changed={changed} close={() => setEdit(null)} unlock={unlock} /></Drawer>}
        {bulkOpen && <Drawer title="Configurar permisos en lote" subtitle={role.title} close={() => setBulkOpen(false)} wide><BulkPolicyForm role={role} permissions={selectedPermissions} units={units} revision={state.revision} changed={changed} close={() => setBulkOpen(false)} completed={() => setSelected([])} unlock={unlock} /></Drawer>}
    </section>;
}
function PolicyForm({ role, permission, rules: current, units, revision, changed, close, unlock }) {
    const [scope, setScope] = useState("own_unit"), [effect, setEffect] = useState("allow"), [unit, setUnit] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(null);
    const needs = scope === "specific_unit";
    const serialize = rows => rows.map(x => ({ effect: x.effect, scope_type: x.scope_type, ...(x.target_unit && { target_unit: x.target_unit }) }));
    async function replace(rules) {
        const result = await permissionsApi.replaceRolePolicy({ job_role: role.id, permission: permission.id, rules, reason, expected_revision: revision });
        await changed(result.revision); close();
    }
    async function save(e) {
        e.preventDefault();
        const target = needs ? unit : null;
        const rules = serialize(current.filter(x => !(x.scope_type === scope && (x.target_unit || null) === target)));
        try { await replace([...rules, { effect, scope_type: scope, ...(needs && { target_unit: unit }) }]); }
        catch (x) { setError(x); }
    }
    async function remove(rule) {
        if (reason.trim().length < 8) return setError(new Error("Escribe un motivo de al menos 8 caracteres antes de quitar la regla."));
        const answer = await dialog({ title: "¿Quitar esta regla?", text: `${rule.effect === "allow" ? "Permitir" : "Denegar"} · ${scopes[rule.scope_type]}`, icon: "warning", confirmButtonText: "Quitar regla" });
        if (!answer.isConfirmed) return;
        try { await replace(serialize(current.filter(item => item.id !== rule.id))); }
        catch (x) { setError(x); }
    }
    return <form className="permissions_drawer_form" onSubmit={save}><div className="permissions_selection"><strong>{nameOf(permission)}</strong><code>{permission.code}</code></div>
        {current.length > 0 && <section className="permissions_current_rules"><h3>Reglas actuales</h3>{current.map(rule => <article key={rule.id}><div><strong>{rule.effect === "allow" ? "Permitir" : "Denegar"}</strong><span>{scopes[rule.scope_type]}{rule.target_unit_name ? ` · ${rule.target_unit_name}` : ""}</span></div><button type="button" onClick={() => remove(rule)}>Quitar</button></article>)}</section>}
        <label>Efecto<Select value={effect} onChange={e => { const next = e.target.value; setEffect(next); if (next !== "allow" && scope === "created_by_me") setScope("own_unit"); }}><option value="allow">Permitir</option><option value="deny">Denegar</option></Select></label><label>Alcance<Select value={scope} onChange={e => setScope(e.target.value)}>{roleScopeOptions(permission, effect).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>{needs && <label>Unidad<Select value={unit} onChange={e => setUnit(e.target.value)} required><option value="">Seleccionar…</option>{units.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>}<label>Motivo<textarea value={reason} onChange={e => setReason(e.target.value)} minLength="8" required /></label><FormError error={error} onMfa={() => { setError(null); unlock(); }} /><div className="permissions_form_actions"><button>Guardar regla</button></div>
    </form>;
}

function BulkPolicyForm({ role, permissions, units, revision, changed, close, completed, unlock }) {
    const [action, setAction] = useState("allow"), [scope, setScope] = useState("own_unit"), [unit, setUnit] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(null), [busy, setBusy] = useState(false);
    const [drafts, setDrafts] = useState(() => Object.fromEntries(permissions.map(permission => [permission.id, { action: "allow", scope: "own_unit", unit: "" }])));
    const needsUnit = action !== "clear" && scope === "specific_unit";
    const modules = [...new Set(permissions.map(permission => permission.module_code || "General"))].sort((a, b) => a.localeCompare(b, "es"));
    const highRisk = permissions.filter(permission => ["high", "critical"].includes(permission.risk_level)).length;
    function updateDraft(id, changes) { setDrafts(current => ({ ...current, [id]: { ...current[id], ...changes } })); }
    function applyToAll() { setDrafts(Object.fromEntries(permissions.map(permission => [permission.id, { action, scope, unit: needsUnit ? unit : "" }]))); }
    async function submit(event) {
        event.preventDefault();
        const incomplete = permissions.find(permission => {
            const draft = drafts[permission.id];
            return draft?.action !== "clear" && draft?.scope === "specific_unit" && !draft?.unit;
        });
        if (incomplete) return setError(new Error(`Selecciona una unidad para ${nameOf(incomplete)}.`));
        const answer = await dialog({
            title: `¿Aplicar a ${permissions.length} permisos?`,
            text: "Cada permiso reemplazará sus reglas actuales por la configuración mostrada.",
            icon: "warning",
            confirmButtonText: "Aplicar configuraciones",
        });
        if (!answer.isConfirmed) return;
        setBusy(true); setError(null);
        const configurations = permissions.map(permission => {
            const draft = drafts[permission.id];
            const ruleNeedsUnit = draft.action !== "clear" && draft.scope === "specific_unit";
            return { permission: permission.id, rules: draft.action === "clear" ? [] : [{ effect: draft.action, scope_type: draft.scope, ...(ruleNeedsUnit && { target_unit: draft.unit }) }] };
        });
        try {
            const result = await permissionsApi.replaceRolePoliciesBulk({ job_role: role.id, configurations, reason, expected_revision: revision });
            await changed(result.revision); completed(); close();
        } catch (caught) { setError(caught); }
        finally { setBusy(false); }
    }
    return <form className="permissions_drawer_form" onSubmit={submit}>
        <div className="permissions_selection"><strong>{permissions.length} permisos seleccionados</strong><span>{modules.join(" · ")}</span>{highRisk > 0 && <small>{highRisk} de riesgo alto o crítico</small>}</div>
        <div className="permissions_callout"><AlertTriangle /><p>Esta acción reemplaza las reglas de la selección. Los permisos sensibles, como webhooks salientes, solo pueden configurarse individualmente y nunca entran en preselecciones.</p></div>
        <fieldset className="permissions_bulk_template"><legend>Regla rápida para toda la selección</legend><label>Acción<Select value={action} onChange={event => setAction(event.target.value)}><option value="allow">Permitir</option><option value="deny">Denegar</option><option value="clear">Dejar sin regla</option></Select></label>{action !== "clear" && <label>Alcance<Select value={scope} onChange={event => setScope(event.target.value)}>{roleScopeOptions(null, action, false).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>}{needsUnit && <label>Unidad<Select value={unit} onChange={event => setUnit(event.target.value)}><option value="">Seleccionar…</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}<button type="button" onClick={applyToAll}>Aplicar al borrador</button></fieldset>
        <section className="permissions_bulk_drafts"><h3>Ajuste por permiso</h3>{permissions.map(permission => { const draft = drafts[permission.id], draftNeedsUnit = draft.action !== "clear" && draft.scope === "specific_unit"; return <article key={permission.id}><div><strong>{nameOf(permission)}</strong><code>{permission.code}</code></div><Select value={draft.action} onChange={event => { const next = event.target.value; updateDraft(permission.id, { action: next, ...(next !== "allow" && draft.scope === "created_by_me" ? { scope: "own_unit" } : {}) }); }}><option value="allow">Permitir</option><option value="deny">Denegar</option><option value="clear">Sin regla</option></Select>{draft.action !== "clear" && <Select value={draft.scope} onChange={event => updateDraft(permission.id, { scope: event.target.value, unit: "" })}>{roleScopeOptions(permission, draft.action).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>}{draftNeedsUnit && <Select value={draft.unit} onChange={event => updateDraft(permission.id, { unit: event.target.value })}><option value="">Unidad…</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}</article>; })}</section>
        <label>Motivo<textarea value={reason} onChange={event => setReason(event.target.value)} minLength="8" maxLength="2000" required placeholder="Explica por qué se aplica este cambio masivo" /></label>
        <FormError error={error} onMfa={() => { setError(null); unlock(); }} />
        <button disabled={busy || permissions.length === 0}>{busy ? "Aplicando…" : "Aplicar configuraciones"}</button>
    </form>;
}

function Records({ kind, state, core, units, changed, unlocked, unlock }) {
    const authority = kind === "authorities", rows = authority ? state.authorities : state.grants, [open, setOpen] = useState(false), [query, setQuery] = useState(""), [filter, setFilter] = useState(""), [error, setError] = useState(null); const status = x => authority ? authorityState(x) : grantState(x); const visible = rows.filter(x => JSON.stringify(x).toLowerCase().includes(query.toLowerCase()) && (!filter || status(x) === filter));
    async function revoke(row) { const answer = await dialog({ title: "Motivo de la revocación", input: "text", inputValidator: x => x.trim().length < 8 ? "Escribe al menos 8 caracteres." : undefined, confirmButtonText: "Revocar" }); if (!answer.isConfirmed) return; try { const r = authority ? await permissionsApi.revokeAuthority(row.id, { reason: answer.value.trim(), expected_revision: state.revision }) : await permissionsApi.revokeGrant(row.id, { reason: answer.value.trim(), expected_revision: state.revision }); await changed(r.revision); setError(null); } catch (x) { setError(x); } }
    function create() { unlocked ? setOpen(true) : unlock(); }
    return <section className="permissions_panel"><header><div><h2>{authority ? "Autoridades delegadas" : "Accesos individuales"}</h2><p>{authority ? "Quién puede administrar accesos y dentro de qué alcance." : "Excepciones temporales y denegaciones por persona."}</p></div><button className="permissions_primary" onClick={create}><Plus />{authority ? "Nueva autoridad" : "Nuevo acceso"}</button></header><Filters query={query} setQuery={setQuery}><Select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Todos los estados</option>{["Vigente", "Programada", "Expirada", "Revocada", "Inactiva", "Cadena inactiva"].map(x => <option key={x} value={x}>{x}</option>)}</Select></Filters><FormError error={error} onMfa={() => { setError(null); unlock(); }} /><div className="permissions_table_wrap"><table><thead><tr><th>{authority ? "Responsable" : "Empleado"}</th><th>{authority ? "Alcance" : "Permiso"}</th><th>{authority ? "Permisos" : "Regla"}</th><th>Vence</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{visible.map(x => <tr key={x.id}><td data-label="Persona"><strong>{authority ? x.assignment_name : x.grantee_name}</strong><small>{authority ? x.assignment_email : x.grantee_email}</small></td><td data-label="Detalle">{authority ? `${scopes[x.scope_type]} · ${x.target_unit_name || ""}` : x.permission_code}</td><td data-label="Permisos">{authority ? x.permission_codes.join(", ") : `${x.effect === "allow" ? "Permitir" : "Denegar"} · ${scopes[x.scope_type]}`}</td><td data-label="Vence">{x.valid_until ? new Date(x.valid_until).toLocaleString() : "—"}</td><td data-label="Estado"><Status>{status(x)}</Status></td><td data-label="Acción"><button className="permissions_text_button" onClick={() => revoke(x)}>Revocar</button></td></tr>)}</tbody></table>{visible.length === 0 && <Empty>No hay resultados.</Empty>}</div>{open && <Drawer title={authority ? "Nueva autoridad" : "Nuevo acceso"} subtitle="Completa solamente el alcance necesario" close={() => setOpen(false)}>{authority ? <AuthorityForm state={state} core={core} units={units} changed={changed} close={() => setOpen(false)} unlock={unlock} /> : <GrantForm state={state} core={core} units={units} changed={changed} close={() => setOpen(false)} unlock={unlock} />}</Drawer>}</section>;
}
function GrantForm({ state, core, units, changed, close, unlock }) {
    const [ids, setIds] = useState([]), [error, setError] = useState(null);
    const catalog = state.catalog.filter(x => x.is_delegable), selected = ids.map(id => state.catalog.find(x => x.id === id));
    async function submit(e) {
        e.preventDefault();
        if (!ids.length) return setError(new Error("Selecciona al menos un permiso."));
        const f = new FormData(e.currentTarget); let rev = state.revision;
        try { for (const permission of ids) { const r = await permissionsApi.createGrant({ grantee_assignment: f.get("assignment"), permission, effect: f.get("effect"), scope_type: "specific_unit", target_unit: f.get("unit"), valid_until: iso(f.get("valid_until")), reason: f.get("reason"), expected_revision: rev }); rev = r.revision; } await changed(rev); close(); }
        catch (x) { setError(x); }
    }
    return <form className="permissions_drawer_form" onSubmit={submit}><label>Empleado<Select name="assignment" required searchable searchPlaceholder="Buscar empleado…"><option value="">Seleccionar…</option>{core.directory.map(x => <option key={x.id} value={x.id}>{x.name} · {x.unit_name}</option>)}</Select></label><label>Permisos<Select value="" searchable searchPlaceholder="Buscar por título o código…" onChange={e => e.target.value && setIds(a => a.includes(e.target.value) ? a : [...a, e.target.value])}><option value="">Agregar permiso…</option>{catalog.filter(x => !ids.includes(x.id)).map(x => <option key={x.id} value={x.id}>{nameOf(x)} · {x.code}</option>)}</Select></label><div className="permissions_chips">{selected.map(x => <span className="permissions_chip" key={x.id}>{nameOf(x)}<button type="button" onClick={() => setIds(a => a.filter(id => id !== x.id))}><X /></button></span>)}</div><label>Efecto<Select name="effect"><option value="allow">Acceso temporal</option><option value="deny">Denegación individual</option></Select></label><label>Unidad<Select name="unit">{units.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label><label>Vence<CalendarDateField name="valid_until" withTime defaultValue={expiry(selected.some(x => x.risk_level === "critical") ? 8 : 24)} required /></label><label>Motivo<textarea name="reason" minLength="8" required /></label><FormError error={error} onMfa={() => { setError(null); unlock(); }} /><button>Crear acceso</button></form>;
}
function AuthorityForm({ state, core, units, changed, close, unlock }) { const catalog = state.catalog.filter(x => x.is_delegable), [permission, setPermission] = useState(catalog[0]?.id || ""), [error, setError] = useState(null); async function submit(e) { e.preventDefault(); const f = new FormData(e.currentTarget); if (!["can_grant_access", "can_revoke_access", "can_delegate_authority"].some(x => f.has(x))) return setError(new Error("Selecciona al menos una capacidad.")); try { const r = await permissionsApi.createAuthority({ assignment: f.get("assignment"), permissions: [permission], scope_type: "sub_tree", target_unit: f.get("unit"), max_sensitivity_level: f.get("risk"), valid_until: iso(f.get("valid_until")), max_grant_duration_seconds: 604800, delegation_depth_remaining: f.has("can_delegate_authority") ? 1 : 0, can_grant_access: f.has("can_grant_access"), can_revoke_access: f.has("can_revoke_access"), can_delegate_authority: f.has("can_delegate_authority"), reason: f.get("reason"), expected_revision: state.revision }); await changed(r.revision); close(); } catch (x) { setError(x); } } return <form className="permissions_drawer_form" onSubmit={submit}><label>Responsable<Select name="assignment"><option value="">Seleccionar…</option>{core.directory.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label><label>Permiso<Select value={permission} onChange={e => setPermission(e.target.value)}>{catalog.map(x => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}</Select></label><label>Raíz del subárbol<Select name="unit">{units.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label><label>Sensibilidad<Select name="risk">{Object.entries(risks).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label><label>Vence<CalendarDateField name="valid_until" withTime defaultValue={expiry(168, state.access.delegation_valid_until_ceiling)} required /></label><fieldset className="permissions_capabilities"><legend>Capacidades</legend><label><input name="can_grant_access" type="checkbox" /> Otorgar</label><label><input name="can_revoke_access" type="checkbox" /> Revocar</label><label><input name="can_delegate_authority" type="checkbox" /> Subdelegar</label></fieldset><label>Motivo<textarea name="reason" minLength="8" required /></label><FormError error={error} onMfa={() => { setError(null); unlock(); }} /><button>Delegar autoridad</button></form>; }

function Audit({ audit, load }) { const [query, setQuery] = useState(""), [selected, setSelected] = useState(null); const rows = audit.rows.filter(x => JSON.stringify(x).toLowerCase().includes(query.toLowerCase())); return <section className="permissions_panel"><header><div><h2>Auditoría</h2><p>Historial inmutable de cambios e intentos.</p></div><button onClick={load}><RefreshCw />Actualizar</button></header>{audit.loading && <div className="permissions_banner">Cargando auditoría…</div>}{audit.error && <p className="permissions_error">{audit.error}</p>}<Filters query={query} setQuery={setQuery} /><div className="permissions_table_wrap"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Actor</th><th>Objetivo</th><th>Resultado</th><th></th></tr></thead><tbody>{rows.map(x => <tr key={x.id}><td data-label="Fecha">{new Date(x.occurred_at).toLocaleString()}</td><td data-label="Evento">{x.event_type}<small>{x.reason}</small></td><td data-label="Actor">{x.actor_email || "Sistema"}</td><td data-label="Objetivo">{x.target_type} · {x.target_id}</td><td data-label="Resultado"><Status good={x.outcome === "success"}>{x.outcome}</Status></td><td><button className="permissions_text_button" onClick={() => setSelected(x)}>Detalle</button></td></tr>)}</tbody></table></div>{selected && <Drawer title="Detalle del evento" subtitle={selected.event_type} close={() => setSelected(null)} wide><dl className="permissions_details">{[["Fecha", new Date(selected.occurred_at).toLocaleString()], ["Actor", selected.actor_email || "Sistema"], ["Objetivo", `${selected.target_type} · ${selected.target_id}`], ["Permiso", selected.permission_code || "—"], ["MFA", selected.mfa_verified ? "Sí" : "No"], ["Correlación", selected.correlation_id || "—"]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}{[["Antes", selected.before], ["Después", selected.after], ["Metadatos", selected.metadata]].map(([k, v]) => <div className="full" key={k}><dt>{k}</dt><dd><pre>{JSON.stringify(v || {}, null, 2)}</pre></dd></div>)}</dl></Drawer>}</section>; }

export default function PermissionsModule() {
    const core = useCore(), real = is_using_real_backend(), [tab, setTab] = useState("summary"), [unlock, setUnlock] = useState(false), [policyRoleId, setPolicyRoleId] = useState(""), [unitId, setUnit] = useState(core.activeUnit?.id || core.units?.[0]?.id || ""), unit = core.units?.find(x => x.id === unitId) || core.activeUnit || core.units?.[0], generation = useRef(0); const [state, setState] = useState({ loading: true, error: "", access: null, catalog: [], policies: { roles: [], rules: [] }, grants: [], authorities: [], effective: [], revision: 0 }), [audit, setAudit] = useState({ loading: false, loaded: false, error: "", rows: [] });
    async function load() { const gen = ++generation.current; if (core.securityUncertain || !real || !unit?.id || !core.activeUnit?.is_control_plane) return; setState(s => ({ ...s, loading: true, error: "" })); try { const data = await fetchConsistentPermissionSnapshot({ api: permissionsApi, unitId: unit.id }); if (gen === generation.current) setState({ loading: false, error: "", ...data }); } catch (x) { if (gen === generation.current) setState(s => ({ ...s, loading: false, error: x.message })); } }
    async function loadAudit() { if (core.securityUncertain || !core.activeUnit?.is_control_plane) return; const gen = generation.current; setAudit(a => ({ ...a, loading: true, error: "" })); try { const rows = await permissionsApi.audit({ limit: 100 }); if (gen === generation.current) setAudit({ loading: false, loaded: true, error: "", rows }); } catch (x) { if (gen === generation.current) setAudit(a => ({ ...a, loading: false, loaded: true, error: x.message })); } }
    useEffect(() => {
        setState(s => ({ ...s, loading: true, access: null, catalog: [], policies: { roles: [], rules: [] }, grants: [], authorities: [], effective: [] }));
        setAudit({ loading: false, loaded: false, error: "", rows: [] });
        load();
        return () => { generation.current++; };
    }, [core.activeAssignment?.id, unit?.id, core.mfa.assuranceRevision, core.authorizationRevision, core.securityUncertain]);
    useEffect(() => { if (tab === "audit" && !audit.loaded && !audit.loading && state.access?.mfa_recent) loadAudit(); }, [tab, audit.loaded, state.access?.mfa_recent]); async function changed() { setAudit(a => ({ ...a, loaded: false })); await load(); }
    if (core.securityUncertain) return <div className="permissions_module"><section className="permissions_panel"><p role="status">Verificando permisos. Las acciones sensibles están pausadas temporalmente.</p></section></div>;
    if (!core.activeUnit?.is_control_plane) return <div className="permissions_module"><section className="permissions_panel"><h1>Permisos</h1><p>Este módulo está reservado a la unidad de Dirección.</p></section></div>;
    if (!real) return <div className="permissions_module"><section className="permissions_panel"><h1>Permisos</h1><p>Activa el backend real para usar este módulo.</p></section></div>;
    const access = state.access || {}, canManage = access.can_manage_role_policies || access.can_grant_access || access.can_revoke_access || access.can_delegate_authority, requestUnlock = () => core.mfa.enabled ? setUnlock(true) : core.mfa.open(), tabs = [["summary", "Resumen"], ...(access.can_manage_role_policies ? [["policies", "Políticas"]] : []), ...(access.can_grant_access || access.can_revoke_access || state.grants.length ? [["grants", "Accesos individuales"]] : []), ...(access.can_delegate_authority || state.authorities.length ? [["authorities", "Autoridades"]] : []), ...(access.can_read_audit ? [["audit", "Auditoría"]] : [])];
    return <div className="permissions_module"><header className="permissions_header"><div><span><ShieldCheck />Seguridad y acceso</span><h1>Permisos</h1><p>Consulta, asigna y audita el acceso de tu organización.</p></div><div className="permissions_header_actions">{canManage && <button className={access.mfa_recent ? "permissions_unlocked" : ""} onClick={() => !access.mfa_recent && requestUnlock()}><LockKeyhole />{access.mfa_recent ? "Edición desbloqueada" : core.mfa.enabled ? "Desbloquear edición" : "Configurar MFA"}</button>}<button aria-label="Actualizar" onClick={load}><RefreshCw /></button></div></header>{state.error && <div className="permissions_banner permissions_banner_error"><AlertTriangle />{state.error}</div>}{state.loading && <div className="permissions_banner">Cargando permisos…</div>}<nav className="permissions_tabs" role="tablist">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{id === "summary" && <KeyRound />}{label}</button>)}</nav>{!state.loading && tab === "summary" && <Summary state={state} units={core.units || []} unit={unit} setUnit={setUnit} go={setTab} />}{!state.loading && tab === "policies" && <Policies state={state} units={core.units || []} changed={changed} unlocked={access.mfa_recent} unlock={requestUnlock} roleId={policyRoleId} setRoleId={setPolicyRoleId} />}{!state.loading && tab === "grants" && <Records kind="grants" state={state} core={core} units={core.units || []} changed={changed} unlocked={access.mfa_recent && (access.can_grant_access || access.can_revoke_access)} unlock={requestUnlock} />}{!state.loading && tab === "authorities" && <Records kind="authorities" state={state} core={core} units={core.units || []} changed={changed} unlocked={access.mfa_recent && access.can_delegate_authority} unlock={requestUnlock} />}{!state.loading && tab === "audit" && <Audit audit={audit} load={loadAudit} />}{unlock && <Drawer title="Desbloquear edición" subtitle="Verificación MFA" close={() => setUnlock(false)}><Unlock done={async () => { setUnlock(false); await load(); }} /></Drawer>}</div>;
}
