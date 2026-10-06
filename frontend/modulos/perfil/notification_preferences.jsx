import {useEffect, useRef, useState} from "react";
import {Play, Upload, Volume2} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {http} from "../core/http_client.js";
import {notificationSounds, playNotificationSound, stopNotificationSound} from "../core/notification_sound.js";
const endpoint = "/api/v2/auth/notification-settings/";
export const notificationEvents = [
    ["task.assigned", "Tareas asignadas a mí"], ["task.collaborator_added", "Me agregan como colaborador de una tarea"],
    ["task.updated", "Ediciones de tareas"], ["task.status_changed", "Cambios de estado de tareas"], ["task.due_changed", "Cambios de fecha límite"],
    ["project.created", "Proyectos nuevos"], ["project.assigned", "Me asignan como responsable de un proyecto"], ["project.member_added", "Me agregan a un proyecto"], ["project.updated", "Ediciones de proyectos"],
    ["comment.created", "Comentarios nuevos"], ["comment.mentioned", "Menciones en comentarios"],
];

export default function NotificationPreferences() {
    const core = useCore();
    const [permission, setPermission] = useState(globalThis.Notification?.permission || "unsupported");
    const [settings, setSettings] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const file = useRef(null), alive = useRef(true), ticket = useRef(0);
    async function load() {try {const value = await http.request(endpoint); if (alive.current) {setSettings(value); setError("");}} catch (problem) {if (alive.current) setError(problem.message);}}
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
        try {const value = await http.request(endpoint, {method: "PATCH", body: settings}); if (!alive.current) return; setSettings(value); window.dispatchEvent(new CustomEvent("bold:notification-sound-changed", {detail: value})); setNotice("Preferencias de notificaciones guardadas.");}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    async function requestDesktop() {
        if (!globalThis.Notification) return;
        try {
            const result = await Notification.requestPermission(); setPermission(result);
            if (result === "granted") {setSettings(value => ({...value, desktop_enabled: true})); setNotice("Permiso concedido. Guarda las preferencias para activar las notificaciones de Windows.");}
            else setNotice("El permiso no fue concedido. Puedes cambiarlo desde los permisos de este sitio en tu navegador.");
        } catch {setError("El navegador no permite solicitar notificaciones aquí.");}
    }
    async function clearNotifications() {
        setBusy(true); setError("");
        try {await core.notifications.clear(); if (alive.current) setNotice("Notificaciones limpiadas para el departamento activo.");}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    return <section className="bold_notification_preferences"><h2><Volume2 size={22}/>Notificaciones</h2><p>Elige el sonido de las nuevas notificaciones de BOLD. Se guarda en tu cuenta.</p>{error && <p role="alert">{error}<button type="button" onClick={load}>Reintentar</button></p>}{notice && <p role="status">{notice}</p>}{!settings ? <p>Cargando preferencias…</p> : <form onSubmit={save}>
        <fieldset disabled={busy}><legend>Eventos que quiero recibir</legend><p>Controla los avisos nuevos dentro de BOLD y sus alertas. Los avisos anteriores se conservan.</p>{notificationEvents.map(([id, label]) => <label className="bold_notification_toggle" key={id}><input type="checkbox" checked={settings.events?.[id] !== false} onChange={event => setSettings(value => ({...value, events: {...value.events, [id]: event.target.checked}}))}/>{label}</label>)}</fieldset>
        <label className="bold_notification_toggle"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={event => setSettings({...settings, enabled: event.target.checked})}/>Sonido de notificaciones</label>
        <fieldset disabled={busy}><legend>Sonido</legend>{[...notificationSounds,["custom","Personalizado"]].map(([id,label]) => <label className="bold_notification_choice" key={id}><input type="radio" name="notification-sound" value={id} checked={settings.sound === id} disabled={id === "custom" && !settings.custom_audio} onChange={() => setSettings({...settings, sound: id})}/>{label}</label>)}</fieldset>
        <label>Volumen: {settings.volume}%<input type="range" min="0" max="100" value={settings.volume} disabled={busy} onChange={event => setSettings({...settings, volume: Number(event.target.value)})}/></label>
        <input ref={file} type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" hidden onChange={choose}/><div className="bold_profile_buttons"><button type="button" disabled={busy} onClick={() => file.current.click()}><Upload size={16}/>Subir sonido</button><button type="button" disabled={busy} onClick={preview}><Play size={16}/>Escuchar</button>{settings.custom_audio && <button type="button" disabled={busy} onClick={() => setSettings({...settings, custom_audio: "", custom_name: "", sound: settings.sound === "custom" ? "samsung" : settings.sound})}>Eliminar personalizado</button>}</div>
        <small>{settings.custom_name || "MP3, WAV u OGG; máximo 500 KB y 15 segundos."}</small><p>El navegador permite sonidos después de interactuar con BOLD.</p><fieldset disabled={busy}><legend>Notificaciones de Windows</legend><p>Se muestran mientras BOLD está abierto en el navegador.</p><p>Permiso: {({granted: "Permitido", denied: "Bloqueado", default: "Pendiente", unsupported: "No disponible en este navegador"})[permission]}</p>{permission === "granted" ? <label className="bold_notification_toggle"><input type="checkbox" checked={settings.desktop_enabled} onChange={event => setSettings({...settings, desktop_enabled: event.target.checked})}/>Mostrar notificaciones en Windows</label> : <button type="button" disabled={permission !== "default"} onClick={requestDesktop}>Permitir notificaciones de Windows</button>}{permission === "denied" && <small>Habilítalas en los permisos de este sitio y vuelve a abrir este apartado.</small>}</fieldset><button type="button" disabled={busy} onClick={clearNotifications}>Limpiar notificaciones</button><small>Limpia los avisos del departamento activo; no borra tareas ni eventos.</small><button className="bold_profile_primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar preferencias"}</button>
    </form>}</section>;
}
