import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Download, RotateCcw, X, ZoomIn, ZoomOut} from "lucide-react";

export default function ImageViewer({src, filename, author, createdAt, onClose}) {
    const dialog = useRef(null), stage = useRef(null), picture = useRef(null);
    const [zoom, setZoom] = useState(1), [failed, setFailed] = useState(false);
    useEffect(() => {
        const trigger = document.activeElement, node = dialog.current;
        node.showModal();
        return () => {if (node.open) node.close(); if (trigger?.isConnected) trigger.focus();};
    }, []);
    useEffect(() => {
        const node = stage.current;
        if (node) {node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2; node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;}
    }, [zoom]);
    function fit() {
        const node = picture.current, area = stage.current;
        if (!node || !area || !node.naturalWidth) return;
        const ratio = Math.min(1, (area.clientWidth - 24) / node.naturalWidth, (area.clientHeight - 24) / node.naturalHeight);
        node.style.setProperty("--image_fit_width", `${Math.max(1, Math.floor(node.naturalWidth * ratio))}px`);
    }
    useEffect(() => {
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(fit); observer.observe(stage.current);
        return () => observer.disconnect();
    }, []);
    return createPortal(<dialog ref={dialog} className="messaging_image_viewer" aria-labelledby="chat_image_title" onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if (event.target === dialog.current) onClose();}}>
        <header><div><h2 id="chat_image_title">Imagen compartida</h2><p>{author || "Chat privado"}{createdAt && <> · <time dateTime={createdAt}>{new Date(createdAt).toLocaleString("es", {dateStyle: "medium", timeStyle: "short"})}</time></>}</p></div><button type="button" aria-label="Cerrar imagen" onClick={onClose}><X size={22} aria-hidden="true"/></button></header>
        <div className="messaging_viewer_stage" ref={stage} tabIndex={0} aria-label="Imagen; desplázate para explorar al ampliar">
            {failed ? <p role="alert">No se pudo mostrar la imagen. Cierra el visor y vuelve a intentarlo.</p> : <div className="messaging_viewer_canvas"><img ref={picture} src={src} alt={`Imagen compartida${author ? ` por ${author}` : ""}`} style={{"--image_zoom": zoom}} onLoad={fit} onError={() => setFailed(true)}/></div>}
        </div>
        <footer><div className="messaging_viewer_zoom" role="group" aria-label="Zoom de imagen"><button type="button" aria-label="Alejar imagen" disabled={zoom <= 1 || failed} onClick={() => setZoom(value => Math.max(1, value - .5))}><ZoomOut size={20} aria-hidden="true"/></button><span aria-live="polite">{zoom * 100}%</span><button type="button" aria-label="Ampliar imagen" disabled={zoom >= 3 || failed} onClick={() => setZoom(value => Math.min(3, value + .5))}><ZoomIn size={20} aria-hidden="true"/></button><button type="button" aria-label="Ajustar imagen a la pantalla" disabled={failed} onClick={() => setZoom(1)}><RotateCcw size={18} aria-hidden="true"/></button></div><a href={src} download={filename}><Download size={18} aria-hidden="true"/><span>Descargar</span></a></footer>
    </dialog>, document.body);
}
