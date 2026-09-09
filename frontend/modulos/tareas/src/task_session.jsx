import { useEffect, useRef, useState } from "react";
import { api, is_using_real_backend } from "./services/api_client.js";
import { disconnect_realtime_stream } from "./services/realtime_adapter.js";
import { normalizeAssignment, selectAssignment } from "./services/task_models.js";
import { setPresentationData } from "./services/presentation_data.js";

function readSession() { try { return JSON.parse(sessionStorage.getItem("bold_v2_session")) || {}; } catch { return {}; } }

export default function TaskSession({ children }) {
    const [account, setAccount] = useState(null), [assignments, setAssignments] = useState([]), [active, setActive] = useState("");
    const [busy, setBusy] = useState(is_using_real_backend()), [error, setError] = useState("");
    const generation = useRef(0);
    function logout() {
        generation.current++;
        disconnect_realtime_stream(); api.setToken(null); setPresentationData(null);
        sessionStorage.removeItem("bold_v2_session");
        setAccount(null); setAssignments([]); setActive(""); setBusy(false);
    }
    function choose(id) {
        disconnect_realtime_stream(); api.setAssignment(id || null); setPresentationData(null);
        setActive(id); setError("");
        sessionStorage.setItem("bold_v2_session", JSON.stringify(api.getSession()));
    }
    async function restore(savedId) {
        const version = generation.current;
        const ownAccount = await api.getCurrentAccount();
        const own = await api.listOwnAssignments(ownAccount);
        const directory = (await api.listAssignmentDirectory()).map(normalizeAssignment);
        if (version !== generation.current) return;
        const available = directory.filter(item => own.some(row => row.id === item.id));
        setAccount(ownAccount); setAssignments(available);
        choose(selectAssignment(available, savedId));
        if (!available.length) setError("Tu cuenta no tiene asignaciones activas. Contacta al administrador.");
    }
    useEffect(() => {
        if (!is_using_real_backend()) return;
        let mounted = true;
        const saved = readSession();
        if (saved.token && saved.email) {
            api.setToken(saved.token, saved.email);
            restore(saved.assignmentId).catch(err => { if (mounted && err.name !== "AbortError") setError(err.message); }).finally(() => { if (mounted) setBusy(false); });
        } else setBusy(false);
        window.addEventListener("bold:unauthorized", logout);
        return () => { mounted = false; generation.current++; api.cancelRequests(); disconnect_realtime_stream(); window.removeEventListener("bold:unauthorized", logout); };
    }, []);
    if (!is_using_real_backend()) return children(null);
    async function login(event) {
        event.preventDefault(); setBusy(true); setError("");
        const form = new FormData(event.currentTarget);
        try { await api.login(form.get("email"), form.get("password")); await restore(); }
        catch (err) { if (err.name !== "AbortError") setError(err.message); }
        finally { setBusy(false); }
    }
    if (!account || !active) return <div className="bold_modal_backdrop"><div className="bold_modal_window" role="dialog" aria-label="Iniciar sesión">
        <div className="bold_modal_header"><h2>Bold · Tareas</h2></div>
        <form className="bold_modal_body" onSubmit={login}>
            {error && <p role="alert" style={{ whiteSpace: "pre-wrap", color: "#c22" }}>{error}</p>}
            {!account ? <><label>Correo<input className="bold_text_input" name="email" type="email" autoComplete="username" required /></label><label>Contraseña<input className="bold_text_input" name="password" type="password" autoComplete="current-password" required /></label><button className="primary_button" disabled={busy}>{busy ? "Cargando…" : "Iniciar sesión"}</button></> : <>
                <label>Selecciona tu cargo<select className="bold_select_input" value={active} onChange={event => choose(event.target.value)}><option value="">Seleccionar asignación</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.job_role_title} · {item.unit_name}</option>)}</select></label>
                <button type="button" className="secondary_button" onClick={logout}>Cerrar sesión</button>
            </>}
        </form></div></div>;
    return children({ account, assignments, active, choose, logout });
}
