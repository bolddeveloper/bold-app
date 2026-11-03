import {useEffect, useRef, useState} from "react";
import {Bell, ChevronDown, Clock, Inbox, ListChecks, Monitor, Play, Upload, Volume2} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {moduleCache, moduleScope} from "../core/module_cache.js";
import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {http} from "../core/http_client.js";
import {notificationSounds, playNotificationSound, showDesktopNotification, stopNotificationSound} from "../core/notification_sound.js";
import {backgroundPush, backgroundPushScope} from "../core/background_push.js";
const endpoint = "/api/v2/auth/notification-settings/";
export const notificationEvents = [
    ["task.assigned", "Tareas asignadas a mí"], ["task.collaborator_added", "Me agregan como colaborador de una tarea"],
    ["task.updated", "Ediciones de tareas"], ["task.status_changed", "Cambios de estado de tareas"], ["task.due_changed", "Cambios de fecha límite"],
    ["project.created", "Proyectos nuevos"], ["project.assigned", "Me asignan como responsable de un proyecto"], ["project.member_added", "Me agregan a un proyecto"], ["project.updated", "Ediciones de proyectos"],
    ["comment.created", "Comentarios nuevos"], ["comment.mentioned", "Menciones en comentarios"],
    ["calendar.meeting_reminder", "Recordatorios de reuniones: 30 minutos, 5 minutos y al inicio"],
    ["messaging.message_created", "Mensajes privados de Chat"],
    ["slack.message_created", "Mensajes de canales e hilos seguidos de Slack"],
    ["slack.mentioned", "Menciones de Slack, también en canales no seguidos"],
];

function NotificationSection({icon: Icon, title, status, children}) {
    return <details className="bold_notification_section">
        <summary><Icon size={17} aria-hidden="true"/><strong>{title}</strong>{status && <span>{status}</span>}
            <ChevronDown className="bold_notification_chevron" size={16} aria-hidden="true"/>
        </summary>
        <div className="bold_notification_section_body">{children}</div>
    </details>;
}

export default function NotificationPreferences() {
    const core = useCore();
    const pushScope = backgroundPushScope(core);
    const [pushActive, setPushActive] = useState(() => backgroundPush.active(pushScope));
    useEffect(() => {
        const update = () => setPushActive(backgroundPush.active(pushScope));
        window.addEventListener("bold:background-push-changed", update); update();
        return () => window.removeEventListener("bold:background-push-changed", update);
    }, [core.account?.id, core.activeAssignment?.id]);
    const [permission, setPermission] = useState(globalThis.Notification?.permission || "unsupported");
    const [pushAvailable, setPushAvailable] = useState(false);
    useEffect(() => {
        let active = true;
        http.request("/api/v2/notifications/push/config/").then(config => {
            if (active) setPushAvailable(config.enabled === true && !!config.public_key);
        }).catch(() => {if (active) setPushAvailable(false);});
        return () => {active = false;};
    }, [core.account?.id, core.activeAssignment?.id]);
    const cacheScope = moduleScope(core);
    const [settings, setSettings] = useState(() => moduleCache.read(cacheScope, "notification-settings")), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [refreshing, setRefreshing] = useState(false), settingsRef = useRef(settings); settingsRef.current = settings;
    const file = useRef(null), alive = useRef(true), ticket = useRef(0);
    async function load() {const previous = settingsRef.current, cacheGeneration = moduleCache.generation; setRefreshing(true); try {const value = await http.request(endpoint); if (alive.current) {if (settingsRef.current === previous) {setSettings(value); moduleCache.write(cacheScope, "notification-settings", value, cacheGeneration);} setError("");}} catch (problem) {if (alive.current) setError(problem.message);} finally {if (alive.current) setRefreshing(false);}}
    useEffect(() => {alive.current = true; load(); return () => {alive.current = false; ticket.current++; stopNotificationSound();};}, []);
    async function preview() {try {await playNotificationSound({...settings, enabled: true});} catch {setError("No se pudo reproducir el sonido. Comprueba el archivo y los permisos de audio del navegador.");}}
    async function choose(event) {
        const selected = event.target.files?.[0]; event.target.value = "";
        if (!selected) return;
        if (selected.size > 500 * 1024) {setError("El archivo no puede superar 500 KB."); return;}
        const mime = {mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg"}[selected.name.split(".").at(-1).toLowerCase()];
        if (!mime) {setError("Usa un archivo MP3, WAV u OGG."); return;}
        const id = ++ticket.current; setBusy(true); setError("");
        try {
            const url = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("No se pudo leer el archivo.")); reader.readAsDataURL(new Blob([selected], {type: mime}));});
            const sample = new Audio(url);
            await new Promise((resolve, reject) => {const timer = setTimeout(() => {sample.removeAttribute("src"); reject(new Error("No se pudo leer este audio."));}, 5000); sample.onloadedmetadata = () => {clearTimeout(timer); if (!Number.isFinite(sample.duration) || sample.duration > 15) reject(new Error("El sonido debe durar como máximo 15 segundos.")); else resolve();}; sample.onerror = () => {clearTimeout(timer); reject(new Error("El archivo de audio no es válido."));};});
            if (alive.current && id === ticket.current) {setSettings(value => ({...value, custom_audio: url, custom_name: selected.name.slice(0,120), sound: "custom"})); setNotice("Sonido preparado. Guarda los cambios para usarlo.");}
        } catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    async function save(event) {
        event.preventDefault(); setBusy(true); setError("");
        try {const value = await http.request(endpoint, {method: "PATCH", body: settings}); if (!alive.current) return; settingsRef.current = value; setSettings(value); moduleCache.write(cacheScope, "notification-settings", value); window.dispatchEvent(new CustomEvent("bold:notification-sound-changed", {detail: value})); setNotice("Preferencias de notificaciones guardadas.");}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    async function requestDesktop() {
        if (!globalThis.Notification) return;
        try {
            const result = await Notification.requestPermission(); setPermission(result);
            if (result === "granted") {setSettings(value => ({...value, desktop_enabled: true})); setNotice("Permiso concedido. Guarda las preferencias para activar los avisos del sistema.");}
            else setNotice("El permiso no fue concedido. Puedes cambiarlo desde los permisos de este sitio en tu navegador.");
        } catch {setError("El navegador no permite solicitar notificaciones aquí.");}
    }
    async function configureBackground(enable) {
        setBusy(true); setError("");
        try {
            if (enable) {
                if (!await backgroundPush.enable(pushScope)) throw new Error("Este navegador no permite Web Push. En iPhone o iPad utiliza BOLD desde la pantalla de inicio.");
                if (!alive.current) return;
                setSettings(value => ({...value, desktop_enabled: true}));
                setNotice("Dispositivo conectado. Guarda las preferencias para recibir avisos también con BOLD cerrado mientras la sesión siga vigente.");
            } else {
                await backgroundPush.disable(pushScope);
                if (alive.current) setNotice("Notificaciones con BOLD cerrado desactivadas en este dispositivo.");
            }
        } catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    async function clearNotifications() {
        setBusy(true); setError("");
        try {await core.notifications.clear(); if (alive.current) setNotice("Notificaciones limpiadas para el departamento activo.");}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    async function testDesktop() {
        setError(""); setNotice("");
        try {
            if (await showDesktopNotification({id: "desktop-test", actor_is_owner: false}, {desktop_enabled: true})) {
                setNotice("Aviso de prueba enviado. Si no aparece, revisa las notificaciones del navegador y No molestar en Windows.");
                return;
            }
        } catch { /* El navegador puede impedir mostrar el aviso incluso con permiso. */ }
        setError("El navegador no pudo mostrar el aviso de prueba. Revisa los permisos de este sitio.");
    }
    const groups = [
        ["Tareas", ["task"]], ["Proyectos", ["project"]], ["Comentarios y reuniones", ["comment", "calendar"]],
        ...(core.activeAssignment?.chat_enabled === true ? [["Chat y Slack", ["messaging", "slack"]]] : []),
    ].map(([title, sources]) => [title, notificationEvents.filter(([id]) => sources.includes(id.split(".")[0]))]);
    const visibleEvents = groups.flatMap(([, events]) => events);
    const enabledEvents = visibleEvents.filter(([id]) => settings?.events?.[id] !== false).length;
    const sounds = [...notificationSounds, ["custom", "Personalizado"]];
    const soundLabel = sounds.find(([id]) => id === settings?.sound)?.[1];
    const desktopLabel = permission === "granted" ? (settings?.desktop_enabled ? "Activadas" : "Desactivadas") :
        ({denied: "Bloqueadas", default: "Permiso pendiente", unsupported: "No disponibles"})[permission];

    return <section className="bold_notification_preferences">
        <BackgroundSyncNotice active={refreshing} label="Actualizando preferencias…" />
        <h2><Bell size={22} aria-hidden="true"/>Notificaciones</h2>
        <p>Elige qué avisos recibir y cómo quieres que suenen.</p>
        {error && <p role="alert">{error} {!settings && <button type="button" onClick={load}>Reintentar</button>}</p>}
        {notice && <p role="status">{notice}</p>}
        {!settings ? !error && <p aria-busy="true">Cargando preferencias…</p> : <form onSubmit={save}>
            <div className="bold_notification_sections">
                <NotificationSection icon={ListChecks} title="Tipos de aviso" status={`${enabledEvents} de ${visibleEvents.length} activos`}>
                    <div className="bold_notification_event_groups">
                        {groups.map(([title, events]) => <fieldset key={title} disabled={busy}>
                            <legend>{title}</legend>
                            {events.map(([id, label]) => <label className="bold_notification_toggle" key={id}>
                                <input type="checkbox" checked={settings.events?.[id] !== false} onChange={event => {
                                    const checked = event.target.checked;
                                    setSettings(value => ({...value, events: {...value.events, [id]: checked}}));
                                }}/>
                                <span>{label}</span>
                            </label>)}
                        </fieldset>)}
                    </div>
                </NotificationSection>
                <NotificationSection icon={Clock} title="Recordatorios de la campana" status={`Cada ${settings.bell_interval_minutes ?? 5} min`}>
                    <label className="bold_notification_interval">Minutos entre recordatorios
                        <input type="number" min="1" max="60" step="1" required disabled={busy} value={settings.bell_interval_minutes ?? 5}
                            onChange={event => setSettings({...settings, bell_interval_minutes: Number(event.target.value)})}
                            onInvalid={event => {event.currentTarget.closest("details").open = true;}}/>
                        <small>Para avisos sin leer. Entre 1 y 60 minutos.</small>
                    </label>
                </NotificationSection>
                <NotificationSection icon={Volume2} title="Sonido y volumen" status={settings.enabled ? `${soundLabel || "Activado"} · ${settings.volume}%` : "Desactivado"}>
                    <fieldset disabled={busy} aria-label="Sonido de notificaciones">
                        <label className="bold_notification_toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({...settings, enabled: event.target.checked})}/>Reproducir sonidos</label>
                        <div className="bold_notification_sound_controls">
                            <label>Sonido<select value={settings.sound} onChange={event => setSettings({...settings, sound: event.target.value})}>
                                {sounds.map(([id, label]) => <option key={id} value={id} disabled={id === "custom" && !settings.custom_audio}>{label}</option>)}
                            </select></label>
                            <label>Volumen · {settings.volume}%<input type="range" min="0" max="100" value={settings.volume} onChange={event => setSettings({...settings, volume: Number(event.target.value)})}/></label>
                        </div>
                        <input ref={file} type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" hidden onChange={choose}/>
                        <div className="bold_profile_buttons">
                            <button type="button" onClick={preview}><Play size={16} aria-hidden="true"/>Escuchar</button>
                            <button type="button" className="bold_profile_quiet" onClick={() => file.current.click()}><Upload size={16} aria-hidden="true"/>Subir sonido</button>
                            {settings.custom_audio && <button type="button" className="bold_profile_quiet" onClick={() => setSettings({...settings, custom_audio: "", custom_name: "", sound: settings.sound === "custom" ? "samsung" : settings.sound})}>Quitar sonido personalizado</button>}
                        </div>
                        <small>{settings.custom_name || "MP3, WAV u OGG · hasta 500 KB y 15 segundos."}</small>
                    </fieldset>
                </NotificationSection>
                <NotificationSection icon={Monitor} title="Notificaciones de Windows" status={desktopLabel}>
                    <small>{pushAvailable ? "Activa este dispositivo para recibir avisos con BOLD cerrado." : "Mantén BOLD abierto, aunque esté minimizado."}</small>
                    {permission === "granted" ? <label className="bold_notification_toggle"><input type="checkbox" disabled={busy} checked={settings.desktop_enabled} onChange={event => setSettings({...settings, desktop_enabled: event.target.checked})}/>Mostrar notificaciones en Windows</label>
                        : permission === "default" ? <button type="button" disabled={busy} onClick={requestDesktop}>Permitir notificaciones</button>
                        : permission === "denied" && <small>Habilítalas en los permisos de este sitio y vuelve a abrir este apartado.</small>}
                    {permission === "granted" && (pushAvailable || pushActive) && <button type="button" disabled={busy} onClick={() => configureBackground(!pushActive)}>{pushActive ? "Desactivar en este dispositivo" : "Activar con BOLD cerrado"}</button>}
                    <small>Los avisos externos muestran información general para proteger tu privacidad.</small>
                    {permission === "granted" && <button type="button" className="bold_profile_quiet" disabled={busy} onClick={testDesktop}><Bell size={16} aria-hidden="true"/>Enviar aviso de prueba</button>}
                </NotificationSection>
                <NotificationSection icon={Inbox} title="Limpiar avisos">
                    <small>Limpia los avisos del departamento activo. Las tareas y eventos se conservan.</small>
                    <button type="button" className="bold_profile_quiet" disabled={busy} onClick={clearNotifications}>Limpiar notificaciones</button>
                </NotificationSection>
            </div>
            <div className="bold_profile_buttons">
                <button className="bold_profile_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar preferencias"}</button>
            </div>
        </form>}
    </section>;
}
