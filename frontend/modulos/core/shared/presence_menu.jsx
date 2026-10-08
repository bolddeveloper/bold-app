import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {Check, ChevronRight, X} from "lucide-react";
import {http} from "../http_client.js";
import {presenceDurations, presenceLabels, quickPresenceStatuses} from "./presence.js";
import "./presence.css";

// Fixed submenus stay inside the profile dialog's DOM: its focus trap and
// outside-click boundary include every level, even across the visual gap.
export function useProfileSubmenuPosition(panel, trigger, dependency) {
    const [position, setPosition] = useState({left: 12, top: 12});
    useLayoutEffect(() => {
        function place() {
            if (!panel.current || !trigger.current) return;
            const button = trigger.current.getBoundingClientRect(), viewport = window.visualViewport;
            const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
            const right = left + (viewport?.width || window.innerWidth), bottom = top + (viewport?.height || window.innerHeight);
            const width = panel.current.offsetWidth, height = panel.current.offsetHeight;
            const parent = trigger.current.closest(".bold_profile_submenu, .bold_profile_popover").getBoundingClientRect();
            const x = parent.right + width + 8 <= right - 12 ? parent.right + 8 : parent.left - width - 8;
            setPosition({left: Math.max(left + 12, Math.min(x, right - width - 12)), top: Math.max(top + 12, Math.min(button.top, bottom - height - 12))});
        }
        place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true); window.visualViewport?.addEventListener("resize", place);
        return () => {window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.visualViewport?.removeEventListener("resize", place);};
    }, [dependency, panel, trigger]);
    return position;
}

export default function PresenceMenu({trigger, close, configure, dark}) {
    const panel = useRef(null), durationPanel = useRef(null), durationTrigger = useRef(null), timer = useRef(null), alive = useRef(true), saving = useRef(false);
    const [draft, setDraft] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [duration, setDuration] = useState(null), [notice, setNotice] = useState("");
    const position = useProfileSubmenuPosition(panel, trigger, `${!!draft}:${error}:${notice}:${busy}`);
    const durationPosition = useProfileSubmenuPosition(durationPanel, durationTrigger, `${duration}:${error}`);
    useEffect(() => {
        alive.current = true; const controller = new AbortController();
        http.request("/api/v2/auth/presence/", {signal: controller.signal}).then(value => {if (alive.current) setDraft(value);}).catch(problem => {if (alive.current && problem.name !== "AbortError") setError(problem.message);});
        return () => {alive.current = false; controller.abort(); clearTimeout(timer.current);};
    }, []);
    const keep = () => clearTimeout(timer.current);
    const leave = () => {keep(); timer.current = setTimeout(() => setDuration(null), 250);};
    function openDuration(event, status) {keep(); durationTrigger.current = event.currentTarget; setDuration(status);}
    async function choose(status, minutes = 0) {
        if (saving.current || !draft) return;
        saving.current = true; setBusy(true); setError(""); setNotice("");
        try {
            const value = await http.request("/api/v2/auth/presence/", {method: "PATCH", body: {status, duration_minutes: minutes}});
            if (alive.current) {setDraft(value); setDuration(null); durationTrigger.current?.focus(); setNotice(`Estado actualizado: ${presenceLabels[value.status]}.`);}
        } catch (problem) {if (alive.current) setError(problem.message);}
        finally {saving.current = false; if (alive.current) setBusy(false);}
    }
    return <aside ref={panel} className={`bold_profile_submenu ${dark ? "theme_dark" : ""}`} style={position} aria-label="Elegir disponibilidad" onKeyDown={event => {if (event.key === "Escape") {event.stopPropagation(); duration ? setDuration(null) : close(); trigger.current?.focus();}}}>
        <header><h3>Mi disponibilidad</h3><button type="button" aria-label="Cerrar disponibilidad" onClick={close}><X size={17}/></button></header>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!draft ? <p role="status">{error ? "Cierra y vuelve a abrir para reintentar." : "Cargando estado…"}</p> : <>
            {quickPresenceStatuses.map(status => {
                const label = presenceLabels[status];
                const timed = ["away", "busy"].includes(status);
                return <div key={status} onMouseEnter={keep} onMouseLeave={leave}>
                    <button type="button" disabled={busy} aria-pressed={draft.status === status} aria-expanded={timed ? duration === status : undefined} onMouseEnter={event => timed ? openDuration(event, status) : setDuration(null)} onClick={event => timed ? openDuration(event, status) : choose(status)} onKeyDown={event => {if (timed && event.key === "ArrowRight") {event.preventDefault(); openDuration(event, status); requestAnimationFrame(() => durationPanel.current?.querySelector("button")?.focus());}}}>
                        <span className={`bold_presence_dot bold_presence_${status}`} aria-hidden="true"/><span>{label}</span>{timed ? <ChevronRight size={16}/> : draft.status === status && <Check size={16}/>}
                    </button>
                    {duration === status && <aside ref={durationPanel} className={`bold_profile_submenu bold_presence_durations ${dark ? "theme_dark" : ""}`} style={durationPosition} aria-label={`Duración de ${label}`} onMouseEnter={keep} onMouseLeave={leave}>
                        <header><h3>{label} durante…</h3><button type="button" aria-label="Volver a estados" onClick={() => {setDuration(null); durationTrigger.current?.focus();}}><X size={17}/></button></header>
                        {error && <p role="alert">{error}</p>}
                        {presenceDurations.map(([minutes, text]) => <button type="button" disabled={busy} key={minutes} onClick={() => choose(status, minutes)}>{text}</button>)}
                    </aside>}
                </div>;
            })}
            {busy && <p role="status">Guardando estado…</p>}
            <button type="button" onMouseEnter={() => setDuration(null)} onClick={configure}><span>Más configuraciones del perfil</span><ChevronRight size={16}/></button>
        </>}
    </aside>;
}
