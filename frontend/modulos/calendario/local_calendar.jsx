import {useEffect, useId, useMemo, useRef, useState} from "react";
import {AlignLeft, Check, ChevronDown, Clock3, MapPin, Plus, Search, Settings2, Trash2, Users, Video, X} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {confirmBold} from "../core/shared/bold_dialog.js";
import GoogleConnection from "../docs/google_connection.jsx";
import {TaskTextEditor} from "../tareas/src/task_text_editor.jsx";
import {TeamCalendarSharing} from "../tareas/src/team.jsx";
import {editorHTML, saveRichText} from "../tareas/src/rich_text.js";
import ColorPicker from "../core/shared/color_picker.jsx";
import {useAnchoredPopover} from "../core/shared/use_anchored_popover.js";
import {calendarCardColor, closestCalendarColor, addDays, dayKey, fromDay} from "./calendar_data.js";
import {localCalendarApi, localCalendarsApi} from "./calendar_api.js";

export function CalendarDialog({title, children, onClose, busy = false, quick = false, className = ""}) {
    const ref = useRef(null), titleId = useId();
    useEffect(() => {const dialog = ref.current; dialog.showModal(); return () => dialog.close();}, []);
    return <dialog ref={ref} className={`bold_calendar_native_dialog${quick ? " is_quick" : ""} ${className}`} aria-labelledby={titleId} onCancel={event => {event.preventDefault(); if (!busy) onClose();}} onClick={event => {if (event.target === event.currentTarget && !busy) onClose();}}><section className={`bold_calendar_editor${quick ? " is_quick" : ""}`}><header><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} aria-label="Cerrar" onClick={onClose}><X size={18}/></button></header>{children}</section></dialog>;
}

const datetimeInput = value => {
    const date = new Date(value);
    return `${dayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

function CalendarPeoplePicker({people, value, onChange, disabled}) {
    const [open, setOpen] = useState(false), [query, setQuery] = useState("");
    const root = useRef(null), trigger = useRef(null), panel = useRef(null), id = useId();
    useAnchoredPopover(open, trigger, panel, {minWidth: 220, maxHeight: 280});
    useEffect(() => {
        if (!open) {setQuery(""); return;}
        panel.current?.querySelector("input")?.focus();
        const outside = event => {if (!root.current?.contains(event.target)) setOpen(false);};
        const escape = event => {if (event.key === "Escape" && root.current?.contains(event.target)) {event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); trigger.current?.focus();}};
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape, true);
        return () => {document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true);};
    }, [open]);
    const normalize = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
    const matches = people.filter(person => normalize(`${person.name || ""} ${person.email}`).includes(normalize(query)));
    return <div className="bold_calendar_people_picker" ref={root} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}}>
        <button ref={trigger} type="button" className="bold_calendar_people_trigger" disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}><span>{value.length ? `${value.length} personas añadidas` : "Añadir personas del calendario"}</span><ChevronDown size={16}/></button>
        {open && <div ref={panel} id={id} popover="manual" className="bold_calendar_people_menu" role="group" aria-label="Personas del calendario">
            <label className="bold_calendar_people_search"><Search size={16} aria-hidden="true"/><input autoFocus type="search" aria-label="Buscar personas del calendario" placeholder="Buscar nombre o correo" value={query} onChange={event => setQuery(event.target.value)}/></label>
            <div className="bold_calendar_people_options">{matches.map(person => <label key={person.email} className="bold_calendar_person_option"><input type="checkbox" disabled={disabled} checked={value.includes(person.email)} onChange={event => onChange(event.target.checked ? [...value, person.email] : value.filter(email => email !== person.email))}/><span><strong>{person.name || person.email}</strong><small>{person.email}</small></span></label>)}{!matches.length && <p role="status">No hay coincidencias.</p>}</div>
            <footer><small>Solo personas con acceso al calendario.</small><button type="button" onClick={() => {setOpen(false); trigger.current?.focus();}}>Listo</button></footer>
        </div>}
    </div>;
}

export function LocalEventEditor({calendar, event, date, endDate, onClose, onSaved, DateTimeField, initialKind = "event", apiOverride, google = false, onEvent, onUntimed}) {
    const api = useMemo(() => apiOverride || localCalendarApi(calendar.id), [calendar.id, apiOverride]);
    const [expanded, setExpanded] = useState(false);
    const [form, setForm] = useState(() => ({
        summary: event?.summary || "", description: saveRichText(event?.description || ""), location: event?.location || "",
        allDay: Boolean(event?.start?.date),
        start: event?.start?.date || datetimeInput(event?.start?.dateTime || date),
        end: event?.end?.date ? dayKey(addDays(fromDay(event.end.date), -1)) : datetimeInput(event?.end?.dateTime || endDate || new Date(date.getTime() + 3600000)),
        attendees: (event?.attendees || []).map(row => row.email), colorId: event?.colorId || "7", color: calendarCardColor(event || {colorId:"7"}), hangoutLink: event?.hangoutLink || "", kind: event?.kind || initialKind, completed: event?.completed || false,
    }));
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [authorizeMeet, setAuthorizeMeet] = useState(false);
    const set = (key, value) => setForm(current => ({...current, [key]: value}));
    async function save(submit) {
        submit.preventDefault(); setBusy(true); setError("");
        try {
            const start = form.allDay ? {date: form.start.slice(0, 10)} : {dateTime: new Date(form.start).toISOString()};
            const end = form.allDay ? {date: dayKey(addDays(fromDay(form.end.slice(0, 10)), 1))} : {dateTime: new Date(form.end).toISOString()};
            const body = {summary: form.summary, description: google ? editorHTML(form.description) : form.description, location: form.location, start, end, colorId: closestCalendarColor(form.color), color: form.color, ...(!google ? {hangoutLink: form.hangoutLink} : {}), attendees: form.attendees.map(email => ({email})), kind: form.kind, completed: form.completed};
            if (event) await api.update(event.id, "instance", body); else await api.create(body);
            onSaved();
        } catch (problem) {setError(problem.message); setBusy(false);}
    }
    async function meet() {
        setBusy(true); setError("");
        try {const result = await api.meet(); set("hangoutLink", result.hangoutLink); setAuthorizeMeet(false);}
        catch (problem) {setError(problem.message); if ([403, 409].includes(problem.status)) setAuthorizeMeet(true);}
        finally {setBusy(false);}
    }
    return <CalendarDialog title={event ? (form.kind === "task" ? "Editar tarea" : "Editar evento") : (form.kind === "task" ? "Tarea nueva" : "Evento nuevo")} onClose={onClose} busy={busy} quick={!expanded}>
        {error && <p className="bold_calendar_error" role="alert">{error}</p>}
        <form onSubmit={save} className="bold_calendar_local_form"><fieldset disabled={busy}>
            <input className="bold_calendar_quick_title" aria-label="Título" placeholder="Añade un título" required maxLength={200} autoFocus value={form.summary} onChange={e => set("summary", e.target.value)}/>
            <div className="bold_calendar_quick_type" role="group" aria-label="Tipo"><button type="button" aria-pressed={form.kind === "event"} disabled={google && Boolean(event)} onClick={() => onEvent ? onEvent() : set("kind", "event")}>Evento</button><button type="button" aria-pressed={form.kind === "task"} onClick={() => set("kind", "task")}>Tarea</button></div>
            <div className="bold_calendar_quick_field"><Clock3 size={18}/><div className="bold_calendar_local_dates"><label>Inicio<DateTimeField required value={form.start} withTime={!form.allDay} onChange={value => set("start", value)}/></label><label>Fin<DateTimeField required value={form.end} withTime={!form.allDay} onChange={value => set("end", value)}/></label></div></div>
            {form.kind === "event" && <><div className="bold_calendar_quick_field"><Users size={18}/><CalendarPeoplePicker people={calendar.members} value={form.attendees} onChange={value => set("attendees", value)} disabled={busy}/></div>
            <div className="bold_calendar_quick_field"><Video size={18}/>{form.hangoutLink ? <div className="bold_calendar_meet_link"><a href={form.hangoutLink} target="_blank" rel="noreferrer">Unirse con Google Meet</a><button type="button" aria-label="Quitar Meet" onClick={() => set("hangoutLink", "")}><X size={16}/></button></div> : <button type="button" onClick={meet} disabled={busy}>{busy ? "Preparando enlace…" : "Añadir videoconferencia de Google Meet"}</button>}</div>
            <div className="bold_calendar_quick_field"><MapPin size={18}/><input aria-label="Ubicación" placeholder="Añadir ubicación" maxLength={8000} value={form.location} onChange={e => set("location", e.target.value)}/></div></>}
            <div className="bold_calendar_quick_field"><AlignLeft size={18}/><TaskTextEditor label="Descripción" placeholder="Añadir descripción" value={form.description} maxLength={20000} onChange={value => set("description", value)} disabled={busy}/></div>
            {expanded && <div className="bold_calendar_more_options"><label className="bold_calendar_check"><input type="checkbox" checked={form.allDay} onChange={e => setForm(current => ({...current, allDay: e.target.checked, start: e.target.checked ? current.start.slice(0, 10) : `${current.start.slice(0, 10)}T09:00`, end: e.target.checked ? current.end.slice(0, 10) : `${current.end.slice(0, 10)}T10:00`}))}/> Todo el día</label><div className="bold_calendar_color_field"><span>Color de la tarjeta</span><ColorPicker label="Color de la tarjeta" value={form.color} disabled={busy} onChange={value => set("color", value)}/><code>{form.color}</code></div>{!google && form.kind === "event" && <label>Enlace de Google Meet<input type="url" placeholder="https://meet.google.com/xxx-xxxx-xxx" value={form.hangoutLink} onChange={e => set("hangoutLink", e.target.value)}/></label>}</div>}
            <small>{google ? "Se mostrará con su horario en Google Calendar como bloque de tarea. No es una tarea nativa de Google Tasks." : `${calendar.name} · Guardado únicamente en BOLD`}</small>
            {google && !event && onUntimed && <button type="button" onClick={onUntimed}>Crear en Google Tasks sin horario</button>}
        </fieldset><footer><button type="button" onClick={() => setExpanded(value => !value)} disabled={busy}>{expanded ? "Menos opciones" : "Más opciones"}</button><button className="is_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar"}</button></footer></form>
        {authorizeMeet && <GoogleConnection service="meet" onConnected={() => {setAuthorizeMeet(false); setError("Google actualizado. Pulsa Crear enlace de Meet para continuar.");}}/>}
    </CalendarDialog>;
}

function CalendarSettings({calendar, onClose, onChanged}) {
    const core = useCore();
    const [name, setName] = useState(calendar?.name || ""), [email, setEmail] = useState(""), [role, setRole] = useState("reader");
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [query, setQuery] = useState(""), [people, setPeople] = useState(core.directory || []), [loadingPeople, setLoadingPeople] = useState(false);
    useEffect(() => {
        let active = true;
        if (calendar && core.refreshDirectory) {
            setLoadingPeople(true);
            core.refreshDirectory().then(rows => {if (active) setPeople(rows);}).catch(() => {if (active) setError("No se pudo actualizar el directorio. Cierra y vuelve a abrir para reintentar.");}).finally(() => {if (active) setLoadingPeople(false);});
        }
        return () => {active = false;};
    }, [calendar?.id, core.refreshDirectory]);
    async function perform(action) {setBusy(true); setError(""); try {await action(); await onChanged();} catch (problem) {setError(problem.message);} finally {setBusy(false);}}
    const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
    const members = new Set((calendar?.members || []).map(row => row.email.toLowerCase()));
    const directory = [...new Map(people.filter(row => row.email && !members.has(row.email.toLowerCase())).map(row => [row.email.toLowerCase(), row])).values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "es"));
    const matches = directory.filter(person => normalize(`${person.name || ""} ${person.email}`).includes(normalize(query)));
    return <CalendarDialog className="bold_calendar_settings" title={calendar ? "Configurar calendario" : "Crear calendario"} onClose={onClose} busy={busy}>
        {error && <p role="alert" className="bold_calendar_error">{error}</p>}
        <form className="bold_calendar_local_form" onSubmit={e => {e.preventDefault(); perform(async () => {if (calendar) await localCalendarsApi.rename(calendar.id, name); else await localCalendarsApi.create(name); onClose();});}}>
            <label>Nombre<input required maxLength={120} value={name} disabled={busy || calendar?.protected} onChange={e => setName(e.target.value)}/></label>
            {!calendar && <p>Será privado hasta que añadas personas. Sus eventos se guardan en BOLD.</p>}
            {!calendar?.protected && <footer><button className="is_primary" disabled={busy || !name.trim()}>{calendar ? "Guardar nombre" : "Crear calendario"}</button></footer>}
        </form>
        {calendar && <div className="bold_calendar_local_form"><h3>Personas con acceso</h3><div className="bold_calendar_member_list">{calendar.members.map(person => <div key={person.email}><span><strong>{person.name || person.email}</strong><small>{person.email}</small></span>{person.role === "owner" ? <small>Propietario</small> : <><label><span className="task_page_title_sr">Permiso de {person.name || person.email}</span><select disabled={busy} value={person.role} onChange={e => perform(() => localCalendarsApi.member(calendar.id, {email: person.email, role: e.target.value}))}><option value="reader">Lectura</option><option value="editor">Edición</option><option value="manager">Administración</option></select></label><button disabled={busy} type="button" aria-label={`Quitar acceso de ${person.name || person.email}`} onClick={async () => {if (await confirmBold(`¿Quitar el acceso de ${person.name || person.email} a este calendario?`)) perform(() => localCalendarsApi.member(calendar.id, {email: person.email, role: "remove"}));}}><X size={16}/></button></>}</div>)}</div>
            <form className="bold_calendar_add_person" onSubmit={e => {e.preventDefault(); if (!directory.some(person => person.email.toLowerCase() === email.toLowerCase())) return; perform(async () => {await localCalendarsApi.member(calendar.id, {email, role}); setEmail(""); setQuery("");});}}>
                <label>Añadir persona de BOLD<input type="search" aria-label="Buscar persona de BOLD" autoComplete="off" value={query} disabled={busy} onChange={e => {setQuery(e.target.value);setEmail(directory.find(person => person.email.toLowerCase() === e.target.value.trim().toLowerCase())?.email || "");}} placeholder="Busca nombre o correo interno"/></label>
                {loadingPeople && <small role="status">Actualizando personas…</small>}
                <div className="bold_calendar_person_results" role="group" aria-label="Personas de BOLD disponibles">{matches.map(person => <button type="button" key={person.email} disabled={busy} aria-pressed={email === person.email} onClick={() => {setEmail(person.email);setQuery(person.email);}}><span><strong>{person.name || person.email}</strong><small>{person.email}</small></span>{email === person.email && <Check size={16} aria-hidden="true"/>}</button>)}{!matches.length && !loadingPeople && <p role="status">No hay personas disponibles que coincidan.</p>}</div>
                <div className="bold_calendar_add_person_actions"><label>Permiso<select disabled={busy} value={role} onChange={e => setRole(e.target.value)}><option value="reader">Lectura</option><option value="editor">Edición</option><option value="manager">Administración</option></select></label><button disabled={busy || !email} type="submit"><Plus size={16}/> Añadir persona</button></div>
            </form>
            {calendar.can_delete && <button type="button" className="bold_calendar_delete" disabled={busy} onClick={async () => {if (await confirmBold(`¿Eliminar «${calendar.name}»? También se eliminarán sus eventos para todas las personas con acceso. Esta acción no se puede deshacer.`)) perform(async () => {await localCalendarsApi.remove(calendar.id); onClose();});}}><Trash2 size={16}/> Eliminar calendario</button>}
            {calendar.protected && <p>Calendario producción es permanente y no se puede eliminar.</p>}
        </div>}
    </CalendarDialog>;
}

function NativeTeamSharing({calendar, onChanged}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [shared, setShared] = useState(Boolean(calendar?.share_team));
    useEffect(() => setShared(Boolean(calendar?.share_team)), [calendar?.share_team]);
    async function toggle(value) {
        setBusy(true); setError("");
        try {
            const result = await localCalendarsApi.shareTeam(calendar.id, value);
            setShared(result.share_team);
            await onChanged();
        } catch (problem) {setError(problem.message);} finally {setBusy(false);}
    }
    return <div className="team_calendar_sharing"><label title="Publica títulos y horarios de este calendario en tu perfil de Equipo. Los eventos privados aparecen como Ocupado. No concede acceso para editar."><Users size={15}/><span>Compartir agenda</span><input type="checkbox" role="switch" aria-label="Compartir esta agenda con Equipo" checked={shared} disabled={!calendar?.can_manage || busy} onChange={event => toggle(event.target.checked)}/></label>{busy && <small role="status">Guardando…</small>}{error && <small role="alert">{error}</small>}</div>;
}

export function CalendarSources({selected, onSelect, calendars, onChanged}) {
    const core = useCore(), tabs = useRef(null);
    const [settings, setSettings] = useState(false);
    const calendar = calendars.find(row => row.id === selected);
    const rows = [{id:"google", name:"BOLD"}, ...calendars];
    useEffect(() => {tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:"nearest", inline:"nearest"});}, [selected]);
    useEffect(() => {if (settings !== "new" && !calendar?.can_manage) setSettings(false);}, [calendar?.can_manage]);
    function tabKey(event, index) {
        const next = event.key === "ArrowRight" ? (index + 1) % rows.length : event.key === "ArrowLeft" ? (index - 1 + rows.length) % rows.length : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onSelect(rows[next].id); tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus();
    }
    return <div className="bold_calendar_switcher"><div className="bold_calendar_tab_scroll" ref={tabs}><div className="bold_calendar_source_tabs" role="tablist" aria-label="Calendarios">{rows.map((row, index) => <button key={row.id} id={`calendar-tab-${row.id}`} role="tab" aria-selected={selected === row.id} aria-controls="bold-calendar-panel" tabIndex={selected === row.id ? 0 : -1} title={row.name} onKeyDown={event => tabKey(event, index)} onClick={() => onSelect(row.id)}>{row.name}</button>)}</div><button className="bold_calendar_add_tab" onClick={() => setSettings("new")} aria-label="Crear calendario" title="Crear calendario"><Plus size={18}/></button></div><div className="bold_calendar_fixed_share">{selected === "google" ? <TeamCalendarSharing assignmentId={core.activeAssignment?.id}/> : <><NativeTeamSharing key={calendar?.id} calendar={calendar} onChanged={onChanged}/><button disabled={!calendar?.can_manage} aria-label="Administrar acceso al calendario" title="Añadir personas y administrar acceso" onClick={() => setSettings(calendar.id)}><Settings2 size={16}/></button></>}</div>{settings && (settings === "new" || calendar) && <CalendarSettings key={settings} calendar={settings === "new" ? null : calendar} onClose={() => setSettings(false)} onChanged={onChanged}/>}</div>;
}
