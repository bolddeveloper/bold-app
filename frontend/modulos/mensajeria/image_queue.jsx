import {useEffect, useRef, useState} from "react";
import {ImagePlus, Pencil, Trash2, X} from "lucide-react";
import {MAX_QUEUED_IMAGES} from "./image_queue_model.js";

export default function ImageQueue({items, activeId, disabled, onSelect, onEdit, onRemove, onAdd, onClear}) {
    const urls = useRef(new Map()), [previews, setPreviews] = useState(new Map()), [failed, setFailed] = useState(null);
    useEffect(() => {
        const live = new Set(items.map(row => row.id));
        for (const [id, entry] of urls.current) {
            if (!live.has(id) || items.find(row => row.id === id).file !== entry.file) {URL.revokeObjectURL(entry.url); urls.current.delete(id);}
        }
        for (const item of items) if (!urls.current.has(item.id)) urls.current.set(item.id, {file: item.file, url: URL.createObjectURL(item.file)});
        setPreviews(new Map(urls.current));
    }, [items]);
    useEffect(() => () => {for (const entry of urls.current.values()) URL.revokeObjectURL(entry.url); urls.current.clear();}, []);
    const active = items.find(row => row.id === activeId) || items[0], preview = active && previews.get(active.id);
    if (!active) return null;
    return <section className="messaging_image_queue" aria-label="Imágenes listas para enviar" aria-busy={disabled}>
        <header><div><strong>{items.length === 1 ? "1 imagen preparada" : `${items.length} imágenes preparadas`}</strong><small>Revisa cada miniatura; editar es opcional.</small></div><div className="messaging_queue_tools"><button type="button" aria-label="Editar imagen seleccionada" disabled={disabled || active.attempted || failed === preview?.url} onClick={() => onEdit(active)}><Pencil size={17} aria-hidden="true"/><span>Editar</span></button><button type="button" aria-label="Quitar imagen seleccionada" disabled={disabled} onClick={() => onRemove(active)}><Trash2 size={17} aria-hidden="true"/></button><button type="button" aria-label="Quitar todas las imágenes" title="Volver al chat sin enviar las imágenes" disabled={disabled} onClick={onClear}><X size={19} aria-hidden="true"/></button></div></header>
        <div className="messaging_queue_preview">{preview && failed !== preview.url ? <img key={preview.url} src={preview.url} alt={`Vista previa: ${active.file.name}`} onError={() => setFailed(preview.url)}/> : failed === preview?.url ? <p role="alert">No se puede mostrar esta imagen. Puedes quitarla y seleccionar otra.</p> : <p role="status">Preparando vista previa…</p>}</div>
        <div className="messaging_queue_strip" role="group" aria-label="Seleccionar una imagen de la cola">{items.map((item, index) => <button type="button" key={item.id} className="messaging_queue_thumb" aria-label={`Revisar imagen ${index + 1}: ${item.file.name}`} aria-pressed={active.id === item.id} disabled={disabled} onClick={() => onSelect(item.id)}>{previews.has(item.id) && <img src={previews.get(item.id).url} width="56" height="56" loading="lazy" decoding="async" alt=""/>}<span>{index + 1}</span></button>)}<button type="button" className="messaging_queue_add" aria-label="Añadir más imágenes" disabled={disabled || items.length >= MAX_QUEUED_IMAGES} onClick={onAdd}><ImagePlus size={23} aria-hidden="true"/></button></div>
        <small className="messaging_queue_detail">{items.findIndex(row => row.id === active.id) + 1}/{items.length} · {active.file.name} · {(active.file.size / 1024).toFixed(0)} KB</small>
        {active.attempted && !disabled && <p className="messaging_queue_pending" role="status">Envío pendiente de confirmar. Reintenta para confirmar sin duplicar; su contenido queda bloqueado. Quitarla de la cola no elimina una imagen que ya haya llegado.</p>}
    </section>;
}
