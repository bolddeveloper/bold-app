import {createContactSearch, mergeContactSuggestions} from "./contact_search.js";
import { googleCache, cacheScope, backgroundRefresh } from "../core/google_cache.js";
import GoogleConnection from "../docs/google_connection.jsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, MapPin, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, Users, Video, X } from "lucide-react";
import { useCore } from "../core/core_provider.jsx";
import { CalendarDateField } from "../tareas/src/task_app.jsx";
import { calendarApi } from "./calendar_api.js";
import { createDraftSync } from "./draft_sync.js";
import { addDays, dayKey, eventDay, fromDay, guestSuggestions, matchesDay, mergeEventScopeDraft, selectedTimeRange, timedEventLayout, weekStart } from "./calendar_data.js";
import "./calendar.css";

const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const sundayStart = date => addDays(weekStart(date), -1);
const googleColors = ["#7986cb", "#33b679", "#8e24aa", "#e67c73", "#f6c026", "#f5511d", "#039be5", "#616161", "#3f51b5", "#0b8043", "#d50000"];
const eventTime = (event, zone) => event.start?.date ? "Todo el día" : new Intl.DateTimeFormat("es", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.start.dateTime));
const eventTimeRange = (event, zone) => `${eventTime(event, zone)} – ${new Intl.DateTimeFormat("es", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.end.dateTime))}`;
const dateTimeInput = (value, zone) => {
    if (!value) return "";
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
    return parts.replace(" ", "T");
};
const eventColor = event => googleColors[Number(event.colorId) - 1] || "#4c9ed7";
const localDateTime = date => `${dayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const displayTime = value => new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(`2026-01-01T${value}:00`));

function BoldTimeField({ value, onChange }) {
    const button = useRef(null), panel = useRef(null);
    const [open, setOpen] = useState(false), [draft, setDraft] = useState(value || "09:00");
    useEffect(() => {
        if (!open) return;
        const popover = panel.current;
        popover.showPopover?.();
        const position = () => {
            const rect = button.current.getBoundingClientRect();
            popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 12))}px`;
            popover.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - 12))}px`;
        };
        position();
        const outside = event => { if (!popover.contains(event.target) && !button.current.contains(event.target)) setOpen(false); };
        const escape = event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape, true);
        window.addEventListener("resize", position);
        return () => { popover.hidePopover?.(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", position); };
    }, [open]);
    const [hour, minute] = draft.split(":");
    return <div className="bold_calendar_time_field"><button ref={button} type="button" className="bold_calendar_time_trigger" aria-label="Elegir hora" aria-expanded={open} onClick={() => { setDraft(value || "09:00"); setOpen(current => !current); }}><span>{displayTime(value || "09:00")}</span><Clock3 size={16} /></button>{open && <div ref={panel} className="bold_calendar_time_popover" popover="manual" role="dialog" aria-label="Elegir hora"><div><label>Hora<select aria-label="Hora" value={hour} onChange={event => setDraft(`${event.target.value}:${minute}`)}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={String(index).padStart(2, "0")}>{String(index).padStart(2, "0")}</option>)}</select></label><span>:</span><label>Minutos<select aria-label="Minutos" value={minute} onChange={event => setDraft(`${hour}:${event.target.value}`)}>{Array.from({ length: 60 }, (_, index) => <option key={index} value={String(index).padStart(2, "0")}>{String(index).padStart(2, "0")}</option>)}</select></label></div><footer><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button type="button" onClick={() => { onChange(draft); setOpen(false); }}>Aplicar</button></footer></div>}</div>;
}

function CalendarDateTimeField({ value, onChange, withTime = false, required = false }) {
    const date = value?.slice(0, 10) || "", time = value?.slice(11, 16) || "09:00";
    return <div className="bold_calendar_datetime_field"><CalendarDateField required={required} value={date} onChange={next => onChange(withTime ? `${next}T${time}` : next)} />{withTime && <BoldTimeField value={time} onChange={next => onChange(`${date}T${next}`)} />}</div>;
}
const initialForm = (date, zone, event) => event ? {
    summary: event.summary || "", description: event.description || "", location: event.location || "",
    allDay: Boolean(event.start?.date), start: event.start?.date || dateTimeInput(event.start?.dateTime, zone),
    end: event.end?.date ? dayKey(addDays(fromDay(event.end.date), -1)) : dateTimeInput(event.end?.dateTime, zone),
    guests: (event.attendees || []).map(item => item.email).filter(Boolean).join(", "),
    reminder: event.reminders?.useDefault !== false ? "default" : String(event.reminders?.overrides?.[0]?.minutes ?? "none"),
    repeat: event.recurrence?.find(rule => rule.startsWith("RRULE:"))?.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1] || "none",
    originalRepeat: event.recurrence?.find(rule => rule.startsWith("RRULE:"))?.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1] || "none",
    colorId: event.colorId || "",
} : { summary: "", description: "", location: "", allDay: false, start: localDateTime(date), end: localDateTime(new Date(date.getTime() + 3600000)), guests: "", reminder: "default", repeat: "none", originalRepeat: "none", colorId: "" };

function EventDetails({ event, zone, onClose, onEdit, onSaved }) {
    const [busy, setBusy] = useState(false), [menu, setMenu] = useState(false), [error, setError] = useState("");
    const meetLink = event.hangoutLink || event.conferenceData?.entryPoints?.find(point => point.entryPointType === "video")?.uri;
    const phones = event.conferenceData?.entryPoints?.filter(point => point.entryPointType === "phone") || [];
    const editable = !event.locked && (!event.eventType || event.eventType === "default");
    const when = event.start?.date ? `${new Intl.DateTimeFormat("es", { dateStyle: "full" }).format(fromDay(event.start.date))} · Todo el día` : `${new Intl.DateTimeFormat("es", { timeZone: zone, dateStyle: "full" }).format(new Date(event.start.dateTime))} · ${eventTimeRange(event, zone)}`;
    useEffect(() => { const escape = key => { if (key.key === "Escape") onClose(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [onClose]);
    async function remove(scope = "instance") {
        if (!window.confirm(scope === "series" ? "¿Eliminar toda la serie?" : "¿Eliminar este evento?")) return;
        setBusy(true); setError("");
        try { await calendarApi.remove(event.id, scope); onSaved(); }
        catch (problem) { setError(problem.message); setBusy(false); }
    }
    return <div className="bold_calendar_backdrop is_quick" onMouseDown={click => click.target === click.currentTarget && onClose()}><section className="bold_calendar_details" role="dialog" aria-modal="true" aria-label="Detalles del evento">
        <header><div className="bold_calendar_detail_actions">{editable && <><button type="button" aria-label="Editar evento" onClick={onEdit}><Pencil size={17} /></button><button type="button" aria-label="Eliminar evento" disabled={busy} onClick={() => remove()}><Trash2 size={17} /></button></>}<button type="button" aria-label="Más opciones" onClick={() => setMenu(value => !value)}><MoreVertical size={18} /></button><button type="button" aria-label="Cerrar detalles" onClick={onClose}><X size={19} /></button></div>{menu && <div className="bold_calendar_detail_menu">{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer">Abrir en Google Calendar</a>}{editable && event.recurringEventId && <button onClick={() => remove("series")}>Eliminar toda la serie</button>}</div>}</header>
        {error && <p className="bold_calendar_error" role="alert">{error}</p>}
        <div className="bold_calendar_detail_body"><div className="bold_calendar_detail_title"><i style={{ background: eventColor(event) }} /><div><h2>{event.summary || "Sin título"}</h2><p>{when}</p>{event.recurrence?.length > 0 && <small>Evento recurrente</small>}</div></div>
            {meetLink && <div className="bold_calendar_detail_row"><Video size={18} /><div><a href={meetLink} target="_blank" rel="noreferrer">Unirse con Google Meet</a><small>{meetLink}</small></div><button aria-label="Copiar enlace de Meet" onClick={() => navigator.clipboard.writeText(meetLink).catch(() => setError("No se pudo copiar el enlace."))}><Copy size={17} /></button></div>}
            {phones.map(phone => <div className="bold_calendar_detail_row" key={phone.uri}><Video size={18} /><a href={phone.uri}>{phone.label || phone.uri}</a></div>)}
            {event.location && <div className="bold_calendar_detail_row"><MapPin size={18} /><span>{event.location}</span></div>}
            {event.description && <div className="bold_calendar_detail_row"><AlignLeft size={18} /><p>{event.description}</p></div>}
            {event.attendees?.length > 0 && <div className="bold_calendar_detail_row"><Users size={18} /><div><strong>{event.attendees.length} invitados</strong>{event.attendees.map(person => <small key={person.email}>{person.displayName || person.email}</small>)}</div></div>}
            {event.reminders?.overrides?.length > 0 && <div className="bold_calendar_detail_row"><Bell size={18} /><span>{event.reminders.overrides[0].minutes} minutos antes</span></div>}
            {event.organizer?.email && <div className="bold_calendar_detail_row"><CalendarDays size={18} /><span>{event.organizer.email}</span></div>}
        </div>
    </section></div>;
}

function TaskEditor({ date, lists, onClose, onSaved }) {
    const [title, setTitle] = useState(""), [notes, setNotes] = useState(""), [due, setDue] = useState(dayKey(date));
    const [listId, setListId] = useState(lists[0]?.id || ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    useEffect(() => { if (!listId && lists[0]) setListId(lists[0].id); }, [lists, listId]);
    async function save(event) {
        event.preventDefault(); setBusy(true); setError("");
        try { await calendarApi.createTask({ title, notes, due, list_id: listId }); onSaved(); }
        catch (problem) { setError(problem.message); setBusy(false); }
    }
    return <div className="bold_calendar_backdrop is_quick" onMouseDown={click => click.target === click.currentTarget && onClose()}><section className="bold_calendar_editor is_quick is_task" role="dialog" aria-modal="true" aria-label="Crear tarea de Google"><header><span>Tarea nueva</span><button type="button" aria-label="Cerrar" onClick={onClose}><X size={19} /></button></header>{error && <p className="bold_calendar_error" role="alert">{error}</p>}<form onSubmit={save}>
        <input className="bold_calendar_quick_title" autoFocus required maxLength="1024" placeholder="Añade un título" aria-label="Título de la tarea" value={title} onChange={change => setTitle(change.target.value)} />
        <div className="bold_calendar_quick_type"><span>Tarea</span></div>
        <div className="bold_calendar_quick_field"><Clock3 size={18} /><label>Fecha<CalendarDateTimeField required value={due} onChange={setDue} /></label></div>
        <div className="bold_calendar_quick_field"><CalendarDays size={18} /><label>Lista<select required value={listId} onChange={change => setListId(change.target.value)}>{!lists.length && <option value="">Sin listas disponibles</option>}{lists.map(list => <option value={list.id} key={list.id}>{list.title}</option>)}</select></label></div>
        <div className="bold_calendar_quick_field"><AlignLeft size={18} /><textarea rows="3" maxLength="8192" aria-label="Notas" placeholder="Añadir notas" value={notes} onChange={change => setNotes(change.target.value)} /></div>
        {!lists.length && <p className="bold_calendar_zone">Activa Google Tasks API y reconecta la cuenta desde Administración → Conectores.</p>}
        <footer><button type="button" onClick={onClose}>Cancelar</button><button className="is_primary" type="submit" disabled={busy || !listId}>{busy ? "Guardando…" : "Guardar"}</button></footer>
    </form></section></div>;
}

function TaskDetails({ task, onClose, onSaved }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function action(remove) {
        if (remove && !window.confirm("¿Eliminar esta tarea de Google?")) return;
        setBusy(true); setError("");
        try { if (remove) await calendarApi.removeTask(task.list_id, task.id); else await calendarApi.updateTask(task.list_id, task.id, { status: "completed" }); onSaved(); }
        catch (problem) { setError(problem.message); setBusy(false); }
    }
    return <div className="bold_calendar_backdrop is_quick" onMouseDown={click => click.target === click.currentTarget && onClose()}><section className="bold_calendar_details" role="dialog" aria-modal="true" aria-label="Detalles de la tarea"><header><div className="bold_calendar_detail_actions"><button aria-label="Eliminar tarea" disabled={busy} onClick={() => action(true)}><Trash2 size={17} /></button><button aria-label="Cerrar detalles" onClick={onClose}><X size={19} /></button></div></header>{error && <p className="bold_calendar_error" role="alert">{error}</p>}<div className="bold_calendar_detail_body"><div className="bold_calendar_detail_title"><i style={{ background: "#8bb8f5" }} /><div><h2>{task.title}</h2><p>{new Intl.DateTimeFormat("es", { dateStyle: "full" }).format(fromDay(task.due))}</p></div></div>{task.notes && <div className="bold_calendar_detail_row"><AlignLeft size={18} /><p>{task.notes}</p></div>}<div className="bold_calendar_detail_row"><CalendarDays size={18} /><span>{task.list_title}</span></div><button className="bold_calendar_task_complete" disabled={busy} onClick={() => action(false)}><Check size={16} /> Marcar como completada</button></div></section></div>;
}

function GuestField({ value, onChange, contacts, google, googleAccount, gmail }) {
    const [focused, setFocused] = useState(false), [selected, setSelected] = useState(0);
    const [remote, setRemote] = useState([]), [error, setError] = useState(""), [loadingContacts, setLoadingContacts] = useState(false);
    const search = useMemo(() => createContactSearch(calendarApi.contacts), [googleAccount]);
    const mailSearch = useMemo(() => createContactSearch(calendarApi.mailContacts, {prepare:false}), [googleAccount]);
    const [retry, setRetry] = useState(0);
    useEffect(() => {setRemote([]);setError("");}, [search]);
    const parts = value.split(","), query = parts.at(-1).trim().toLowerCase();
    useEffect(() => {
        let active = true;
        if (focused && google) search.warm().then(result => {if (active && result?.contacts) setRemote(rows => mergeContactSuggestions(rows,result.contacts));});
        return () => {active=false;};
    }, [focused, google, search]);
    useEffect(() => {
        if (!focused || !google || !query) {setLoadingContacts(false); setError(""); return;}
        let active = true;
        const controller = new AbortController();
        setLoadingContacts(true); setError("");
        const timer = setTimeout(async () => {
            const sources = [search, ...(gmail && query.length >= 2 ? [mailSearch] : [])];
            const problems = [];
            await Promise.allSettled(sources.map(async source => {
                try {
                    const result = await source.search(query, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
                    if (active) {setRemote(rows => mergeContactSuggestions(rows,result.contacts || []));if(result.warning)problems.push(result.warning);}
                } catch (problem) {if (active) problems.push(problem.name === "TimeoutError" ? "Google tarda en responder. Puedes escribir el correo completo o reintentar." : problem.message);}
            }));
            if (active) {setError(problems.join(" "));setLoadingContacts(false);}
        }, 250);
        return () => {active=false;clearTimeout(timer);controller.abort();};
    }, [focused, google, query, search, mailSearch, gmail, retry]);
    const matches = focused ? guestSuggestions(query, parts.slice(0, -1), [...remote, ...contacts]) : [];
    const choose = email => { onChange(`${parts.slice(0, -1).join(", ")}${parts.length > 1 ? ", " : ""}${email}, `); setSelected(0); };
    const expanded = focused && Boolean(query);
    return <div className="bold_calendar_guest_search" onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);}}><input type="text" autoComplete="off" aria-label="Invitados" aria-autocomplete="list" aria-expanded={expanded} placeholder="Añadir invitados por nombre o correo" value={value} onFocus={() => setFocused(true)} onChange={change => { onChange(change.target.value); setSelected(0); }} onKeyDown={key => {
        if (key.key === "ArrowDown" && matches.length) { key.preventDefault(); setSelected(index => (index + 1) % matches.length); }
        if (key.key === "ArrowUp" && matches.length) { key.preventDefault(); setSelected(index => (index - 1 + matches.length) % matches.length); }
        if (key.key === "Enter" && matches.length) { key.preventDefault(); choose(matches[selected]?.email || matches[0].email); }
        else if (key.key === "Enter" && query) key.preventDefault();
        if (key.key === "Escape") {key.preventDefault();key.stopPropagation();setFocused(false);}
    }} />{expanded && <div className="bold_calendar_guest_matches" role="listbox" aria-label="Sugerencias de invitados">{matches.map((person, index) => <button type="button" role="option" aria-selected={index === selected} key={person.email} onPointerDown={click => click.preventDefault()} onClick={() => choose(person.email)}><span>{person.name?.[0]?.toUpperCase() || person.email[0]?.toUpperCase()}</span><span><strong>{person.name || person.email}</strong><small>{person.email}{person.source === "gmail" ? " · Gmail" : ""}</small></span></button>)}{loadingContacts && <small role="status">{gmail ? "Buscando en Contactos y Gmail…" : "Buscando contactos de Google…"}</small>}{error && <><small role="status">Búsqueda Google: {error}</small><button type="button" onPointerDown={event => event.preventDefault()} onClick={() => setRetry(value => value + 1)}>Reintentar</button></>}{!gmail && <small>Para buscar también en Gmail, autorízalo en Perfil → Conectores.</small>}{!loadingContacts && !error && !matches.length && <small role="status">No se encontraron contactos. Escribe el correo completo para invitar.</small>}</div>}</div>;
}

function EventEditor({ event, date, endDate, zone, quick = false, onClose, onSaved, onTask, contacts = [], googleContacts = false, googleAccount, googleMail = false }) {
    const [draft, setDraft] = useState(null);
    const [draftEvent, setDraftEvent] = useState(null);
    const [copied, setCopied] = useState(false);
    const meetLink = draftEvent?.hangoutLink || draftEvent?.conferenceData?.entryPoints?.find(point => point.entryPointType === "video")?.uri || event?.hangoutLink || event?.conferenceData?.entryPoints?.find(point => point.entryPointType === "video")?.uri;
    const preset = () => ({ ...initialForm(date, zone, event), ...(!event && endDate ? { end: localDateTime(endDate) } : {}), meet: Boolean(meetLink || event?.conferenceData) });
    const [form, setForm] = useState(preset);
    const [original, setOriginal] = useState(preset);
    const [expanded, setExpanded] = useState(!quick);
    const [scope, setScope] = useState("instance");
    const series = useRef(null), scopeTicket = useRef(0);
    const [seriesLoading, setSeriesLoading] = useState(Boolean(event?.recurringEventId));
    useEffect(() => {
        if (!event?.recurringEventId) return;
        let active = true;
        calendarApi.get(event.recurringEventId).then(master => {
            if (!active) return;
            series.current = master;
            const initial = initialForm(date, zone, master);
            setForm(current => ({...current, repeat:initial.repeat, originalRepeat:initial.repeat}));
            setOriginal(current => ({...current, repeat:initial.repeat, originalRepeat:initial.repeat}));
        }).catch(problem => {if(active)setError(problem.message);}).finally(() => {if(active)setSeriesLoading(false);});
        return () => {active=false;++scopeTicket.current;};
    }, [event?.recurringEventId]);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [meetWarning, setMeetWarning] = useState("");
    const draftSync = useRef(null), needsMeet = useRef(false);
    needsMeet.current = !meetLink && form.meet;
    useEffect(() => { if (meetLink) setMeetWarning(""); }, [meetLink]);
    const editable = !event || (!event.locked && (!event.eventType || event.eventType === "default"));
    async function close() {
        if (busy) return;
        if (draft) {
            setBusy(true);
            try { await calendarApi.draftCancel(draft.draft_id); }
            catch (problem) { setError(`No se pudo cancelar el borrador. ${problem.message}`); setBusy(false); return; }
        }
        onClose();
    }
    useEffect(() => { const escape = key => { if (key.key === "Escape") close(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [draft, busy, onClose]);
    useEffect(() => {
        if (!draft) return;
        const sync = createDraftSync({
            heartbeat: options => calendarApi.draftAction(draft.draft_id, { action: "heartbeat" }, options),
            poll: options => calendarApi.draftGet(draft.draft_id, options), needsMeet: () => needsMeet.current,
            onEvent: setDraftEvent, onWarning: setMeetWarning,
            onExpired: message => { setMeetWarning(message); setDraft(null); setDraftEvent(null); setForm(current => ({ ...current, meet: false })); },
        });
        draftSync.current = sync;
        const leaving = () => { calendarApi.draftCancel(draft.draft_id, { keepalive: true }).catch(() => {}); };
        window.addEventListener("pagehide", leaving);
        return () => { sync.stop(); if (draftSync.current === sync) draftSync.current = null; window.removeEventListener("pagehide", leaving); };
    }, [draft?.draft_id]);
    useEffect(() => () => { if (draft) calendarApi.draftCancel(draft.draft_id).catch(() => {}); }, [draft]);
    async function toggleMeet() {
        if (event) { set("meet", !form.meet); return; }
        setError(""); setMeetWarning(""); setBusy(true);
        try {
            if (draft) {
                const updated = await calendarApi.draftAction(draft.draft_id, { action: form.meet ? "remove_meet" : "add_meet" });
                setDraftEvent(updated); set("meet", !form.meet);
                if (!form.meet) draftSync.current?.retry();
            } else {
                const result = await calendarApi.draft({ start: { dateTime: `${form.start}:00`, timeZone: zone }, end: { dateTime: `${form.end}:00`, timeZone: zone } });
                setDraft(result); setDraftEvent(result.event); set("meet", true);
            }
        } catch (problem) { setError(problem.message); }
        finally { setBusy(false); }
    }
    async function copyMeet() {
        try { await navigator.clipboard.writeText(meetLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }
        catch { setError("No se pudo copiar el enlace."); }
    }
    async function changeScope(next, repeat) {
        const ticket = ++scopeTicket.current;
        setBusy(true); setError("");
        try {
            const master = next === "series" ? series.current || await calendarApi.get(event.recurringEventId) : event;
            if (ticket !== scopeTicket.current) return;
            if (next === "series") series.current = master;
            const initial = initialForm(date, zone, master);
            if (next === "instance" && series.current) initial.repeat = initial.originalRepeat = initialForm(date, zone, series.current).repeat;
            const nextForm = mergeEventScopeDraft(form, original, initial);
            if (repeat !== undefined) nextForm.repeat = repeat;
            if (next === "instance") nextForm.repeat = initial.repeat;
            setForm(nextForm); setOriginal(initial); setScope(next);
        } catch (problem) {if(ticket === scopeTicket.current)setError(problem.message);}
        finally {if(ticket === scopeTicket.current)setBusy(false);}
    }
    function changeRepeat(repeat) {
        if (event?.recurringEventId && scope === "instance") changeScope("series", repeat);
        else set("repeat", repeat);
    }
    function payload() {
        const start = form.allDay ? { date: form.start } : { dateTime: `${form.start}:00`, timeZone: zone };
        const end = form.allDay ? { date: dayKey(addDays(fromDay(form.end), 1)) } : { dateTime: `${form.end}:00`, timeZone: zone };
        const fields = {
            summary: form.summary.trim(), description: form.description.trim(), location: form.location.trim(), start, end,
            attendees: form.guests.split(",").map(email => email.trim()).filter(Boolean).map(email => ({ email })),
            reminders: form.reminder === "default" ? { useDefault: true } : { useDefault: false, overrides: form.reminder === "none" ? [] : [{ method: "popup", minutes: Number(form.reminder) }] },
            ...((!event?.recurringEventId || scope === "series") && form.repeat !== form.originalRepeat ? { recurrence: form.repeat === "none" ? [] : [`RRULE:FREQ=${form.repeat}`] } : {}),
            ...(form.colorId ? { colorId: form.colorId } : {}),
            ...(form.meet && !event?.hangoutLink && !event?.conferenceData ? { addMeet: true } : {}),
        };
        if (!event) return fields;
        const changes = {};
        for (const key of ["summary", "description", "location"]) if (fields[key] !== original[key]) changes[key] = fields[key];
        if (form.start !== original.start || form.end !== original.end || form.allDay !== original.allDay) { changes.start = start; changes.end = end; }
        if (form.guests !== original.guests) changes.attendees = fields.attendees;
        if (form.reminder !== original.reminder) changes.reminders = fields.reminders;
        if (form.repeat !== original.repeat && fields.recurrence) changes.recurrence = fields.recurrence;
        if (form.colorId !== original.colorId) changes.colorId = form.colorId || null;
        if (fields.addMeet) changes.addMeet = true;
        return changes;
    }
    async function save(submit) {
        submit.preventDefault(); setError("");
        const changes = payload();
        if (event && !Object.keys(changes).length) { onClose(); return; }
        setBusy(true);
        try { if (event) await calendarApi.update(event.id, scope, changes); else if (draft) await calendarApi.draftAction(draft.draft_id, { action: "commit", event: changes }); else await calendarApi.create(changes); onSaved(); }
        catch (problem) { setError(problem.message); setBusy(false); }
    }
    async function remove() {
        if (!window.confirm(scope === "series" ? "¿Eliminar toda la serie?" : "¿Eliminar este evento?")) return;
        setBusy(true); setError("");
        try { await calendarApi.remove(event.id, scope); onSaved(); }
        catch (problem) { setError(problem.message); setBusy(false); }
    }
    const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
    const meetNotice = meetWarning && <p className="bold_calendar_error" role="status">{meetWarning} {draft && form.meet && !meetLink && <button type="button" disabled={busy} onClick={() => { setMeetWarning(""); draftSync.current?.retry(); }}>Reintentar consulta de Meet</button>}</p>;
    if (!expanded && !event) {
        return <div className="bold_calendar_backdrop is_quick" onMouseDown={click => click.target === click.currentTarget && close()}><section className="bold_calendar_editor is_quick" role="dialog" aria-modal="true" aria-label="Crear evento"><header><span>Evento nuevo</span><button type="button" aria-label="Cerrar" onClick={close} disabled={busy}><X size={19} /></button></header>{error && <p className="bold_calendar_error" role="alert">{error}</p>}<form onSubmit={save}>
            <input className="bold_calendar_quick_title" autoFocus required maxLength="200" placeholder="Añade un título" aria-label="Título del evento" value={form.summary} onChange={change => set("summary", change.target.value)} />
            <div className="bold_calendar_quick_type"><span>Evento</span><button type="button" onClick={onTask}>Tarea</button></div>
            <div className="bold_calendar_quick_field"><Clock3 size={18} /><div className="bold_calendar_form_row"><label>Inicio<CalendarDateTimeField required withTime value={form.start} onChange={value => set("start", value)} /></label><label>Fin<CalendarDateTimeField required withTime value={form.end} onChange={value => set("end", value)} /></label></div></div>
            <div className="bold_calendar_quick_field"><Users size={18} /><GuestField value={form.guests} onChange={value => set("guests", value)} contacts={contacts} google={googleContacts} googleAccount={googleAccount} gmail={googleMail} /></div>
            <div className="bold_calendar_quick_field"><Video size={18} />{meetLink ? <div className="bold_calendar_meet_link"><a href={meetLink} target="_blank" rel="noreferrer">{meetLink}</a><button type="button" aria-label="Copiar enlace de Meet" onClick={copyMeet}>{copied ? <Check size={16} /> : <Copy size={16} />}</button><button type="button" aria-label="Quitar Google Meet" disabled={busy} onClick={toggleMeet}><Trash2 size={16} /></button></div> : <button type="button" className={form.meet ? "is_selected" : ""} disabled={busy} onClick={toggleMeet}>{busy ? "Preparando enlace…" : form.meet ? "Generando enlace de Google Meet…" : "Añadir videoconferencia de Google Meet"}</button>}</div>
            <div className="bold_calendar_quick_field"><MapPin size={18} /><input aria-label="Ubicación" placeholder="Añadir ubicación" value={form.location} onChange={change => set("location", change.target.value)} /></div>
            <div className="bold_calendar_quick_field"><AlignLeft size={18} /><textarea aria-label="Descripción" rows="2" placeholder="Añadir descripción" value={form.description} onChange={change => set("description", change.target.value)} /></div>
            {meetNotice}
            <footer><button type="button" onClick={() => setExpanded(true)}>Más opciones</button><button className="is_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar"}</button></footer>
        </form></section></div>;
    }
    return <div className="bold_calendar_backdrop" onMouseDown={click => click.target === click.currentTarget && close()}><section className="bold_calendar_editor" role="dialog" aria-modal="true" aria-label={event ? "Detalle del evento" : "Nuevo evento"}><header><div><span>{event ? "GOOGLE CALENDAR" : "NUEVO EVENTO"}</span><h2>{event ? "Detalle del evento" : "Crear evento"}</h2></div><button type="button" aria-label="Cerrar" onClick={close} disabled={busy}><X size={20} /></button></header>{error && <p className="bold_calendar_error" role="alert">{error}</p>}{meetLink && <div className="bold_calendar_meet_link is_full"><a href={meetLink} target="_blank" rel="noreferrer">{meetLink}</a><button type="button" aria-label="Copiar enlace de Meet" onClick={copyMeet}>{copied ? <Check size={16} /> : <Copy size={16} />}</button><button type="button" aria-label="Quitar Google Meet" disabled={busy} onClick={async () => { setBusy(true); try { if (draft) { setDraftEvent(await calendarApi.draftAction(draft.draft_id, { action: "remove_meet" })); set("meet", false); } else if (event) { await calendarApi.update(event.id, "instance", { removeMeet: true }); onSaved(); } } catch (problem) { setError(problem.message); } finally { setBusy(false); } }}><Trash2 size={16} /></button></div>}
        {meetNotice}
        {!editable && <div className="bold_calendar_readonly_summary"><h3>{event.summary || "Sin título"}</h3><p>{eventTime(event, zone)} · {eventDay(event, zone)}</p>{event.location && <p>{event.location}</p>}</div>}
        {!editable ? <div className="bold_calendar_readonly"><p>Este tipo de evento solo puede modificarse en Google Calendar.</p>{event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer">Abrir en Google <ExternalLink size={15} /></a>}</div> : <form onSubmit={save}><label>Título<input autoFocus required maxLength="200" value={form.summary} onChange={change => set("summary", change.target.value)} /></label><label className="bold_calendar_check"><input type="checkbox" checked={form.allDay} onChange={change => setForm(current => ({ ...current, allDay: change.target.checked, start: change.target.checked ? current.start.slice(0, 10) : `${current.start.slice(0, 10)}T09:00`, end: change.target.checked ? current.end.slice(0, 10) : `${current.end.slice(0, 10)}T10:00` }))} /> Todo el día</label><div className="bold_calendar_form_row"><label>Inicio<CalendarDateTimeField required withTime={!form.allDay} value={form.start} onChange={value => set("start", value)} /></label><label>Fin<CalendarDateTimeField required withTime={!form.allDay} value={form.end} onChange={value => set("end", value)} /></label></div><p className="bold_calendar_zone">Zona horaria: {zone}. En eventos de todo el día, el fin indicado se incluye.</p><button type="button" className="bold_calendar_meet_action" disabled={Boolean(meetLink || event?.conferenceData)} onClick={() => set("meet", !form.meet)}><Video size={17} />{meetLink ? "Google Meet añadido" : event?.conferenceData ? "Google Meet en preparación" : form.meet ? "Google Meet se añadirá al guardar" : "Añadir videoconferencia de Google Meet"}</button>{meetLink && <a href={meetLink} target="_blank" rel="noreferrer">Unirse a Google Meet</a>}<label>Ubicación<input value={form.location} onChange={change => set("location", change.target.value)} /></label><label>Descripción<textarea rows="3" value={form.description} onChange={change => set("description", change.target.value)} /></label><label>Invitados <small>(escribe un correo completo o busca en las sugerencias)</small><GuestField value={form.guests} onChange={value => set("guests", value)} contacts={contacts} google={googleContacts} googleAccount={googleAccount} gmail={googleMail} /></label><div className="bold_calendar_form_row"><label>Recordatorio<select value={form.reminder} onChange={change => set("reminder", change.target.value)}><option value="default">Predeterminado</option><option value="none">Ninguno</option><option value="5">5 minutos antes</option><option value="10">10 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option></select></label><label>Repetir<select value={form.repeat} onChange={change => changeRepeat(change.target.value)} disabled={busy || seriesLoading}><option value="none">No se repite</option><option value="DAILY">Cada día</option><option value="WEEKLY">Cada semana</option><option value="MONTHLY">Cada mes</option><option value="YEARLY">Cada año</option></select></label></div><label>Color<select value={form.colorId} onChange={change => set("colorId", change.target.value)}><option value="">Predeterminado</option>{googleColors.map((color, index) => <option value={String(index + 1)} key={color}>Color {index + 1}</option>)}</select></label>{event?.recurringEventId && <fieldset><legend>Aplicar cambios a</legend><p>Cambiar la repetición se aplica a toda la serie.</p><label><input type="radio" checked={scope === "instance"} disabled={busy || seriesLoading} onChange={() => changeScope("instance")} /> Solo este evento</label><label><input type="radio" checked={scope === "series"} disabled={busy || seriesLoading} onChange={() => changeScope("series")} /> Toda la serie</label></fieldset>}<footer>{event && <button type="button" className="is_danger" disabled={busy} onClick={remove}>Eliminar</button>}{event?.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer">Ver en Google</a>}<button type="button" onClick={onClose}>Cancelar</button><button className="is_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar"}</button></footer></form>}</section></div>;
}

function MiniCalendar({ cursor, onSelect }) {
    const first = sundayStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
    return <div className="bold_calendar_mini"><div className="bold_calendar_mini_head"><strong>{new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(cursor)}</strong><button aria-label="Mes anterior" onClick={() => onSelect(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><button aria-label="Mes siguiente" onClick={() => onSelect(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div><div className="bold_calendar_mini_grid">{weekdays.map(day => <span key={day}>{day[0]}</span>)}{days.map(date => <button key={dayKey(date)} className={`${date.getMonth() !== cursor.getMonth() ? "is_other" : ""} ${dayKey(date) === dayKey(cursor) ? "is_selected" : ""} ${dayKey(date) === dayKey(new Date()) ? "is_today" : ""}`} onClick={() => onSelect(date)} aria-label={new Intl.DateTimeFormat("es", { dateStyle: "full" }).format(date)}>{date.getDate()}</button>)}</div></div>;
}

function TimeGrid({ days, events, tasks, zone, selection, onEvent, onTask, onCreate }) {
    const scrollRef = useRef(null);
    const [drag, setDrag] = useState(null);
    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * 52; }, [days.length]);
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const minuteAt = (event, column) => Math.max(0, Math.min(1410, Math.floor((event.clientY - column.getBoundingClientRect().top) / 26) * 30));
    const range = current => selectedTimeRange(current.first, current.last);
    const create = (date, start, end, pointer) => onCreate({ date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, start), endDate: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, end), anchor: { x: pointer.clientX, y: pointer.clientY }, selection: { key: dayKey(date), start, end } });
    return <div className="bold_calendar_time_view"><div className="bold_calendar_time_header"><div className="bold_calendar_time_zone">{zone}</div>{days.map(date => <button key={dayKey(date)} onClick={event => create(date, 9 * 60, 10 * 60, event)}><small>{weekdays[date.getDay()]}</small><strong className={dayKey(date) === dayKey(new Date()) ? "is_today" : ""}>{date.getDate()}</strong></button>)}</div>
        <div className="bold_calendar_all_day"><span>Todo el día</span>{days.map(date => <div key={dayKey(date)}>{events.filter(event => event.start?.date && matchesDay(event, dayKey(date), zone)).map(event => <button key={event.id} style={{ "--event-color": eventColor(event) }} onClick={click => onEvent(event, click)}>{event.summary || "Sin título"}</button>)}{tasks.filter(task => task.due === dayKey(date)).map(task => <button className="bold_calendar_task_chip" key={`${task.list_id}-${task.id}`} onClick={click => onTask(task, click)}><Check size={12} /> {task.title}</button>)}</div>)}</div>
        <div className="bold_calendar_time_scroll" ref={scrollRef}><div className="bold_calendar_hours">{hours.map(hour => <span key={hour} style={{ top: hour * 52 }}>{hour === 0 ? "" : new Intl.DateTimeFormat("es", { hour: "numeric", hour12: true }).format(new Date(2026, 0, 1, hour))}</span>)}</div>{days.map(date => { const key = dayKey(date), active = drag?.key === key ? range(drag) : selection?.key === key ? selection : null; return <div className="bold_calendar_time_column" key={key} role="button" tabIndex={0} aria-label={`Crear evento el ${key}. Arrastra para seleccionar varias horas.`} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); create(date, 9 * 60, 10 * 60, event); } }} onPointerDown={event => { if (event.target !== event.currentTarget) return; const minute = minuteAt(event, event.currentTarget); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ key, first: minute, last: minute }); }} onPointerMove={event => { if (drag?.key === key) { const minute = minuteAt(event, event.currentTarget); setDrag(current => ({ ...current, last: minute })); } }} onPointerUp={event => { if (drag?.key !== key) return; const selected = range({ ...drag, last: minuteAt(event, event.currentTarget) }); setDrag(null); create(date, selected.start, selected.end, event); }} onPointerCancel={() => setDrag(null)}>{active && <div className="bold_calendar_selection" style={{ top: `${active.start / 60 * 52}px`, height: `${(active.end - active.start) / 60 * 52}px` }}><span>(Sin título)</span><small>{`${String(Math.floor(active.start / 60)).padStart(2, "0")}:${String(active.start % 60).padStart(2, "0")} – ${String(Math.floor(active.end / 60)).padStart(2, "0")}:${String(active.end % 60).padStart(2, "0")}`}</small></div>}{timedEventLayout(events, key, zone).map(({ event, start, end, lane, columns }) => <button key={event.id} className={`bold_calendar_time_event${end - start < 45 ? " is_short" : ""}`} title={`${event.summary || "Sin título"} · ${eventTimeRange(event, zone)}`} style={{ "--event-color": eventColor(event), top: `${start / 60 * 52}px`, height: `${Math.max(24, (end - start) / 60 * 52)}px`, left: `${lane / columns * 100}%`, width: `${100 / columns}%` }} onClick={() => onEvent(event)}><strong>{event.summary || "Sin título"}</strong>{end - start >= 45 && <span>{eventTimeRange(event, zone)}</span>}</button>)}</div>; })}</div></div>;
}

export default function CalendarModule() {
    const core = useCore();
    const pointerRef = useRef(null);
    const [connection, setConnection] = useState(null), [view, setView] = useState("week"), [cursor, setCursor] = useState(() => new Date());
    const [events, setEvents] = useState([]), [tasks, setTasks] = useState([]), [taskLists, setTaskLists] = useState([]), [taskError, setTaskError] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [search, setSearch] = useState(""), [editing, setEditing] = useState(null), [details, setDetails] = useState(null), [taskDetails, setTaskDetails] = useState(null), [revision, setRevision] = useState(0);
    const [showPrimary, setShowPrimary] = useState(true), [createMenu, setCreateMenu] = useState(false);
    const zone = connection?.time_zone || "UTC";
    const namespace = cacheScope(connection, core.assignmentId);
    const [refreshing, setRefreshing] = useState(false), [restoredFor, setRestoredFor] = useState("");
    const requestTicket = useRef(0), requestLock = useRef(""), mounted = useRef(true), snapshot = useRef({events: [], tasks: [], lists: []}), activeNamespace = useRef(namespace); activeNamespace.current = namespace;
    useEffect(() => {mounted.current = true; return () => {mounted.current = false; ++requestTicket.current; requestLock.current?.controller?.abort();};}, []);
    useLayoutEffect(() => {++requestTicket.current; requestLock.current?.controller?.abort(); snapshot.current = {events: [], tasks: [], lists: []}; setEvents([]); setTasks([]); setTaskLists([]); setEditing(null); setDetails(null); setTaskDetails(null);}, [namespace]);
    useEffect(() => {const clear = () => {++requestTicket.current; snapshot.current = {events: [], tasks: [], lists: []}; setEvents([]); setTasks([]); setTaskLists([]); setConnection(null);}; globalThis.addEventListener("bold:google-cache-cleared", clear); return () => globalThis.removeEventListener("bold:google-cache-cleared", clear);}, []);
    useEffect(() => {let alive = true; if (namespace) googleCache.get(namespace, "calendar:navigation").then(saved => {if (!alive) return; setRestoredFor(namespace); if (saved && ["day", "week", "month", "agenda"].includes(saved.view) && !Number.isNaN(Date.parse(saved.cursor))) {setView(saved.view); setCursor(new Date(saved.cursor));}}); return () => {alive = false;};}, [namespace]);
    useEffect(() => {if (namespace && restoredFor === namespace) googleCache.put(namespace, "calendar:navigation", {view, cursor: cursor.toISOString()});}, [namespace, restoredFor, view, cursor]);
    useEffect(() => {let alive = true; const load = () => calendarApi.connection().then(value => {if (alive) setConnection(value);}).catch(problem => {if (alive) setError(problem.message);}); load(); globalThis.addEventListener("bold:google-connection-changed", load); return () => {alive = false; globalThis.removeEventListener("bold:google-connection-changed", load);};}, []);
    useEffect(() => {
        const navigate = event => {
            if (event.detail?.module !== "calendar") return;
            if (["day", "week", "month", "agenda"].includes(event.detail.view)) setView(event.detail.view);
        };
        globalThis.addEventListener("bold:global-search:navigate", navigate);
        return () => globalThis.removeEventListener("bold:global-search:navigate", navigate);
    }, []);
    const days = useMemo(() => {
        const first = view === "month" ? sundayStart(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : view === "week" ? sundayStart(cursor) : cursor;
        const count = view === "month" ? 42 : view === "week" ? 7 : view === "agenda" ? 30 : 1;
        return Array.from({ length: count }, (_, index) => addDays(first, index));
    }, [cursor, view]);
    async function refreshCalendar(force = false) {
        if (!namespace || !connection?.connected) {setLoading(false); return;}
        const start = new Date(Date.UTC(days[0].getFullYear(), days[0].getMonth(), days[0].getDate() - 1)).toISOString();
        const last = days.at(-1), end = new Date(Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 2)).toISOString();
        const key = "calendar:data:" + JSON.stringify([zone, start, end]), lock = namespace + key;
        if (requestLock.current?.key === lock && requestLock.current.ticket === requestTicket.current && !force) return;
        const ticket = ++requestTicket.current; requestLock.current?.controller?.abort(); const controller = new AbortController(), options = {signal: controller.signal}; requestLock.current = {key: lock, ticket, controller};
        const valid = () => mounted.current && ticket === requestTicket.current && namespace === activeNamespace.current;
        try {
            const cached = await googleCache.get(namespace, key);
            if (!valid()) return;
            if (cached) {snapshot.current = cached; setEvents(cached.events); setTasks(cached.tasks); setTaskLists(cached.lists);}
            else if (requestLock.previous !== lock) {snapshot.current = {events: [], tasks: [], lists: []}; setEvents([]); setTasks([]); setTaskLists([]);}
            requestLock.previous = lock; setLoading(!cached && !snapshot.current.events.length); setRefreshing(Boolean(cached || snapshot.current.events.length)); setError("");
            const confirmed = await calendarApi.connection(options);
            if (!valid()) return;
            if (cacheScope(confirmed, core.assignmentId) !== namespace) {snapshot.current = {events: [], tasks: [], lists: []}; setEvents([]); setTasks([]); setTaskLists([]); setConnection(confirmed); return;}
            const hasTasks = connection.services?.tasks?.status === "available";
            const results = await Promise.allSettled([calendarApi.events(start, end, options), hasTasks ? calendarApi.tasks(dayKey(days[0]), dayKey(last), options) : Promise.reject(new Error("Autoriza Google Tasks para mostrar tus tareas."))]);
            if (!valid()) return;
            const [eventsResult, tasksResult] = results;
            if (eventsResult.status === "fulfilled") {snapshot.current.events = eventsResult.value.events; setEvents(snapshot.current.events);}
            else if ([401, 403, 409].includes(eventsResult.reason.status)) {await googleCache.invalidate(namespace); if (!valid()) return; snapshot.current = {events: [], tasks: [], lists: []}; setEvents([]); setTasks([]); setTaskLists([]); setError(eventsResult.reason.message);}
            else setError((cached ? "Mostrando datos guardados. " : "") + eventsResult.reason.message);
            if (tasksResult.status === "fulfilled") {snapshot.current.tasks = tasksResult.value.tasks; snapshot.current.lists = tasksResult.value.lists; setTasks(snapshot.current.tasks); setTaskLists(snapshot.current.lists); setTaskError("");}
            else {if (!hasTasks || [401, 403, 409].includes(tasksResult.reason.status)) {snapshot.current.tasks = []; snapshot.current.lists = []; setTasks([]); setTaskLists([]);} setTaskError(tasksResult.reason.message);}
            if (eventsResult.status === "fulfilled") await googleCache.put(namespace, key, snapshot.current);
        } catch (problem) {if (valid()) setError((snapshot.current.events.length ? "Mostrando datos guardados. " : "") + problem.message);}
        finally {if (requestLock.current?.ticket === ticket) requestLock.current = ""; if (valid()) {setLoading(false); setRefreshing(false);}}
    }
    useEffect(() => {++requestTicket.current; if (namespace && revision) googleCache.invalidate(namespace, "calendar:data:").then(() => refreshCalendar(true)); else refreshCalendar(true); return () => {++requestTicket.current;};}, [namespace, connection?.connected, connection?.services?.tasks?.status, view, cursor, revision]);
    useEffect(() => {if (namespace) return backgroundRefresh(() => refreshCalendar());}, [namespace, connection?.connected, connection?.services?.tasks?.status, view, cursor]);
    const visible = useMemo(() => showPrimary ? events.filter(event => `${event.summary || ""} ${event.location || ""} ${event.description || ""}`.toLowerCase().includes(search.toLowerCase())) : [], [events, search, showPrimary]);
    const contacts = useMemo(() => [...new Map([
        ...(core.directory || []).filter(person => person.email).map(person => [person.email.toLowerCase(), { email: person.email, name: person.name || "" }]),
        ...events.flatMap(event => event.attendees || []).filter(person => person.email).map(person => [person.email.toLowerCase(), { email: person.email, name: person.displayName || "" }]),
    ]).values()], [core.directory, events]);
    const visibleTasks = useMemo(() => tasks.filter(task => `${task.title} ${task.notes}`.toLowerCase().includes(search.toLowerCase())), [tasks, search]);
    const shift = direction => setCursor(current => view === "month" ? new Date(current.getFullYear(), current.getMonth() + direction, 1) : addDays(current, direction * (view === "week" ? 7 : view === "agenda" ? 30 : 1)));
    const title = view === "month" ? new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(cursor) : view === "day" ? new Intl.DateTimeFormat("es", { dateStyle: "full" }).format(cursor) : `${new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(days[0])} – ${new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(days.at(-1))}`;
    const open = (event, pointer) => event ? setDetails({ event, anchor: { x: (pointer || pointerRef.current)?.clientX, y: (pointer || pointerRef.current)?.clientY } }) : setEditing({ event: null, date: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 9), quick: true, anchor: { x: 260, y: 110 } });
    const openTask = (task, pointer) => setTaskDetails({ task, anchor: { x: (pointer || pointerRef.current)?.clientX, y: (pointer || pointerRef.current)?.clientY } });
    const eventsFor = key => visible.filter(event => matchesDay(event, key, zone));
    const eventButton = event => <button key={event.id} type="button" className="bold_calendar_event" style={{ "--event-color": eventColor(event) }} onClick={click => { click.stopPropagation(); open(event, click); }} title={event.summary || "Sin título"}><span>{eventTime(event, zone)}</span><strong>{event.summary || "Sin título"}</strong></button>;
    const taskButton = task => <button key={`${task.list_id}-${task.id}`} type="button" className="bold_calendar_event is_task" style={{ "--event-color": "#8bb8f5" }} onClick={click => { click.stopPropagation(); openTask(task, click); }}><Check size={12} /><strong>{task.title}</strong></button>;
    const calendarBody = () => {
        if (loading) return <div className="bold_calendar_state">Cargando eventos…</div>;
        if (view === "week" || view === "day") return <TimeGrid days={days} events={visible} tasks={visibleTasks} zone={zone} onEvent={open} onTask={openTask} selection={editing?.selection} onCreate={details => setEditing({ event: null, quick: true, ...details })} />;
        if (view === "agenda") return <div className="bold_calendar_agenda">{days.map(date => {
            const key = dayKey(date), rows = eventsFor(key), taskRows = visibleTasks.filter(task => task.due === key);
            return rows.length || taskRows.length ? <section key={key}><h3>{new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(date)}</h3>{rows.map(event => <button className="bold_calendar_agenda_event" key={event.id} onClick={click => open(event, click)}><i style={{ background: eventColor(event) }} /><span><strong>{event.summary || "Sin título"}</strong><small>{eventTime(event, zone)}{event.location ? ` · ${event.location}` : ""}</small></span><ChevronRight size={17} /></button>)}{taskRows.map(task => <button className="bold_calendar_agenda_event" key={`${task.list_id}-${task.id}`} onClick={click => openTask(task, click)}><i style={{ background: "#8bb8f5" }} /><span><strong>{task.title}</strong><small>Tarea · {task.list_title}</small></span><ChevronRight size={17} /></button>)}</section> : null;
        })}{!visible.length && !visibleTasks.length && <div className="bold_calendar_state">No hay eventos ni tareas en este período.</div>}</div>;
        return <div className="bold_calendar_grid is_month">{weekdays.map(day => <div className="bold_calendar_weekday" key={day}>{day}</div>)}{days.map(date => {
            const key = dayKey(date), rows = eventsFor(key), taskRows = visibleTasks.filter(task => task.due === key), today = key === dayKey(new Date());
            const shownEvents = rows.slice(0, 2), shownTasks = taskRows.slice(0, 2), hidden = rows.length + taskRows.length - shownEvents.length - shownTasks.length;
            return <div className={`bold_calendar_day${today ? " is_today" : ""}${date.getMonth() !== cursor.getMonth() ? " is_other_month" : ""}`} key={key} onClick={click => setEditing({ date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9), event: null, quick: true, anchor: { x: click.clientX, y: click.clientY } })}><div className="bold_calendar_day_top"><span>{date.getDate()}</span><button aria-label={`Crear evento el ${key}`} onClick={click => { click.stopPropagation(); setEditing({ date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9), event: null, quick: true, anchor: { x: click.clientX, y: click.clientY } }); }}><Plus size={15} /></button></div>{shownEvents.map(eventButton)}{shownTasks.map(taskButton)}{hidden > 0 && <button className="bold_calendar_more" onClick={click => { click.stopPropagation(); setCursor(date); setView("day"); }}>+{hidden} más</button>}</div>;
        })}</div>;
    };
    return <section className={`bold_calendar${connection?.connected && error ? " has_error" : ""}`} onClickCapture={click => { pointerRef.current = { clientX: click.clientX, clientY: click.clientY }; }}>
        <header className="bold_calendar_header"><CalendarDays size={27} /><div><h1>Calendario</h1><p>{connection?.connected ? `${connection.email} · ${zone}` : "Conecta Google Calendar para ver tus eventos."}</p></div></header>
        {!connection ? <div className="bold_calendar_state">{error ? <><p role="alert">{error}</p><button onClick={() => { setError(""); calendarApi.connection().then(setConnection).catch(problem => setError(problem.message)); }}>Reintentar</button></> : "Comprobando la conexión…"}</div> : !connection.connected ? <GoogleConnection onConnected={() => calendarApi.connection().then(setConnection).catch(problem => setError(problem.message))}/> : <div className="bold_calendar_layout">
            <aside className="bold_calendar_sidebar"><div className="bold_calendar_create_wrap"><button className="bold_calendar_create" aria-expanded={createMenu} onClick={() => setCreateMenu(value => !value)}><Plus size={23} /> Crear <ChevronDown size={14} /></button>{createMenu && <div className="bold_calendar_create_menu"><button onClick={() => { setCreateMenu(false); open(null); }}>Evento</button><button onClick={() => { setCreateMenu(false); setEditing({ event: null, date: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 9), quick: true, task: true, anchor: { x: 260, y: 110 } }); }}>Tarea</button></div>}</div><MiniCalendar cursor={cursor} onSelect={setCursor} /><div className="bold_calendar_sources"><h3>Mis calendarios</h3><label><input type="checkbox" checked={showPrimary} onChange={change => setShowPrimary(change.target.checked)} /><span>{connection.email}</span></label></div></aside>
            <main className="bold_calendar_main"><div className="bold_calendar_toolbar"><div className="bold_calendar_move"><button onClick={() => setCursor(new Date())}>Hoy</button><button aria-label="Período anterior" onClick={() => shift(-1)}><ChevronLeft size={18} /></button><button aria-label="Período siguiente" onClick={() => shift(1)}><ChevronRight size={18} /></button><h2>{title}</h2></div><div className="bold_calendar_controls"><label className="bold_calendar_search"><Search size={16} /><input aria-label="Buscar eventos" placeholder="Buscar eventos" value={search} onChange={change => setSearch(change.target.value)} /></label><button aria-label="Actualizar eventos" title="Actualizar" onClick={() => setRevision(current => current + 1)}><RefreshCw size={17} /></button><div className="bold_calendar_views" role="tablist" aria-label="Vista del calendario">{[["day", "Día"], ["week", "Semana"], ["month", "Mes"], ["agenda", "Agenda"]].map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? "is_active" : ""} onClick={() => setView(id)}>{label}</button>)}</div></div></div>
            {refreshing && <p role="status">Actualizando…</p>}{error && <div className="bold_calendar_error" role="alert">{error}<button onClick={() => setRevision(current => current + 1)}>Reintentar</button></div>}
            {taskError && <div className="bold_calendar_error" role="alert">Google Tasks: {taskError} <button onClick={() => setRevision(current => current + 1)}>Reintentar</button>{connection.services?.tasks?.status !== "available" && <details><summary>Autorizar Google Tasks</summary><GoogleConnection service="tasks" onConnected={() => calendarApi.connection().then(setConnection).catch(problem => setError(problem.message))}/></details>}</div>}
            {calendarBody()}
            </main></div>}
        {details && <EventDetails event={details.event} zone={zone} anchor={details.anchor} onClose={() => setDetails(null)} onEdit={() => { setEditing({ event: details.event, date: fromDay(eventDay(details.event, zone)), anchor: details.anchor }); setDetails(null); }} onSaved={() => { setDetails(null); setRevision(current => current + 1); }} />}
        {taskDetails && <TaskDetails task={taskDetails.task} anchor={taskDetails.anchor} onClose={() => setTaskDetails(null)} onSaved={() => { setTaskDetails(null); setRevision(current => current + 1); }} />}
        {editing?.task ? <TaskEditor key={`task-${dayKey(editing.date)}`} date={editing.date} anchor={editing.anchor} lists={taskLists} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(current => current + 1); }} /> : editing && <EventEditor key={`${editing.event?.id || "new"}-${dayKey(editing.date)}-${editing.date.getHours()}`} event={editing.event} date={editing.date} endDate={editing.endDate} quick={editing.quick} anchor={editing.anchor} zone={zone} contacts={contacts} googleContacts={Boolean(connection?.connected)} googleMail={connection?.services?.gmail?.status === "available"} googleAccount={connection?.connection_key || `${connection?.email}:${connection?.configuration_version}`} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(current => current + 1); }} onTask={() => setEditing(current => ({ ...current, task: true }))} />}
    </section>;
}
