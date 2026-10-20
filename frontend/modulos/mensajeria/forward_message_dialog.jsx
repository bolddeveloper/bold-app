import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Forward, ImageIcon, LoaderCircle, Search, X} from "lucide-react";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {initials, messageError, normalizeQuery} from "./messaging_models.js";

export default function ForwardMessageDialog({source, people, forward, onSent, onClose}) {
    const dialog = useRef(null), search = useRef(null), controller = useRef(null), busy = useRef(false), mounted = useRef(false);
    const [query, setQuery] = useState(""), [recipient, setRecipient] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState("");
    const person = people.find(row => row.employee_id === recipient);
    const matches = people.filter(row => normalizeQuery(row.name).includes(normalizeQuery(query)));
    useEffect(() => {
        mounted.current = true;
        const trigger = document.activeElement, node = dialog.current;
        node.showModal(); search.current?.focus();
        return () => {mounted.current = false; controller.current?.abort(); if (node.open) node.close(); if (trigger?.isConnected) trigger.focus();};
    }, []);
    async function submit(event) {
        event.preventDefault();
        if (busy.current || !person) return;
        busy.current = true; setSending(true); setError("");
        const request = new AbortController(); controller.current = request;
        try {
            const result = await forward(source, person.employee_id, {signal: request.signal});
            if (!mounted.current || request.signal.aborted) return;
            onSent(result, person); onClose();
        } catch (err) {
            if (mounted.current && !request.signal.aborted) setError(`${messageError(err)} Si no recibiste confirmación, reintenta al mismo destinatario: no se duplicará el envío. Cerrar no deshace un mensaje que ya haya llegado.`);
        } finally {busy.current = false; if (mounted.current) setSending(false);}
    }
    return createPortal(<dialog ref={dialog} className="messaging_media_dialog messaging_forward_dialog" aria-labelledby="chat_forward_title" aria-describedby="chat_forward_privacy" onCancel={event => {event.preventDefault(); if (!busy.current) onClose();}}>
        <header><div><h2 id="chat_forward_title">Reenviar a un chat</h2><p id="chat_forward_privacy">Se enviará una copia como mensaje tuyo. No se comparte el acceso al chat original.</p></div><button type="button" aria-label="Cerrar reenvío" disabled={sending} onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
        <div className="messaging_forward_preview">{source.media && <span><ImageIcon size={18} aria-hidden="true"/> Imagen{source.body ? " con descripción" : ""}</span>}{source.body && <p>{source.body}</p>}</div>
        <form onSubmit={submit} aria-busy={sending}>
            <label className="messaging_forward_search"><span>Buscar destinatario de IT</span><span><Search size={18} aria-hidden="true"/><input ref={search} type="search" value={query} disabled={sending} onChange={event => setQuery(event.target.value)} placeholder="Nombre del empleado"/></span></label>
            <fieldset className="messaging_forward_people" disabled={sending}><legend>Selecciona un destinatario</legend>{matches.map(row => <label key={row.employee_id} className="messaging_forward_person"><input type="radio" name="forward_recipient" value={row.employee_id} checked={recipient === row.employee_id} onChange={() => {setRecipient(row.employee_id); setError("");}}/><span className="messaging_avatar" aria-hidden="true"><AvatarImage url={row.avatar_url} initials={initials(row.name)}/></span><span>{row.name}</span></label>)}{!matches.length && <p>No hay destinatarios de IT con este nombre.</p>}</fieldset>
            {error && <p role="alert" className="messaging_error">{error}</p>}
            {sending && <p role="status">Preparando y enviando la copia…</p>}
            <footer><span>{person ? `Para: ${person.name}` : "Un destinatario por reenvío"}</span><button type="submit" className="messaging_primary" disabled={sending || !person}>{sending ? <LoaderCircle size={18} aria-hidden="true"/> : <Forward size={18} aria-hidden="true"/>}{sending ? "Reenviando…" : "Reenviar"}</button></footer>
        </form>
    </dialog>, document.body);
}
