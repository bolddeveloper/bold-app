import ColorPicker from "../core/shared/color_picker.jsx";
/* Slide filmstrip, editable canvas, object properties and presentation mode. */
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Copy, Trash2, Type, Image, Square, Move, Play, X, Bold, Italic, ChevronLeft, ChevronRight } from "lucide-react";
import { cssRgb, googleRgb, pointValue, shapeText, slideTextChanges } from "./editor_helpers.js";

const identity = prefix => `${prefix}_${crypto.randomUUID().replaceAll("-", "_")}`;
const transformOf = element => ({scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, ...element.transform,
    translateX: (element.transform?.translateX || 0) / (element.transform?.unit === "EMU" ? 12700 : 1),
    translateY: (element.transform?.translateY || 0) / (element.transform?.unit === "EMU" ? 12700 : 1), unit: "PT"});

export default function PresentationEditor({ref, model, canEdit, zoom, onDirty, apply, position, onPosition}) {
    const slides = model.content.slides || [], [active, setActive] = useState(Math.max(0, Math.min(slides.length - 1, position?.slideIndex || 0))), [selected, setSelected] = useState("");
    const slide = slides[active], [texts, setTexts] = useState({}), [transforms, setTransforms] = useState({});
    const [presenting, setPresenting] = useState(false), [notice, setNotice] = useState("");
    const drag = useRef(null), presentation = useRef(null);
    const width = pointValue(model.content.pageSize?.width) || 720, height = pointValue(model.content.pageSize?.height) || 405;
    function allElements(elements = []) {return elements.flatMap(element => [element, ...allElements(element.elementGroup?.children)]);}
    const selectedElement = allElements(slide?.pageElements).find(element => element.objectId === selected);
    useImperativeHandle(ref, () => ({changes: () => [...slideTextChanges(texts, Object.fromEntries(slides.flatMap(slide => allElements(slide.pageElements)).filter(element => element.shape).map(element => [element.objectId, shapeText(element)]))), ...Object.entries(transforms).map(([objectId, transform]) => ({updatePageElementTransform: {objectId, transform, applyMode: "ABSOLUTE"}}))]}));
    useEffect(() => {onPosition?.({slideIndex: active});}, [active]);
    useEffect(() => {
        if (!presenting) return;
        const previous = document.activeElement;
        presentation.current.querySelector("button")?.focus();
        const key = event => {
            if (event.key === "Escape") setPresenting(false);
            if (event.key === "ArrowRight" || event.key === " ") {event.preventDefault(); setActive(value => Math.min(slides.length - 1, value + 1));}
            if (event.key === "ArrowLeft") {event.preventDefault(); setActive(value => Math.max(0, value - 1));}
            if (event.key === "Tab") {
                const buttons = [...presentation.current.querySelectorAll("button:not(:disabled)")], first = buttons[0], last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
                if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
            }
        };
        document.addEventListener("keydown", key);
        return () => {document.removeEventListener("keydown", key); previous?.focus();};
    }, [presenting]);
    function dirty(nextTexts, nextTransforms) {onDirty(Object.keys(nextTexts).length > 0 || Object.keys(nextTransforms).length > 0);}
    function changeText(element, value) {
        const next = {...texts};
        if (value === shapeText(element)) delete next[element.objectId]; else next[element.objectId] = value;
        setTexts(next); dirty(next, transforms);
    }
    function changeTransform(element, value) {
        const next = {...transforms, [element.objectId]: {...transformOf(element), ...value}};
        if (JSON.stringify(next[element.objectId]) === JSON.stringify(transformOf(element))) delete next[element.objectId];
        setTransforms(next); dirty(texts, next);
    }
    async function createSlide() {apply([{createSlide: {objectId: identity("slide"), insertionIndex: slides.length, slideLayoutReference: {predefinedLayout: "BLANK"}}}]);}
    async function createShape(shapeType = "TEXT_BOX") {
        if (!slide) {setNotice("Añade una diapositiva antes de insertar objetos."); return;}
        const objectId = identity("shape");
        apply([{createShape: {objectId, shapeType, elementProperties: {pageObjectId: slide.objectId, size: {width: {magnitude: 240, unit: "PT"}, height: {magnitude: 80, unit: "PT"}}, transform: {scaleX: 1, scaleY: 1, translateX: 50, translateY: 50, unit: "PT"}}}}, ...(shapeType === "TEXT_BOX" ? [{insertText: {objectId, text: "Escribe aquí", insertionIndex: 0}}] : [])]);
    }
    function createImage() {
        if (!slide) return;
        const url = window.prompt("URL pública HTTPS de la imagen");
        if (!url) return;
        if (!url.startsWith("https://")) {setNotice("Usa una URL HTTPS accesible para Google."); return;}
        apply([{createImage: {objectId: identity("image"), url, elementProperties: {pageObjectId: slide.objectId, size: {width: {magnitude: 240, unit: "PT"}, height: {magnitude: 180, unit: "PT"}}, transform: {scaleX: 1, scaleY: 1, translateX: 50, translateY: 50, unit: "PT"}}}}]);
    }
    function textFormat(style) {
        if (!selectedElement?.shape) {setNotice("Selecciona un cuadro de texto."); return;}
        apply([{updateTextStyle: {objectId: selected, textRange: {type: "ALL"}, style, fields: Object.keys(style).join(",")}}]);
    }
    function renderElements(elements = [], interactive = false) {
        return elements.map(element => {
            const transform = transforms[element.objectId] || transformOf(element), size = element.size || {};
            const shape = element.shape, style = shape?.text?.textElements?.find(run => run.textRun)?.textRun?.style || {};
            const visual = {width: pointValue(size.width) || 80, height: pointValue(size.height) || 40,
                transform: `matrix(${transform.scaleX},${transform.shearY},${transform.shearX},${transform.scaleY},${transform.translateX},${transform.translateY})`,
                backgroundColor: cssRgb(shape?.shapeProperties?.shapeBackgroundFill?.solidFill?.color?.rgbColor),
                borderRadius: shape?.shapeType === "ELLIPSE" ? "50%" : undefined};
            return <div key={element.objectId} className={`editor_slide_object ${interactive && selected === element.objectId ? "editor_object_selected" : ""}`} style={visual} onClick={event => {if (interactive) {event.stopPropagation(); setSelected(element.objectId);}}}>
                {element.elementGroup ? renderElements(element.elementGroup.children, false) : element.image ? <img draggable="false" src={/^https:\/\//.test(element.image.contentUrl || "") ? element.image.contentUrl : undefined} alt={element.title || "Imagen de diapositiva"}/> : shape ? <textarea tabIndex={interactive ? 0 : -1} aria-label={element.title || `Texto ${element.objectId}`} value={texts[element.objectId] ?? shapeText(element)} readOnly={!interactive || !canEdit} onChange={event => changeText(element, event.target.value)} style={{fontWeight: style.bold ? 700 : undefined, fontStyle: style.italic ? "italic" : undefined, fontFamily: style.fontFamily, fontSize: `${pointValue(style.fontSize) || 18}px`, color: cssRgb(style.foregroundColor?.opaqueColor?.rgbColor)}}/> : <span className="editor_slide_advanced">{element.table ? "Tabla" : element.sheetsChart ? "Gráfico de Sheets" : element.video ? "Vídeo" : "Elemento avanzado"}</span>}
                {interactive && selected === element.objectId && canEdit && <button className="editor_drag_handle" aria-label="Mover objeto" title="Arrastrar objeto" onPointerDown={event => {
                    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {x: event.clientX, y: event.clientY, transform};
                }} onPointerMove={event => {
                    if (!drag.current) return;
                    changeTransform(element, {...drag.current.transform, translateX: drag.current.transform.translateX + (event.clientX - drag.current.x) / (zoom / 100), translateY: drag.current.transform.translateY + (event.clientY - drag.current.y) / (zoom / 100)});
                }} onPointerUp={() => {drag.current = null;}} onPointerCancel={() => {drag.current = null;}}><Move size={13}/></button>}
            </div>;
        });
    }
    function canvas(page, interactive = false) {
        return <div className="editor_slide_canvas" style={{width, height, backgroundColor: cssRgb(page?.pageProperties?.pageBackgroundFill?.solidFill?.color?.rgbColor) || "#ffffff"}} onClick={() => interactive && setSelected("")}>{renderElements(page?.pageElements, interactive)}</div>;
    }
    const transform = selectedElement ? transforms[selected] || transformOf(selectedElement) : null;
    return <>
        <div className="editor_toolbar" role="toolbar" aria-label="Herramientas de presentación">
            <button onClick={createSlide} disabled={!canEdit}><Plus size={17}/>Diapositiva</button>
            <button disabled={!canEdit || !slide} onClick={() => apply([{duplicateObject: {objectId: slide.objectId}}])}><Copy size={16}/>Duplicar</button>
            <button disabled={!canEdit || !slide} onClick={() => {if (window.confirm("¿Eliminar esta diapositiva? Puedes recuperar versiones desde Google.")) apply([{deleteObject: {objectId: slide.objectId}}]);}}><Trash2 size={16}/>Eliminar diapositiva</button>
            <button onClick={() => createShape()} disabled={!canEdit}><Type size={17}/>Texto</button>
            <button onClick={() => createShape("RECTANGLE")} disabled={!canEdit}><Square size={16}/>Forma</button>
            <button onClick={createImage} disabled={!canEdit}><Image size={16}/>Imagen</button>
            <button aria-label="Negrita" disabled={!canEdit || !selectedElement?.shape} onClick={() => textFormat({bold: true})}><Bold size={17}/></button>
            <button aria-label="Cursiva" disabled={!canEdit || !selectedElement?.shape} onClick={() => textFormat({italic: true})}><Italic size={17}/></button>
            <select aria-label="Tamaño de texto de diapositiva" disabled={!canEdit || !selectedElement?.shape} defaultValue="18" onChange={event => textFormat({fontSize: {magnitude: Number(event.target.value), unit: "PT"}})}>{[12, 14, 18, 24, 30, 36, 48, 60].map(size => <option key={size}>{size}</option>)}</select>
            <label>Fondo<ColorPicker label="Color de fondo de diapositiva" disabled={!canEdit || !slide} value="#ffffff" commitOnly onChange={color => apply([{updatePageProperties: {objectId: slide.objectId, pageProperties: {pageBackgroundFill: {solidFill: {color: {rgbColor: googleRgb(color)}, alpha: 1}}}, fields: "pageBackgroundFill"}}])}/></label>
            <button disabled={!slides.length} onClick={() => setPresenting(true)}><Play size={16}/>Presentar</button>
        </div>
        {notice && <p className="editor_notice" role="status">{notice}<button onClick={() => setNotice("")}>Cerrar</button></p>}
        <div className="editor_slides_layout">
            <aside className="editor_filmstrip" aria-label="Diapositivas">{slides.map((item, index) => <button key={item.objectId} aria-label={`Diapositiva ${index + 1}`} aria-pressed={index === active} onClick={() => {setActive(index); setSelected("");}}><span>{index + 1}</span><div className="editor_slide_thumbnail" aria-hidden="true"><div style={{transform: `scale(${150 / width})`, transformOrigin: "top left"}}>{canvas(item)}</div></div></button>)}</aside>
            <div className="editor_slide_scroll"><div style={{zoom: zoom / 100}}>{canvas(slide, true)}</div><p className="editor_slide_hint">Selecciona texto para editar. Arrastra desde el icono de movimiento. Guarda para sincronizar con Google.</p>{!slides.length && <button onClick={createSlide} disabled={!canEdit}>Crear primera diapositiva</button>}</div>
            <aside className="editor_object_properties"><h3>Objeto seleccionado</h3>{selectedElement ? <>
                <p>{selectedElement.shape ? "Forma / texto" : selectedElement.image ? "Imagen" : "Elemento avanzado"}</p>
                <label>Posición X<input type="number" value={Math.round(transform.translateX)} disabled={!canEdit} onChange={event => changeTransform(selectedElement, {translateX: Number(event.target.value)})}/></label>
                <label>Posición Y<input type="number" value={Math.round(transform.translateY)} disabled={!canEdit} onChange={event => changeTransform(selectedElement, {translateY: Number(event.target.value)})}/></label>
                <label>Escala horizontal<input type="number" min="0.1" max="20" step="0.1" value={transform.scaleX} disabled={!canEdit} onChange={event => changeTransform(selectedElement, {scaleX: Number(event.target.value) || 1})}/></label>
                <label>Escala vertical<input type="number" min="0.1" max="20" step="0.1" value={transform.scaleY} disabled={!canEdit} onChange={event => changeTransform(selectedElement, {scaleY: Number(event.target.value) || 1})}/></label>
                {selectedElement.shape && <label>Color de forma<ColorPicker label="Color de forma" value="#ffffff" disabled={!canEdit} commitOnly onChange={color => apply([{updateShapeProperties: {objectId: selected, shapeProperties: {shapeBackgroundFill: {solidFill: {color: {rgbColor: googleRgb(color)}, alpha: 1}}}, fields: "shapeBackgroundFill"}}])}/></label>}
                <button disabled={!canEdit} onClick={() => apply([{duplicateObject: {objectId: selected}}])}><Copy size={15}/>Duplicar objeto</button>
                <button disabled={!canEdit} onClick={() => {if (window.confirm("¿Eliminar el objeto seleccionado?")) apply([{deleteObject: {objectId: selected}}]);}}><Trash2 size={15}/>Eliminar objeto</button>
            </> : <p>Selecciona un objeto en el lienzo.</p>}<small>Elementos avanzados y animaciones originales se conservan. Usa Google para editar sus opciones.</small></aside>
        </div>
        {presenting && createPortal(<section ref={presentation} className="editor_presentation" role="dialog" aria-modal="true" aria-label="Presentación"><header><span>Diapositiva {active + 1} de {slides.length}</span><button onClick={() => setPresenting(false)} aria-label="Cerrar presentación"><X size={22}/></button></header><div className="editor_present_canvas">{canvas(slide)}</div><footer><button disabled={!active} onClick={() => setActive(Math.max(0, active - 1))} aria-label="Diapositiva anterior"><ChevronLeft/></button><button disabled={active === slides.length - 1} onClick={() => setActive(Math.min(slides.length - 1, active + 1))} aria-label="Diapositiva siguiente"><ChevronRight/></button></footer></section>, document.body)}
    </>;
}
