import {CachedImage} from "../../core/shared/cached_image.jsx";
import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut} from "lucide-react";
import {useDialog} from "../../core/shared/use_dialog.js";
import {http, is_using_real_backend} from "../../core/http_client.js";
import {richImageSources} from "./rich_text.js";
import {zoomImage} from "./image_zoom.js";
import "./image_gallery.css";

function ZoomableImage({src, alt, onError}) {
    const [view, setView] = useState({scale: 1, x: 0, y: 0});
    const stage = useRef(null), drag = useRef(null);
    const zoom = factor => setView(current => zoomImage(current, factor));
    useEffect(() => {
        const element = stage.current;
        const wheel = event => {
            event.preventDefault();
            if (event.deltaY) setView(current => zoomImage(current, event.deltaY < 0 ? 1.1 : 1 / 1.1));
        };
        // A non-passive listener prevents browser zoom and page scrolling inside the viewer.
        element.addEventListener("wheel", wheel, {passive: false});
        return () => element.removeEventListener("wheel", wheel);
    }, []);
    return <>
        <div ref={stage} className={`task_image_zoom_stage${view.scale > 1 ? " is_zoomed" : ""}`}
            onPointerDown={event => {
                if (event.button !== 0 || view.scale <= 1) return;
                event.preventDefault();
                drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY};
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
                if (drag.current?.id !== event.pointerId) return;
                const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
                drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY};
                setView(current => current.scale > 1 ? {...current, x: current.x + dx, y: current.y + dy} : current);
            }}
            onPointerUp={event => {
                drag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {drag.current = null;}}
            onLostPointerCapture={() => {drag.current = null;}}>
            <CachedImage className="task_image_full" src={src} alt={alt} draggable={false} style={{transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`}} onError={onError}/>
        </div>
        <div className="task_image_zoom_controls" role="group" aria-label="Zoom de imagen">
            <button type="button" aria-label="Reducir imagen" title="Reducir" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.25)}><ZoomOut size={20}/></button>
            <button type="button" className="task_image_zoom_reset" aria-label="Restablecer zoom" title="Restablecer zoom" onClick={() => setView({scale: 1, x: 0, y: 0})}>{Math.round(view.scale * 100)}%</button>
            <button type="button" aria-label="Aumentar imagen" title="Aumentar" disabled={view.scale >= 4} onClick={() => zoom(1.25)}><ZoomIn size={20}/></button>
        </div>
    </>;
}

export function ImageGallery({images, onRemove, disabled = false, taskId, history = false, imageSection, imageProjectId}) {
    const [viewer, setViewer] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
    const overlay = useRef(null);
    const opened = Boolean(viewer);
    const close = () => setViewer(null);
    useEffect(() => {
        if (!opened) return;
        const element = overlay.current;
        // Native dialogs keep the viewer above other modal dialogs, including suggestion details.
        element.showModal();
        return () => element.close();
    }, [opened]);
    useDialog(Boolean(viewer), ".task_image_viewer", close);
    function open(index, event) {
        event.stopPropagation();
        let sources = images;
        if (history) {
            const buttons = [...(event.currentTarget.closest(".task_comments_history")?.querySelectorAll("[data-gallery-image]") || [])];
            sources = buttons.filter(button => !taskId || button.dataset.galleryTask === String(taskId)).map(button => button.dataset.galleryImage);
        }
        sources = [...new Set([...sources, ...images])];
        setError("");
        setViewer({sources, index: Math.max(0, sources.indexOf(images[index]))});
    }
    function move(step) {
        setViewer(current => current && ({...current, index: (current.index + step + current.sources.length) % current.sources.length}));
    }
    useEffect(() => {
        if (!opened || !history || !taskId || !is_using_real_backend()) return;
        const controller = new AbortController();
        setLoading(true);
        http.list("comments", {task: taskId, ...(imageSection === "timeline" ? {image_section: "timeline", ...(imageProjectId ? {project: imageProjectId} : {})} : {})}, {signal: controller.signal}).then(comments => {
            const sources = [...new Set(comments.flatMap(comment => [...richImageSources(comment.body || ""), ...(comment.images || []).map(image => image.url)]))];
            if (!controller.signal.aborted) setViewer(current => {
                if (!current) return current;
                const selected = current.sources[current.index];
                if (!sources.includes(selected)) sources.unshift(selected);
                return {sources, index: sources.indexOf(selected)};
            });
        }).catch(problem => {if (!controller.signal.aborted && problem.name !== "AbortError") setError("No se pudo cargar todo el historial. Se muestran las imágenes disponibles.");})
            .finally(() => {if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    }, [opened, history, taskId, imageSection, imageProjectId]);
    useEffect(() => {
        if (!opened) return;
        const keydown = event => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {event.preventDefault(); event.stopPropagation(); move(event.key === "ArrowLeft" ? -1 : 1);}
        };
        window.addEventListener("keydown", keydown);
        return () => window.removeEventListener("keydown", keydown);
    }, [opened]);
    if (!images.length) return null;
    return <>
        <div className="task_text_image_previews">{images.map((src, index) => <span key={index}>
            <button type="button" className="task_image_thumbnail" data-gallery-image={src} data-gallery-task={taskId || ""} aria-label={`Ampliar imagen ${index + 1}`} onClick={event => open(index, event)}><CachedImage src={src} alt={`Imagen adjunta ${index + 1}`} loading="lazy"/></button>
            {onRemove && <button type="button" className="task_image_remove" aria-label={`Quitar imagen ${index + 1}`} title="Quitar imagen" disabled={disabled} onClick={event => {event.stopPropagation(); onRemove(index);}}><X size={12}/></button>}
        </span>)}</div>
        {viewer && createPortal(<dialog ref={overlay} className="task_image_viewer_overlay" aria-label="Visor de imágenes" onCancel={event => {event.preventDefault(); event.stopPropagation(); close();}} onPointerDown={event => {if (event.target === event.currentTarget) close();}}>
            <section className="task_image_viewer">
                <button type="button" className="task_image_viewer_close" aria-label="Cerrar imagen" title="Cerrar (Esc)" onClick={close}><X size={23}/></button>
                {viewer.sources.length > 1 && <button type="button" className="task_image_viewer_previous" aria-label="Imagen anterior" onClick={() => move(-1)}><ChevronLeft size={30}/></button>}
                <ZoomableImage key={viewer.sources[viewer.index]} src={viewer.sources[viewer.index]} alt={`Imagen ${viewer.index + 1} de ${viewer.sources.length}`} onError={() => setError("No se pudo cargar esta imagen. Comprueba tu conexión y el acceso a Drive.")}/>
                {viewer.sources.length > 1 && <button type="button" className="task_image_viewer_next" aria-label="Imagen siguiente" onClick={() => move(1)}><ChevronRight size={30}/></button>}
                <div className="task_image_viewer_status" aria-live="polite"><span>{viewer.index + 1} / {viewer.sources.length}</span>{loading && <small>Cargando imágenes del historial…</small>}{error && <small role="alert">{error}</small>}</div>
            </section>
        </dialog>, document.getElementById("bold-overlay-root") || document.body)}
    </>;
}
