import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { http, is_using_real_backend } from "./http_client.js";
import { coreApi } from "./core_api.js";
import { normalizeAssignment, selectAssignment } from "./core_models.js";
import { getCoreState, subscribeCore, updateCore, clearCore } from "./core_store.js";
const CoreContext = createContext(null);
export function useCore() {
    const core = useContext(CoreContext);
    if (!core) throw new Error("useCore requiere CoreProvider.");
    return core;
}
function readSession() { try { return JSON.parse(sessionStorage.getItem("bold_v2_session")) || {}; } catch { return {}; } }
function persistSession() { sessionStorage.setItem("bold_v2_session", JSON.stringify(http.getSession())); }
export function CoreProvider({ children, mockIdentity, loginTitle = "Bold" }) {
    const state = useSyncExternalStore(subscribeCore, getCoreState);
    const generation = useRef(0);
    const permissionCache = useRef(new Map());
    const real = is_using_real_backend();
    function logout() {
        generation.current++;
        http.setToken(null);
        permissionCache.current.clear();
        sessionStorage.removeItem("bold_v2_session");
        clearCore();
    }
    function setActiveAssignment(id) {
        const assignment = getCoreState().assignments.find(item => item.id === id) || null;
        http.setAssignment(assignment?.id || null);
        permissionCache.current.clear();
        updateCore({ activeAssignment: assignment, error: "", sessionStatus: assignment ? "ready" : "selecting" });
        persistSession();
    }
    async function restore(savedId) {
        const version = generation.current;
        const account = await coreApi.getCurrentAccount();
        const [employee, own, rawDirectory, units] = await Promise.all([
            coreApi.getEmployee(account.employee), coreApi.listOwnAssignments(account), coreApi.listAssignmentDirectory(), coreApi.listUnits()
        ]);
        if (version !== generation.current) return;
        const directory = rawDirectory.map(normalizeAssignment);
        const assignments = directory.filter(item => own.some(row => row.id === item.id));
        updateCore({ account, employee, directory, assignments, units });
        setActiveAssignment(selectAssignment(assignments, savedId));
        if (!assignments.length) updateCore({ error: "Tu cuenta no tiene asignaciones activas. Contacta al administrador." });
    }
    async function can(permissionCode, unitId = getCoreState().activeUnit?.id, resourceId) {
        const assignment = getCoreState().activeAssignment?.id;
        if (!assignment) return false;
        const key = JSON.stringify([assignment, permissionCode, unitId, resourceId]);
        if (!permissionCache.current.has(key)) {
            const result = coreApi.authorize({ assignment, permission_code: permissionCode, target_unit: unitId, ...(resourceId ? { resource_id: resourceId } : {}) }).then(result => !!result.allowed);
            permissionCache.current.set(key, result);
            result.catch(() => { if (permissionCache.current.get(key) === result) permissionCache.current.delete(key); });
        }
        return permissionCache.current.get(key);
    }
    useEffect(() => {
        if (!real) { updateCore({ ...mockIdentity, sessionStatus: "ready" }); return () => clearCore(); }
        let mounted = true;
        clearCore(); updateCore({ sessionStatus: "loading" });
        window.addEventListener("bold:unauthorized", logout);
        const saved = readSession();
        if (saved.token && saved.email) {
            http.setToken(saved.token, saved.email);
            restore(saved.assignmentId).catch(error => {
                if (mounted && error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" });
            });
        } else updateCore({ sessionStatus: "anonymous" });
        return () => { mounted = false; generation.current++; http.setToken(null); clearCore(); permissionCache.current.clear(); window.removeEventListener("bold:unauthorized", logout); };
    }, []);
    async function login(event) {
        event.preventDefault(); updateCore({ sessionStatus: "loading", error: "" });
        const form = new FormData(event.currentTarget);
        try { await coreApi.login(form.get("email"), form.get("password")); await restore(); }
        catch (error) { if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    const { account, assignments, error } = state;
    const active = state.activeAssignment?.id || "", busy = state.sessionStatus === "loading";
    if (real && (!account || !active)) return <div className="bold_modal_backdrop"><div className="bold_modal_window" role="dialog" aria-label="Iniciar sesión">
        <div className="bold_modal_header"><h2>{loginTitle}</h2></div>
        <form className="bold_modal_body" onSubmit={login}>
            {error && <p role="alert" style={{ whiteSpace: "pre-wrap", color: "#c22" }}>{error}</p>}
            {!account ? <><label>Correo<input className="bold_text_input" name="email" type="email" autoComplete="username" required /></label><label>Contraseña<input className="bold_text_input" name="password" type="password" autoComplete="current-password" required /></label><button className="primary_button" disabled={busy}>{busy ? "Cargando…" : "Iniciar sesión"}</button></> : <>
                <label>Selecciona tu cargo<select className="bold_select_input" value={active} onChange={event => setActiveAssignment(event.target.value)}><option value="">Seleccionar asignación</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.job_role_title} · {item.unit_name}</option>)}</select></label>
                <button type="button" className="secondary_button" onClick={logout}>Cerrar sesión</button>
            </>}
        </form></div></div>;
    if (state.sessionStatus !== "ready") return null;
    const value = { ...state, ...http.getSession(), setActiveAssignment, logout, permissions: { can } };
    return <CoreContext.Provider value={value}>{children}</CoreContext.Provider>;
}
