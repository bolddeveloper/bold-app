import {useEffect, useRef, useState} from "react";
import {messagingApi} from "../mensajeria/messaging_api.js";
import "./messaging_preferences.css";

export default function MessagingPreferences() {
    const [value, setValue] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const alive = useRef(false), saving = useRef(false);
    useEffect(() => {alive.current = true; const controller = new AbortController(); messagingApi.preferences({signal: controller.signal}).then(result => {if (alive.current) {setValue(result.enter_behavior); setSaved(result.enter_behavior);}}).catch(problem => {if (alive.current && problem.name !== "AbortError") setError("No se pudo cargar tu preferencia de mensajería. Vuelve a abrir este apartado.");}); return () => {alive.current = false; controller.abort();};}, []);
    async function save(event) {
        event.preventDefault(); if (saving.current || !value) return;
        saving.current = true; setBusy(true); setError(""); setNotice("");
        try {const result = await messagingApi.savePreferences(value); if (!alive.current) return; setSaved(result.enter_behavior); setNotice("Preferencia de Enter guardada para tu cuenta."); window.dispatchEvent(new CustomEvent("bold:messaging-preferences", {detail: result}));}
        catch {if (alive.current) setError("No se pudo guardar. Conservamos tu selección; puedes volver a intentarlo.");}
        finally {saving.current = false; if (alive.current) setBusy(false);}
    }
    return <section className="bold_messaging_preferences"><h2>Mensajería</h2><p>Elige cómo escribir y enviar tus mensajes. Se guarda en tu cuenta para los demás dispositivos.</p>{error && <p className="bold_profile_error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {!value ? <p aria-busy={!error}>{error ? "No se ha aplicado ningún cambio." : "Cargando preferencia…"}</p> : <form onSubmit={save}><fieldset disabled={busy}><legend>Comportamiento de Enter</legend>
            <label className="bold_messaging_choice"><input type="radio" name="chat_enter" value="send" checked={value === "send"} onChange={() => {setValue("send"); setNotice("");}}/><span><strong>Enviar el mensaje</strong><small>Enter envía. Mayús + Enter inserta un salto de línea.</small></span></label>
            <label className="bold_messaging_choice"><input type="radio" name="chat_enter" value="newline" checked={value === "newline"} onChange={() => {setValue("newline"); setNotice("");}}/><span><strong>Insertar un salto de línea</strong><small>Enter continúa escribiendo. Usa Enviar, Ctrl + Enter o ⌘ + Enter para mandar el mensaje.</small></span></label>
        </fieldset><div className="bold_profile_buttons"><button className="bold_profile_primary" disabled={busy || value === saved} type="submit">{busy ? "Guardando…" : "Guardar preferencia"}</button></div></form>}
    </section>;
}
