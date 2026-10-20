import {lazy, Suspense, useEffect, useRef, useState} from "react";
import {ImageIcon, LoaderCircle, Mic, Pause, Play, Square, Trash2} from "lucide-react";
import {messagingApi} from "./messaging_api.js";
import {AUDIO_RATES, MAX_CHAT_FILE, audioTime, recordingMime, waveformPeaks} from "./media_helpers.js";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {initials} from "./messaging_models.js";
const ImageViewer = lazy(() => import("./image_viewer.jsx"));

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

export function AudioPlayer({src, file, loadSource, author, label = "Nota de voz"}) {
    const audio = useRef(null), alive = useRef(true), pending = useRef(false), decoded = useRef(false), decoder = useRef(null);
    const [rate, setRate] = useState(1), [playing, setPlaying] = useState(false), [busy, setBusy] = useState(false);
    const [elapsed, setElapsed] = useState(0), [duration, setDuration] = useState(0), [error, setError] = useState("");
    const [peaks, setPeaks] = useState(Array(32).fill(.18));
    useEffect(() => {
        alive.current = true;
        const exclusive = event => {if (event.detail !== audio.current) audio.current?.pause();};
        window.addEventListener("bold:chat-audio-play", exclusive);
        return () => {alive.current = false; audio.current?.pause(); decoder.current?.close().catch(() => {}); window.removeEventListener("bold:chat-audio-play", exclusive);};
    }, []);
    async function waveform(blob) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context || !blob?.arrayBuffer || decoded.current) return;
        decoded.current = true;
        try {
            const context = new Context({sampleRate: 16000}); decoder.current = context;
            const buffer = await context.decodeAudioData(await blob.arrayBuffer());
            if (alive.current) {setPeaks(waveformPeaks(buffer.getChannelData(0))); if (Number.isFinite(buffer.duration)) setDuration(buffer.duration);}
        } catch { /* Some playable browser codecs cannot be decoded. Keep a neutral progress track. */ }
        finally {const context = decoder.current; decoder.current = null; if (context && context.state !== "closed") await context.close().catch(() => {});}
    }
    async function toggle() {
        if (pending.current) return;
        if (playing) {audio.current.pause(); return;}
        pending.current = true; setBusy(true); setError("");
        try {
            const source = src ? {url: src, blob: file} : await loadSource?.();
            if (!alive.current || !source?.url) return;
            const node = audio.current;
            if (node.getAttribute("src") !== source.url) node.src = source.url;
            node.playbackRate = rate;
            if (node.ended) node.currentTime = 0;
            await node.play();
            if (alive.current) void waveform(source.blob);
        } catch {if (alive.current) setError("No se pudo reproducir la nota. Vuelve a pulsar reproducir; comprueba tu conexión y el formato del audio.");}
        finally {pending.current = false; if (alive.current) setBusy(false);}
    }
    const progress = duration > 0 ? Math.min(100, elapsed / duration * 100) : 0;
    const metadata = () => {if (Number.isFinite(audio.current.duration)) setDuration(audio.current.duration);};
    return <div className="messaging_audio" role="group" aria-label={label}>
        <audio ref={audio} src={src || undefined} preload="none" onPlay={() => {setPlaying(true); window.dispatchEvent(new CustomEvent("bold:chat-audio-play", {detail: audio.current}));}} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onLoadedMetadata={metadata} onDurationChange={metadata} onTimeUpdate={() => setElapsed(audio.current.currentTime || 0)} onError={() => {setBusy(false); setPlaying(false); setError("Este navegador no pudo reproducir el audio. Inténtalo de nuevo o prueba otro navegador.");}}/>
        <button type="button" className="messaging_audio_play" aria-label={busy ? "Cargando nota de voz" : playing ? "Pausar nota de voz" : "Reproducir nota de voz"} disabled={busy} onClick={toggle}>{busy ? <LoaderCircle size={22} className="messaging_spin" aria-hidden="true"/> : playing ? <Pause size={22} fill="currentColor" aria-hidden="true"/> : <Play size={22} fill="currentColor" aria-hidden="true"/>}</button>
        <div className="messaging_audio_track"><div className="messaging_waveform" style={{"--audio_progress": `${progress}%`}}><div className="messaging_wave_bars" aria-hidden="true">{peaks.map((peak, index) => <i key={index} data-played={index / peaks.length * 100 < progress} style={{height: `${Math.max(4, Math.round(peak * 26))}px`}}/>)}</div><span className="messaging_wave_thumb" aria-hidden="true"/><input type="range" min="0" max={duration || 1} step=".1" value={Math.min(elapsed, duration || 0)} disabled={!duration} aria-label="Posición de la nota de voz" aria-valuetext={`${audioTime(elapsed)} de ${audioTime(duration)}`} onChange={event => {const value = Number(event.target.value); audio.current.currentTime = value; setElapsed(value);}}/></div><div className="messaging_audio_meta"><span>{elapsed || duration ? audioTime(elapsed || duration) : "—:—"}</span></div></div>
        <button type="button" className="messaging_audio_rate" aria-label={`Velocidad de reproducción: ${rate}×`} onClick={() => {const next = AUDIO_RATES[(AUDIO_RATES.indexOf(rate) + 1) % AUDIO_RATES.length]; setRate(next); audio.current.playbackRate = next;}}>{rate}×</button>
        <span className="messaging_audio_avatar" aria-hidden="true">{author ? <AvatarImage url={author.avatar_url} initials={initials(author.name)}/> : <Mic size={22}/>}<Mic className="messaging_audio_mic" size={14}/></span>
        {error && <p className="messaging_audio_error" role="alert">{error}</p>}
    </div>;
}

export function MessageMedia({message, author}) {
    const [url, setUrl] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [viewing, setViewing] = useState(false);
    const host = useRef(null), pending = useRef(false), controller = useRef(null), objectUrl = useRef(null), sourceBlob = useRef(null);
    async function load() {
        if (objectUrl.current) return {url: objectUrl.current, blob: sourceBlob.current};
        if (pending.current) return;
        pending.current = true; setBusy(true); setError("");
        const abort = new AbortController(); controller.current = abort;
        try {
            const blob = await messagingApi.media(message.conversation_id, message.id, {signal: abort.signal});
            if (abort.signal.aborted) return;
            sourceBlob.current = blob; objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
            return {url: objectUrl.current, blob};
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
        {media.kind === "audio" ? <AudioPlayer loadSource={load} author={author}/> : url ? <button type="button" className="messaging_image_open" aria-label="Ver imagen completa" onClick={() => setViewing(true)}><img src={url} width={media.width} height={media.height} alt="Imagen compartida en el chat" onLoad={event => event.currentTarget.dispatchEvent(new CustomEvent("bold:chat-media-loaded", {bubbles: true}))}/></button> : <button type="button" className="messaging_media_load" disabled={busy} onClick={load}>{busy ? <LoaderCircle size={20} className="messaging_spin" aria-hidden="true"/> : <ImageIcon size={22} aria-hidden="true"/>}{busy ? "Cargando…" : "Cargar imagen"}</button>}
        {error && <p role="alert">{error}</p>}
        {viewing && <Suspense fallback={<p role="status">Abriendo imagen…</p>}><ImageViewer src={url} author={author?.name} createdAt={message.created_at} filename={`bold-imagen-${media.id}.${media.mime_type.split("/")[1]}`} onClose={() => setViewing(false)}/></Suspense>}
    </div>;
}

export function MediaDraft({file, onRemove, onEdit, disabled}) {
    const [url, setUrl] = useState(null);
    useEffect(() => {const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value);}, [file]);
    return <div className="messaging_media_draft">{file.type.startsWith("image/") ? <><img src={url || undefined} alt="Imagen preparada para enviar"/><button type="button" disabled={disabled} onClick={onEdit}>Editar imagen</button></> : url && <AudioPlayer key={url} src={url} file={file} label="Escuchar nota antes de enviar"/>}<button type="button" disabled={disabled} aria-label="Quitar adjunto" onClick={onRemove}><Trash2 size={18} aria-hidden="true"/></button><small>Aún no enviado · {(file.size / 1024).toFixed(0)} KB</small></div>;
}
