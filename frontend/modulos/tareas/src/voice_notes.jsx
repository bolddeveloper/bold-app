import { useEffect, useRef, useState } from "react";
import { Mic, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { http } from "../../core/http_client.js";

function VoicePlayer({ note, resource, resourceId }) {
    const [url, setUrl] = useState(note.data_url || ""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const objectUrl = useRef(""), controller = useRef(null);
    useEffect(() => () => { controller.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
    async function load() {
        setBusy(true); setError(""); controller.current = new AbortController();
        try {
            const blob = await http.request(`/api/v2/${resource}/${resourceId}/voice-note/?note=${encodeURIComponent(note.id)}`, { responseType: "blob", signal: controller.current.signal });
            if (controller.current.signal.aborted) return;
            objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
        } catch (problem) { if (problem.name !== "AbortError") setError(problem.message); }
        finally { setBusy(false); }
    }
    return <div className="voice_note_player"><span>{note.name || "Nota de voz"} · {Math.ceil(note.duration)} s</span>{url ? <audio controls preload="none" src={url} aria-label={note.name || "Nota de voz"} /> : <button type="button" disabled={busy} onClick={load}>{busy ? "Cargando audio…" : "Escuchar nota de voz"}</button>}{error && <small role="alert">{error}</small>}</div>;
}

export function VoiceNotes({ value = [], onChange, onBusyChange, controlsRef, resource = "tasks", resourceId, disabled = false }) {
    const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [seconds, setSeconds] = useState(0), [error, setError] = useState("");
    const [controlsTarget, setControlsTarget] = useState(null);
    const recorder = useRef(null), stream = useRef(null), timer = useRef(null), alive = useRef(true), pending = useRef(false), latest = useRef({ value, onChange });
    latest.current = { value, onChange };
    useEffect(() => { setControlsTarget(controlsRef?.current || null); }, [controlsRef]);
    useEffect(() => { onBusyChange?.(recording || busy); return () => onBusyChange?.(false); }, [recording, busy, onBusyChange]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; clearInterval(timer.current); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); }; }, []);
    const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
    async function start() {
        if (pending.current || recording || disabled || value.length >= 3) return;
        if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { setError("La grabación necesita HTTPS o localhost y un navegador con acceso al micrófono."); return; }
        pending.current = true; setBusy(true); setError("");
        try {
            stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!alive.current) { stream.current.getTracks().forEach(track => track.stop()); return; }
            const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
            if (!mimeType) throw new Error("Este navegador no admite grabar audio compatible. Prueba Chrome, Edge o Safari.");
            const capture = new MediaRecorder(stream.current, { mimeType, audioBitsPerSecond: 32000 });
            recorder.current = capture;
            const chunks = [], started = Date.now();
            capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            capture.onstop = async () => {
                clearInterval(timer.current); stream.current?.getTracks().forEach(track => track.stop());
                if (!alive.current) return;
                setRecording(false); setBusy(true);
                try {
                    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
                    const duration = Math.min(120, Math.max(0.1, (Date.now() - started) / 1000));
                    if (!blob.size || blob.size > 1024 * 1024) throw new Error("La grabación no puede superar 1 MB.");
                    const total = latest.current.value.reduce((sum, item) => sum + (item.size_bytes || 0), 0);
                    if (total + blob.size > 1536 * 1024) throw new Error("Las notas de voz juntas no pueden superar 1,5 MB.");
                    const data_url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("No se pudo leer la grabación.")); reader.readAsDataURL(blob); });
                    if (alive.current) latest.current.onChange([...latest.current.value, { id: `local_${crypto.randomUUID()}`, name: `Nota de voz ${latest.current.value.length + 1}`, duration, mime_type: blob.type, size_bytes: blob.size, data_url }]);
                } catch (problem) { if (alive.current) setError(problem.message); }
                finally { if (alive.current) setBusy(false); }
            };
            capture.onerror = () => { setError("No se pudo completar la grabación."); stop(); };
            capture.start(); setRecording(true); setSeconds(0);
            timer.current = setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= 120) stop(); }, 250);
        } catch (problem) { stream.current?.getTracks().forEach(track => track.stop()); if (alive.current) setError(problem.name === "NotAllowedError" ? "Permite el micrófono en los permisos de este sitio." : problem.message); }
        finally { pending.current = false; if (alive.current) setBusy(false); }
    }
    const label = recording ? "Detener grabación" : busy ? "Preparando audio…" : "Grabar nota de voz";
    const control = onChange && <button className={`detail_comment_image_button voice_record_button${recording ? " is_recording" : ""}`} type="button" aria-label={label} title={label} aria-pressed={recording} disabled={disabled || busy || (!recording && value.length >= 3)} onClick={recording ? stop : start}><Mic size={17} /></button>;
    return <><div className="voice_notes">{value.map(note => <div className="voice_note" key={note.id}><VoicePlayer note={note} resource={resource} resourceId={resourceId} />{onChange && <button type="button" disabled={disabled || busy || recording} aria-label="Quitar nota de voz" onClick={() => onChange(value.filter(item => item.id !== note.id))}><Trash2 size={15} /></button>}</div>)}{recording && <small className="voice_record_status" role="status">Grabando · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</small>}{error && <small role="alert">{error}</small>}</div>{controlsTarget ? createPortal(control, controlsTarget) : controlsRef ? null : control}</>;
}
