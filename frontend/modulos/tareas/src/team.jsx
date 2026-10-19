import {createContext, useContext, useEffect, useRef, useState} from "react";
import {Eye, EyeOff, Users, CalendarDays, RefreshCw} from "lucide-react";
import {http} from "../../core/http_client.js";
import {backgroundRefresh} from "../../core/google_cache.js";
import {normalizeTask} from "./services/task_models.js";
import {sharingSelection} from "./team_sharing.js";
import {confirmBold} from "../../core/shared/bold_dialog.js";
import "./team.css";

const base = "/api/v2/my-team/";
export const TeamSharingContext = createContext(null);

export function useTeamSharing(assignmentId, enabled) {
    const [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const generation = useRef(0), revision = useRef(0), saving = useRef(false), refresh = useRef(null);
    useEffect(() => {
        const ticket = ++generation.current;
        const controller = new AbortController();
        setState(null); setBusy(false); setError(""); saving.current = false;
        if (!enabled || !assignmentId) return;
        const load = async () => {
            if (saving.current) return;
            const version = ++revision.current;
            try {
                const value = await http.request(`${base}self/`, {signal: controller.signal});
                if (ticket === generation.current && version === revision.current && !saving.current) { setState({assignmentId, ...value}); setError(""); }
            } catch (problem) {if (!controller.signal.aborted && ticket === generation.current && version === revision.current) setError(problem.message);}
        };
        refresh.current = load;
        load();
        const stop = backgroundRefresh(load, {interval: 60000});
        window.addEventListener("bold:team-sharing", load);
        return () => {controller.abort(); stop(); window.removeEventListener("bold:team-sharing", load); generation.current++; refresh.current = null;};
    }, [assignmentId, enabled]);
    async function update(body, method = "PUT") {
        if (saving.current || state?.assignmentId !== assignmentId) return;
        const ticket = generation.current;
        revision.current++;
        saving.current = true; setBusy(true); setError("");
        try {
            const value = await http.request(`${base}self/`, {method, body});
            if (ticket === generation.current) {setState({assignmentId, ...value}); window.dispatchEvent(new Event("bold:team-sharing"));}
        } catch (problem) {if (ticket === generation.current) setError(problem.message);}
        finally {if (ticket === generation.current) {saving.current = false; setBusy(false);}}
    }
    return {state: state?.assignmentId === assignmentId ? state : null, busy, error, update, retry: () => refresh.current?.()};
}

export function SharingEye({ids, label, section = false, groupLabel = "sección", disabled = false}) {
    const sharing = useContext(TeamSharingContext);
    const latest = useRef(sharing);
    latest.current = sharing;
    useEffect(() => {latest.current = sharing; return () => {latest.current = null;};}, [sharing]);
    if (!sharing || !ids.length) return null;
    const {targets, selected, partial} = sharingSelection(ids, sharing.state);
    const locked = !targets.length;
    const text = locked ? "Compartida con su tarea principal" : `${selected ? "Ocultar" : "Compartir"} ${section ? `tareas mostradas en la ${groupLabel}` : "tarea"} ${label} en Equipo`;
    const Icon = selected || partial ? Eye : EyeOff;
    async function toggle() {
        const assignmentId = sharing.state.assignmentId;
        if (!selected) {
            const subject = section ? `Las tareas mostradas de la ${groupLabel} «${label}» se publicarán` : `La tarea «${label}» se publicará`;
            const accepted = await confirmBold(`${subject} en tu perfil de Equipo para toda la empresa, en modo solo lectura. Se incluirán las subtareas accesibles, pero no los comentarios ni sus archivos. Puedes dejar de compartir con el mismo ojo. «No volver a mostrar» comparte y desactiva este aviso para próximas ocasiones.`, {
                title: "¿Compartir tareas en Equipo?",
                rememberKey: `bold_team_share_notice:${sharing.state.employee_id || assignmentId}`,
            });
            if (!accepted) return;
        }
        if (latest.current?.state?.assignmentId !== assignmentId) return;
        await latest.current.update({task_ids: targets, visible: !selected});
    }
    return <button type="button" className={`team_share_eye${selected ? " is_shared" : ""}${sharing.busy && sharing.state && !locked && !disabled ? " is_syncing" : ""}`} title={text} aria-label={text}
        aria-pressed={partial ? "mixed" : selected} disabled={disabled || sharing.busy || !sharing.state || locked}
        onKeyDown={event => event.stopPropagation()} onClick={event => {event.stopPropagation(); void toggle();}}>
        <Icon size={16} aria-hidden="true" />
    </button>;
}

function today() {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function useTeamQuery(path, refreshKey) {
    const [state, setState] = useState({path: null, value: null, error: "", loading: true});
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        if (!path) {setState({path, value: null, error: "", loading: false}); return;}
        setState({path, value: null, error: "", loading: true});
        let inFlight = false, rerun = false;
        async function load() {
            if (controller.signal.aborted) return;
            if (inFlight) {rerun = true; return;}
            inFlight = true;
            try {
                const value = await http.request(`${base}${path}`, {signal: controller.signal});
                if (!controller.signal.aborted) setState({path, value, error: "", loading: false});
            } catch (problem) {
                if (!controller.signal.aborted) setState({path, value: null, error: problem.message, loading: false});
            } finally {inFlight = false; if (rerun) {rerun = false; void load();}}
        }
        load();
        const stop = backgroundRefresh(load, {interval: 30000});
        window.addEventListener("bold:team-sharing", load);
        return () => {controller.abort(); stop(); window.removeEventListener("bold:team-sharing", load);};
    }, [path, retry, refreshKey]);
    return {...(state.path === path ? state : {value: null, error: "", loading: Boolean(path)}), retry: () => setRetry(value => value + 1)};
}

function QueryNotice({query}) {
    return query.loading ? <p role="status">Cargando…</p> : query.error ? <div role="alert"><p>{query.error}</p><button type="button" onClick={query.retry}>Reintentar</button></div> : null;
}

export function TeamCalendarSharing({assignmentId}) {
    const sharing = useTeamSharing(assignmentId, Boolean(assignmentId));
    const [requested, setRequested] = useState(null);
    async function toggle(value) {
        const intent = {assignmentId, value};
        setRequested(intent);
        await sharing.update({share_calendar: value}, "PATCH");
        setRequested(current => current === intent ? null : current);
    }
    return <div className="team_calendar_sharing">
        <label title="Comparte solo el nombre y horario de tus reuniones en Equipo. Las privadas se muestran como Ocupado.">
            <Users size={15} aria-hidden="true"/><span>Compartir agenda</span>
            <input type="checkbox" role="switch" aria-label="Compartir mi agenda con el equipo" checked={requested?.assignmentId === assignmentId ? requested.value : Boolean(sharing.state?.share_calendar)} disabled={!sharing.state || sharing.busy}
                onChange={event => toggle(event.target.checked)}/>
        </label>
        {sharing.busy && <small role="status">Guardando…</small>}
        {sharing.error && <small role="alert">{sharing.error} <button type="button" onClick={sharing.retry}>Reintentar</button></small>}
    </div>;
}

export default function TeamPanel({assignmentId, enabled, renderBoard, CalendarDateField}) {
    const directory = useTeamQuery(enabled ? "directory/" : null, assignmentId);
    const [person, setPerson] = useState(null), [view, setView] = useState("tasks"), [day, setDay] = useState(today);
    useEffect(() => {
        if (view !== "meetings") return;
        let currentDay = today(), timer;
        const refreshDay = () => {
            const nextDay = today();
            if (nextDay !== currentDay) {currentDay = nextDay; setDay(nextDay);}
            window.clearTimeout(timer);
            const midnight = new Date();
            midnight.setHours(24, 0, 0, 50);
            timer = window.setTimeout(refreshDay, midnight.getTime() - Date.now());
        };
        refreshDay();
        window.addEventListener("focus", refreshDay);
        document.addEventListener("visibilitychange", refreshDay);
        return () => {window.clearTimeout(timer); window.removeEventListener("focus", refreshDay); document.removeEventListener("visibilitychange", refreshDay);};
    }, [view]);
    const content = useTeamQuery(enabled && person ? `${person.id}/${view === "tasks" ? "board/" : `meetings/?date=${day}`}` : null, assignmentId);
    useEffect(() => {setPerson(null); setView("tasks");}, [assignmentId]);
    useEffect(() => {
        if (person && directory.value && !directory.value.departments.some(unit => unit.people.some(item => item.id === person.id))) setPerson(null);
    }, [directory.value, person]);
    const tasks = (content.value?.tasks || []).map(dto => ({...normalizeTask(dto), section: dto.stage || dto.section, ...(dto.stage_name ? {status:dto.stage_name,status_color:dto.stage_color} : {}), assignee_name: dto.assignee_name}));
    const meetingMessage = {hidden: "Esta persona no comparte su agenda.", disconnected: "Agenda no disponible. No indica que la persona esté libre.", unavailable: "No se pudo consultar la agenda completa."};
    const summary = view === "tasks" ? (content.value ? `${tasks.length} tareas compartidas` : "Consultando tareas compartidas…")
        : content.value?.state === "shared" ? `${content.value.meetings.length} reuniones del día`
        : content.value?.state === "hidden" ? "Agenda no compartida" : "Agenda no disponible";
    return <div className="team_panel">
        <aside className="team_directory" aria-label="Personas por departamento">
            <h2><Users size={18} aria-hidden="true"/> Equipo</h2>
            <QueryNotice query={directory}/>
            {!enabled && <p>Conecta con BOLD para consultar el equipo.</p>}
            {directory.value?.departments.filter(unit => unit.people.length).map(unit => <details key={unit.id}>
                <summary>{unit.name}<span>{unit.people.length}</span></summary>
                <div>{unit.people.length ? unit.people.map(item => <button type="button" key={item.id} aria-pressed={person?.id === item.id}
                    onClick={() => {setPerson(item); setView("tasks");}}>
                    <span className="team_person_initial" aria-hidden="true">{item.name.slice(0, 1)}</span>{item.name}
                </button>) : <p>Sin integrantes activos</p>}</div>
            </details>)}
        </aside>
        <section className="team_workspace" aria-label="Trabajo compartido">
            {person ? <>
                <div className="team_profile_bar">
                <header className="team_profile_header"><div><h2>{person.name}</h2><p>Solo lectura · {summary}</p></div>
                    <button type="button" aria-label="Actualizar perfil" onClick={content.retry}><RefreshCw size={17} aria-hidden="true"/></button>
                </header>
                <nav className="team_profile_tabs" aria-label="Contenido de la persona">
                    <button type="button" aria-pressed={view === "tasks"} onClick={() => {setView("tasks");}}>Tareas</button>
                    <button type="button" aria-pressed={view === "meetings"} onClick={() => {setDay(today()); setView("meetings");}}>Reuniones</button>
                    {view === "meetings" && <div className="team_meeting_date"><span>Día</span><CalendarDateField ariaLabel="Día de reuniones" required value={day} onChange={setDay}/></div>}
                </nav>
                </div>
                <QueryNotice query={content}/>
                {content.value && view === "tasks" && <div className="team_board_split">
                    <section className="team_named_board" aria-label={`Tablero ${content.value.board_name || "Mis tareas"}`}>
                        <header><div><span className="team_board_caption">Tablero</span><h3>{content.value.board_name || "Mis tareas"}</h3></div><span>{tasks.length} tareas</span></header>
                        {tasks.length ? <TeamSharingContext.Provider value={null}>{renderBoard({readOnly: true, filtered_tasks: tasks,
                            board_columns: content.value.stages || content.value.sections})}</TeamSharingContext.Provider>
                            : <p className="team_empty">Todavía no comparte tareas.</p>}
                    </section>
                </div>}
                {content.value && view === "meetings" && <div className="team_meetings">
                    {content.value.state !== "shared" ? <p>{meetingMessage[content.value.state]}</p>
                        : !content.value.meetings.length ? <p>Sin reuniones programadas para este día.</p>
                        : content.value.meetings.map(meeting => <article key={meeting.id}><CalendarDays size={20} aria-hidden="true"/><div><h3>{meeting.title}</h3><p>
                            {new Date(meeting.start).toLocaleTimeString("es", {hour: "2-digit", minute: "2-digit", timeZone: content.value.time_zone})} – {new Date(meeting.end).toLocaleTimeString("es", {hour: "2-digit", minute: "2-digit", timeZone: content.value.time_zone})}
                        </p></div></article>)}
                </div>}
            </> : <div className="team_empty"><Users size={36} aria-hidden="true"/><h2>Consulta el trabajo compartido por el equipo</h2><p>Revisa las tareas y reuniones compartidas para conocer mejor la carga de trabajo y disponibilidad de cada persona. Despliega un departamento y selecciona a alguien para comenzar.</p></div>}
        </section>
    </div>;
}
