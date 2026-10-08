import { TaskTextEditor } from "../tareas/src/task_text_editor.jsx";
import {useCore} from "../core/core_provider.jsx";
import {moduleCache, moduleScope} from "../core/module_cache.js";
import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {useEffect, useRef, useState} from "react";
import {CircleUserRound} from "lucide-react";
import {http} from "../core/http_client.js";
import {presenceLabels, presenceDurations, presencePatch, editablePresenceStatuses} from "../core/shared/presence.js";
import "../core/shared/presence.css";

export default function PresencePreferences() {
    const cacheScope = moduleScope(useCore());
    const [draft, setDraft] = useState(() => moduleCache.read(cacheScope, "presence-settings")), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [refreshing, setRefreshing] = useState(false), draftRef = useRef(draft); draftRef.current = draft;
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true; const controller = new AbortController(), previous = draftRef.current, cacheGeneration = moduleCache.generation; setRefreshing(true);
        http.request("/api/v2/auth/presence/", {signal: controller.signal}).then(value => {if (alive.current) {if (draftRef.current === previous) {setDraft(value); moduleCache.write(cacheScope, "presence-settings", value, cacheGeneration);}}}).catch(problem => {if (alive.current && problem.name !== "AbortError") setError(problem.message);}).finally(() => {if (!controller.signal.aborted) setRefreshing(false);});
        return () => {alive.current = false; controller.abort();};
    }, []);
    async function save(event) {
        event.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
        try {
            const value = await http.request("/api/v2/auth/presence/", {method: "PATCH", body: presencePatch(draft)});
            if (alive.current) {draftRef.current = value; setDraft(value); moduleCache.write(cacheScope, "presence-settings", value); setNotice("Tu estado se guardó. Se mostrará en tus conexiones activas.");}
        } catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    return <section className="bold_presence_preferences"><BackgroundSyncNotice active={refreshing} label="Actualizando disponibilidad…" /><h2><CircleUserRound size={22}/>Mi disponibilidad</h2><p>Comparte con tus compañeros si es un buen momento para contactarte.</p>{error && <p className="bold_profile_error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{!draft ? <div aria-busy={refreshing}>{error && "Vuelve a abrir este apartado para reintentar."}</div> : <form onSubmit={save}>
        <fieldset disabled={busy}><legend>Estado</legend><div className="bold_presence_choices">{editablePresenceStatuses.map(id => <label key={id} className="bold_presence_choice"><input type="radio" name="presence-status" value={id} checked={draft.status === id} onChange={() => setDraft(value => ({...value, status: id}))}/><span className={`bold_presence_dot bold_presence_${id}`} aria-hidden="true"/>{presenceLabels[id]}</label>)}</div>
        {draft.status === "custom" && <><label>Título<input required maxLength={60} value={draft.title} placeholder="Por ejemplo: trabajando en una entrega" onChange={event => setDraft({...draft, title: event.target.value})}/></label><label>Descripción breve<TaskTextEditor compact label="Descripción breve" maxLength={160} value={draft.description} placeholder="Una indicación útil para tus compañeros" disabled={busy} onChange={value => setDraft({...draft, description: value})}/></label></>}
        {["away", "busy"].includes(draft.status) && <label>Duración<select value={draft.duration_minutes || 0} onChange={event => setDraft({...draft, duration_minutes: Number(event.target.value)})}>{presenceDurations.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select><small>Al vencer, volverás a En línea (o En reunión si Calendar lo detecta). Guardar reinicia esta duración.</small></label>}
        <label className="bold_presence_choice"><input type="checkbox" checked={draft.calendar_automatic} onChange={event => setDraft({...draft, calendar_automatic: event.target.checked})}/>Usar “En reunión” automáticamente con Google Calendar</label>
        <small>Requiere conectar tu calendario personal en Conectores. Se detectan eventos con invitados o videollamada durante su horario, no eventos de día completo. Solo se comparte el estado: nunca el título, los invitados ni el enlace de la reunión. Vacaciones tiene prioridad.</small></fieldset>
        <p>En reunión se determina automáticamente mediante Calendar. Sin conexión activa se te considera desconectado y no apareces en la lista de equipo conectado.</p><button type="submit" className="bold_profile_primary" disabled={busy}>{busy ? "Guardando…" : "Guardar estado"}</button>
    </form>}</section>;
}
