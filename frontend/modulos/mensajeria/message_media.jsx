import {useEffect, useRef, useState} from "react";
import {Download, ImageIcon, LoaderCircle, Mic, Square, Trash2} from "lucide-react";
import {messagingApi} from "./messaging_api.js";
import {AUDIO_RATES, MAX_CHAT_FILE, recordingMime} from "./media_helpers.js";

export function VoiceRecorder({disabled, onReady, onError, onRecording}) {
    const [state, setState] = useState("idle"), [seconds, setSeconds] = useState(0);
    const recorder = useRef(null), stream = useRef(null), timer = useRef(null), alive = useRef(true), discard = useRef(false), starting = useRef(false);
    const clean = () => {clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;};
    useEffect(() => {alive.current = true; return () => {alive.current = false; discard.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); clean(); onRecording(false);};}, []);
    function stop(cancel = false) {discard.current = cancel; if (recorder.current?.state === "recording") recorder.current.stop(); clean();}
    async function start() {
        if (starting.current || disabled || state !== "idle") return;
        const mime = recordingMime();
        if (!mime || !navigator.mediaDevices?.getUserMedia) {onError("Este navegador no permite grabar notas de voz. Prueba con una versión reciente y una conexión HTTPS."); return;}
        starting.current = true; setState("requesting"); onRecording(true);
        try {
            const tracks = await navigator.mediaDevices.getUserMedia({audio: true});
            if (!alive.current) {tracks.getTracks().forEach(track => track.stop()); return;}
            stream.current = tracks; discard.current = false;
            const instance = new MediaRecorder(tracks, {mimeType: mime, audioBitsPerSecond: 64000}); recorder.current = instance;
            const chunks = []; let size = 0, elapsed = 0;
            instance.ondataavailable = event => {if (alive.current && event.data.size) {size += event.data.size; chunks.push(event.data); if (size > MAX_CHAT_FILE) {stop(true); onError("La nota de voz supera los 10 MB. Graba una más corta.");}}};
            instance.onerror = () => {stop(true); if (alive.current) {setState("idle"); onRecording(false); onError("No se pudo completar la grabación. No se ha enviado ningún audio.");}};
            instance.onstop = () => {
                clean();
                if (!alive.current) return;
                setState("idle"); onRecording(false);
                if (!discard.current && size && size <= MAX_CHAT_FILE) {
                    const type = instance.mimeType.split(";")[0], ext = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
                    onReady(new File(chunks, `nota-de-voz.${ext}`, {type}));
                }
            };
            instance.start(1000); setSeconds(0); setState("recording");
            timer.current = setInterval(() => {elapsed += 1; setSeconds(elapsed); if (elapsed >= 300) stop();}, 1000);
            tracks.getTracks().forEach(track => {track.onended = () => {if (instance.state === "recording") stop();};});
        } catch (error) {
            clean(); if (alive.current) {setState("idle"); onRecording(false); onError(error.name === "NotAllowedError" ? "Permite el micrófono para grabar. No se ha enviado nada." : "El micrófono no está disponible. Cierra otras grabaciones e inténtalo otra vez.");}
        } finally {starting.current = false;}
    }
    return state === "idle" ? <button type="button" aria-label="Grabar nota de voz" disabled={disabled} onClick={start}><Mic size={20} aria-hidden="true"/></button> : <div className="messaging_recording" role="group" aria-label="Grabación de nota de voz">
        <span role="status">{state === "requesting" ? "Esperando micrófono…" : `Grabando ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
        {state === "recording" && <><button type="button" aria-label="Detener y escuchar grabación" onClick={() => stop()}><Square size={18} aria-hidden="true"/></button><button type="button" aria-label="Descartar grabación" onClick={() => stop(true)}><Trash2 size={18} aria-hidden="true"/></button></>}
    </div>;
}

export function AudioPlayer({src, label = "Nota de voz"}) {
    const audio = useRef(null), [rate, setRate] = useState(1);
    return <div className="messaging_audio"><audio ref={audio} src={src} controls preload="none" aria-label={label}/><button type="button" aria-label={`Velocidad de reproducción: ${rate}×`} onClick={() => {const next = AUDIO_RATES[(AUDIO_RATES.indexOf(rate) + 1) % AUDIO_RATES.length]; setRate(next); if (audio.current) audio.current.playbackRate = next;}}>{rate}×</button></div>;
}

export function MessageMedia({message}) {
    const [url, setUrl] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const host = useRef(null), pending = useRef(false), controller = useRef(null), objectUrl = useRef(null);
    async function load() {
        if (pending.current || objectUrl.current) return;
        pending.current = true; setBusy(true); setError("");
        const abort = new AbortController(); controller.current = abort;
        try {
            const blob = await messagingApi.media(message.conversation_id, message.id, {signal: abort.signal});
            if (abort.signal.aborted) return;
            objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
        } catch (err) {if (!abort.signal.aborted) setError(err.status === 403 || err.status === 404 ? "No tienes acceso a este archivo." : "No se pudo cargar el archivo. Puedes reintentar.");}
        finally {pending.current = false; if (!abort.signal.aborted) setBusy(false);}
    }
    useEffect(() => {
        let observer;
        if (message.media.kind === "image" && typeof IntersectionObserver !== "undefined") {
            observer = new IntersectionObserver(entries => {if (entries.some(entry => entry.isIntersecting)) {observer.disconnect(); load();}}, {rootMargin: "80px"});
            observer.observe(host.current);
        }
        return () => {observer?.disconnect(); controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);};
    }, [message.id]);
    const media = message.media;
    return <div className={`messaging_media messaging_media_${media.kind}`} ref={host}>
        {url ? media.kind === "image" ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Ver imagen completa"><img src={url} width={media.width} height={media.height} alt="Imagen compartida en el chat" onLoad={event => event.currentTarget.dispatchEvent(new CustomEvent("bold:chat-media-loaded", {bubbles: true}))}/></a> : <AudioPlayer src={url}/> : <button type="button" className="messaging_media_load" disabled={busy} onClick={load}>{busy ? <LoaderCircle size={20} className="messaging_spin" aria-hidden="true"/> : media.kind === "image" ? <ImageIcon size={22} aria-hidden="true"/> : <Mic size={22} aria-hidden="true"/>}{busy ? "Cargando…" : media.kind === "image" ? "Cargar imagen" : "Escuchar nota de voz"}</button>}
        {url && <a className="messaging_download" href={url} download={`bold-${media.kind}-${media.id}.${media.mime_type.split("/")[1] === "mp4" ? "m4a" : media.mime_type.split("/")[1]}`}><Download size={15} aria-hidden="true"/>Descargar {media.kind === "image" ? "imagen" : "audio"}</a>}
        {error && <p role="alert">{error}</p>}
    </div>;
}

export function MediaDraft({file, onRemove, onEdit, disabled}) {
    const [url, setUrl] = useState(null);
    useEffect(() => {const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value);}, [file]);
    return <div className="messaging_media_draft">{file.type.startsWith("image/") ? <><img src={url || undefined} alt="Imagen preparada para enviar"/><button type="button" disabled={disabled} onClick={onEdit}>Editar imagen</button></> : url && <AudioPlayer src={url} label="Escuchar nota antes de enviar"/>}<button type="button" disabled={disabled} aria-label="Quitar adjunto" onClick={onRemove}><Trash2 size={18} aria-hidden="true"/></button><small>Aún no enviado · {(file.size / 1024).toFixed(0)} KB</small></div>;
}
