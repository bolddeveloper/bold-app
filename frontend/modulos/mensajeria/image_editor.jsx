import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Crop, Pencil, RotateCcw, X} from "lucide-react";
import {cropRect, imageFileError} from "./media_helpers.js";

export default function ChatImageEditor({file, onSave, onCancel}) {
    const dialog = useRef(null), canvas = useRef(null), image = useRef(null), current = useRef(null);
    const [ready, setReady] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false);
    const [mode, setMode] = useState("crop"), [crop, setCrop] = useState({x: 0, y: 0, w: 100, h: 100});
    const [strokes, setStrokes] = useState([]), [color, setColor] = useState("#ed2635"), [size, setSize] = useState(1600);
    useEffect(() => {
        const returnFocus = document.activeElement;
        dialog.current?.showModal();
        const url = URL.createObjectURL(file), picture = new Image(); let active = true;
        picture.onload = () => {if (!active) return; if (picture.naturalWidth * picture.naturalHeight > 24000000) {setError("La imagen supera los 24 megapíxeles."); return;} image.current = picture; setSize(Math.min(1600, picture.naturalWidth)); setReady(true);};
        picture.onerror = () => active && setError("No se pudo abrir esta imagen."); picture.src = url;
        return () => {active = false; URL.revokeObjectURL(url); returnFocus?.focus?.();};
    }, [file]);
    function draw(context, width, height) {
        context.drawImage(image.current, 0, 0, width, height);
        for (const stroke of strokes) {
            context.strokeStyle = stroke.color; context.lineWidth = Math.max(2, width / 180); context.lineCap = "round"; context.lineJoin = "round";
            context.beginPath(); stroke.points.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height)); context.stroke();
        }
    }
    useEffect(() => {
        if (!ready || !canvas.current) return;
        const node = canvas.current, picture = image.current, ratio = Math.min(1, 1200 / picture.naturalWidth, 700 / picture.naturalHeight);
        node.width = Math.round(picture.naturalWidth * ratio); node.height = Math.round(picture.naturalHeight * ratio);
        const ctx = node.getContext("2d"); draw(ctx, node.width, node.height);
        if (mode === "crop") {
            const [x, y, w, h] = cropRect(node.width, node.height, crop);
            ctx.fillStyle = "#0008"; ctx.beginPath(); ctx.rect(0, 0, node.width, node.height); ctx.rect(x, y, w, h); ctx.fill("evenodd");
            ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.strokeRect(x, y, w, h);
        }
    }, [ready, mode, crop, strokes]);
    const point = event => {const bounds = canvas.current.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];};
    async function save() {
        if (!ready || saving) return;
        setSaving(true); setError("");
        try {
            const picture = image.current, [x, y, w, h] = cropRect(picture.naturalWidth, picture.naturalHeight, crop);
            const requested = Math.min(2560, Math.max(64, Number(size) || 1600), w), intermediate = document.createElement("canvas");
            // Work on a bounded canvas; never allocate a full camera-sized duplicate.
            const ratio = Math.min(1, 2560 / picture.naturalWidth, 2560 / picture.naturalHeight);
            intermediate.width = Math.round(picture.naturalWidth * ratio); intermediate.height = Math.round(picture.naturalHeight * ratio);
            draw(intermediate.getContext("2d"), intermediate.width, intermediate.height);
            const output = document.createElement("canvas"); output.width = Math.round(requested); output.height = Math.max(1, Math.round(h * requested / w));
            if (output.height > 2560) {output.width = Math.max(1, Math.round(output.width * 2560 / output.height)); output.height = 2560;}
            output.getContext("2d").drawImage(intermediate, x * ratio, y * ratio, w * ratio, h * ratio, 0, 0, output.width, output.height);
            const blob = await new Promise(resolve => output.toBlob(resolve, "image/webp", .88));
            if (!blob) throw Error("No se pudo preparar la imagen.");
            const result = new File([blob], "imagen-chat.webp", {type: blob.type}), failure = imageFileError(result);
            if (failure) throw Error(failure);
            onSave(result);
        } catch (err) {setError(err.message || "No se pudo preparar la imagen."); setSaving(false);}
    }
    return createPortal(<dialog ref={dialog} className="messaging_media_dialog" aria-labelledby="chat_image_title" onCancel={event => {event.preventDefault(); if (!saving) onCancel();}}>
        <header><div><h2 id="chat_image_title">Preparar imagen</h2><p>Recorta, ajusta el tamaño o resalta un detalle antes de enviar.</p></div><button type="button" aria-label="Cerrar editor de imagen" disabled={saving} onClick={onCancel}><X size={20} aria-hidden="true"/></button></header>
        <div className="messaging_editor_toolbar"><button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}><Crop size={18} aria-hidden="true"/>Recortar</button><button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}><Pencil size={18} aria-hidden="true"/>Dibujar</button><button type="button" onClick={() => {setStrokes([]); setCrop({x: 0, y: 0, w: 100, h: 100});}}><RotateCcw size={18} aria-hidden="true"/>Restablecer</button></div>
        <div className="messaging_editor_preview"><canvas ref={canvas} aria-label="Vista previa de la imagen con recorte y trazos" style={{touchAction: mode === "draw" ? "none" : "auto"}} onPointerDown={event => {if (mode !== "draw" || !ready) return; event.currentTarget.setPointerCapture(event.pointerId); const stroke = {color, points: [point(event)]}; current.current = stroke; setStrokes(rows => [...rows, stroke]);}} onPointerMove={event => {if (!current.current) return; current.current = {...current.current, points: [...current.current.points, point(event)]}; const stroke = current.current; setStrokes(rows => [...rows.slice(0, -1), stroke]);}} onPointerUp={() => {current.current = null;}} onPointerCancel={() => {current.current = null;}}/></div>
        <div className="messaging_editor_controls">{mode === "crop" ? [["x", "Desde la izquierda", 90], ["y", "Desde arriba", 90], ["w", "Ancho del recorte", 100 - crop.x], ["h", "Alto del recorte", 100 - crop.y]].map(([key, label, max]) => <label key={key}>{label}<input type="range" min={key === "w" || key === "h" ? 10 : 0} max={max} value={crop[key]} onChange={event => {const value = Number(event.target.value); setCrop(row => ({...row, [key]: value, ...(key === "x" ? {w: Math.min(row.w, 100 - value)} : key === "y" ? {h: Math.min(row.h, 100 - value)} : {})}));}}/></label>) : <><label>Color del trazo<input type="color" value={color} onChange={event => setColor(event.target.value)}/></label><button type="button" onClick={() => setStrokes(rows => rows.slice(0, -1))}>Deshacer trazo</button><button type="button" onClick={() => setStrokes(rows => [...rows, {color, points: [[.25,.25],[.75,.25],[.75,.75],[.25,.75],[.25,.25]]}])}>Añadir recuadro</button></>}
        <label>Ancho de salida (píxeles)<input type="number" min="64" max="2560" step="1" value={size} onChange={event => setSize(event.target.value)}/></label></div>
        {error && <p role="alert">{error}</p>}<footer><button type="button" disabled={saving} onClick={onCancel}>Cancelar</button><button type="button" className="messaging_primary" disabled={!ready || saving} onClick={save}>{saving ? "Preparando…" : "Usar imagen"}</button></footer>
    </dialog>, document.body);
}
