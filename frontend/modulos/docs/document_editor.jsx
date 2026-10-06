import {promptBold} from "../core/shared/bold_dialog.js";
import ColorPicker from "../core/shared/color_picker.jsx";
/* Document page, rich text controls and Google paragraph/table rendering. */
import { useImperativeHandle, useRef, useState } from "react";
import { Bold, Italic, Underline, Strikethrough, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Link, Image, Table2, Plus } from "lucide-react";
import { cssRgb, documentChanges, documentParagraphs, documentTabs, paragraphText, pointValue } from "./editor_helpers.js";

const editableStyleFields = ["bold", "italic", "underline", "strikethrough", "fontSize", "weightedFontFamily", "foregroundColor", "backgroundColor", "link", "baselineOffset"];
const safeUrl = value => /^https?:\/\//i.test(value || "") ? value : undefined;
function textStyle(style = {}) {
    return {
        fontWeight: style.bold ? 700 : undefined,
        fontStyle: style.italic ? "italic" : undefined,
        textDecoration: [style.underline && "underline", style.strikethrough && "line-through"].filter(Boolean).join(" "),
        fontFamily: style.weightedFontFamily?.fontFamily,
        fontSize: style.fontSize ? `${pointValue(style.fontSize)}pt` : undefined,
        color: cssRgb(style.foregroundColor?.color?.rgbColor),
        backgroundColor: cssRgb(style.backgroundColor?.color?.rgbColor),
    };
}
function richRuns(root) {
    const runs = [];
    function visit(node, inherited = {}) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent) return;
            const computed = getComputedStyle(node.parentElement), color = computed.color.match(/[\d.]+/g);
            const rgb = color ? {red: Number(color[0]) / 255, green: Number(color[1]) / 255, blue: Number(color[2]) / 255} : undefined;
            const style = {...inherited, bold: Number(computed.fontWeight) >= 600, italic: computed.fontStyle === "italic", underline: computed.textDecorationLine.includes("underline"), strikethrough: computed.textDecorationLine.includes("line-through"), fontSize: {magnitude: parseFloat(computed.fontSize) * 0.75, unit: "PT"}, weightedFontFamily: {fontFamily: computed.fontFamily.split(",")[0].replaceAll('"', "")}, ...(rgb ? {foregroundColor: {color: {rgbColor: rgb}}} : {})};
            const link = node.parentElement.closest("a");
            if (link && safeUrl(link.getAttribute("href"))) style.link = {url: link.getAttribute("href")};
            else delete style.link;
            runs.push({text: node.textContent, style});
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === "BR") {runs.push({text: "\n", style: inherited}); return;}
        let style = inherited;
        if (node.dataset.googleStyle) {
            const original = JSON.parse(node.dataset.googleStyle);
            style = {...inherited, ...Object.fromEntries(editableStyleFields.filter(key => key in original).map(key => [key, original[key]]))};
        }
        node.childNodes.forEach(child => visit(child, style));
    }
    root.childNodes.forEach(node => visit(node));
    return runs;
}

export default function DocumentEditor({ref, model, canEdit, zoom, onDirty, apply, position, onPosition}) {
    const tabs = documentTabs(model.content), [tabId, setTabId] = useState(tabs.find(tab => tab.id === position?.tabId)?.id || tabs[0]?.id || "");
    const tab = tabs.find(item => item.id === tabId) || tabs[0], elements = tab?.body?.content || [];
    const drafts = useRef({}), originals = useRef(new Map()), page = useRef(null), active = useRef(null);
    const [notice, setNotice] = useState("");
    const colorRange = useRef(null);
    useImperativeHandle(ref, () => ({changes: () => documentChanges(elements, drafts.current, tabId)}));
    function capture(node) {
        const index = node.dataset.index;
        if (node.innerHTML === originals.current.get(index)) delete drafts.current[index];
        else drafts.current[index] = richRuns(node);
        onDirty(Object.keys(drafts.current).length > 0);
    }
    function command(name, value) {
        const selection = window.getSelection(), node = selection?.anchorNode?.parentElement?.closest("[data-index][contenteditable=true]");
        if (!canEdit || !node || !page.current.contains(node)) {setNotice("Selecciona texto del documento para aplicar formato."); return;}
        if (name === "fontSize") {
            document.execCommand("fontSize", false, "7");
            page.current.querySelectorAll('font[size="7"]').forEach(font => {font.removeAttribute("size"); font.style.fontSize = `${value}pt`;});
        } else document.execCommand(name, false, value);
        page.current.querySelectorAll('[contenteditable=true][data-index]').forEach(capture);
    }
    function selectedRange() {
        const selection = window.getSelection(), node = selection?.anchorNode?.parentElement?.closest("[data-index]");
        const index = Number(node?.dataset.index ?? active.current ?? documentParagraphs(elements)[0]?.startIndex ?? 1);
        const element = documentParagraphs(elements).find(item => item.startIndex === index);
        return {startIndex: index, endIndex: Math.max(index + 1, element?.endIndex || index + 1), ...(tabId ? {tabId} : {})};
    }
    const insertLocation = () => {const range = selectedRange(); return {index: range.endIndex - 1, ...(tabId ? {tabId} : {})};};
    async function insertTable() {
        const rowInput = await promptBold("Filas de la tabla (1–20)", "3");
        if (rowInput === null) return;
        const rows = Number(rowInput), columns = Number(await promptBold("Columnas de la tabla (1–10)", "3"));
        if (Number.isInteger(rows) && rows >= 1 && rows <= 20 && Number.isInteger(columns) && columns >= 1 && columns <= 10) await apply([{insertTable: {rows, columns, location: insertLocation()}}]);
    }
    async function insertImage() {
        const uri = await promptBold("URL pública HTTPS de la imagen");
        if (!uri) return;
        if (!uri.startsWith("https://")) {setNotice("Usa una URL HTTPS accesible para Google."); return;}
        await apply([{insertInlineImage: {uri, location: insertLocation(), objectSize: {width: {magnitude: 300, unit: "PT"}}}}]);
    }
    function renderContent(content) {
        return content.map(element => {
            if (element.table) return <table className="editor_document_table" key={element.startIndex}><tbody>{element.table.tableRows.map((row, rowIndex) => <tr key={rowIndex}>{row.tableCells.map((cell, cellIndex) => <td key={cellIndex} colSpan={cell.tableCellStyle?.columnSpan || 1} rowSpan={cell.tableCellStyle?.rowSpan || 1}>{renderContent(cell.content)}</td>)}</tr>)}</tbody></table>;
            if (!element.paragraph) return element.sectionBreak ? null : <p key={element.startIndex} className="editor_notice">Elemento avanzado conservado. Disponible en Google.</p>;
            const paragraph = element.paragraph, complex = paragraph.elements.some(run => !run.textRun || run.suggestedInsertionIds?.length || run.suggestedDeletionIds?.length || Object.keys(run.textRun?.suggestedTextStyleChanges || {}).length);
            return <div key={element.startIndex} className="editor_document_paragraph" style={{textAlign: {START: "left", CENTER: "center", END: "right", JUSTIFIED: "justify"}[paragraph.paragraphStyle?.alignment], marginLeft: paragraph.bullet ? "24px" : undefined}}>
                {paragraph.bullet && <span className="editor_bullet" aria-hidden="true">•</span>}
                <p data-index={element.startIndex} role="textbox" aria-label={`Párrafo ${element.startIndex}`} aria-multiline="true" contentEditable={canEdit && !complex} suppressContentEditableWarning
                    ref={node => {if (node && !originals.current.has(String(element.startIndex))) originals.current.set(String(element.startIndex), node.innerHTML);}}
                    onFocus={() => {active.current = element.startIndex;}}
                    onInput={event => capture(event.currentTarget)}
                    onPaste={event => {event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); capture(event.currentTarget);}}
                    onKeyDown={event => {if (event.key === "Enter") {event.preventDefault(); document.execCommand("insertText", false, "\n"); capture(event.currentTarget);}}}>
                    {paragraph.elements.map((run, index) => {
                        if (run.textRun) {
                            const value = run.textRun.content.replace(index === paragraph.elements.length - 1 ? /\n$/ : /$^/, "");
                            const named = (tab.namedStyles?.styles || model.content.namedStyles?.styles || []).find(style => style.namedStyleType === paragraph.paragraphStyle?.namedStyleType);
                            const style = {...named?.textStyle, ...run.textRun.textStyle};
                            return <span key={index} data-google-style={JSON.stringify(style)} style={textStyle(style)}>{safeUrl(style.link?.url) ? <a href={style.link.url} target="_blank" rel="noopener noreferrer" onClick={event => {if (canEdit) event.preventDefault();}}>{value}</a> : value}</span>;
                        }
                        const object = tab.inlineObjects?.[run.inlineObjectElement?.inlineObjectId]?.inlineObjectProperties?.embeddedObject;
                        return object?.imageProperties?.contentUri ? <img key={index} src={safeUrl(object.imageProperties.contentUri)} alt={object.title || "Imagen del documento"} style={{width: pointValue(object.size?.width) || undefined}}/> : <span key={index} className="editor_notice">[Elemento disponible en Google]</span>;
                    })}
                </p>
                {complex && <small className="editor_complex_label">Contenido avanzado: editar en Google</small>}
            </div>;
        });
    }
    return <>
        <div className="editor_toolbar" role="toolbar" aria-label="Formato del documento">
            {[[Undo2, "undo", "Deshacer"], [Redo2, "redo", "Rehacer"], [Bold, "bold", "Negrita"], [Italic, "italic", "Cursiva"], [Underline, "underline", "Subrayado"], [Strikethrough, "strikeThrough", "Tachado"]].map(([Icon, name, title]) => <button key={name} title={title} aria-label={title} disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => command(name)}><Icon size={17}/></button>)}
            <select aria-label="Fuente" disabled={!canEdit} defaultValue="Arial" onChange={event => command("fontName", event.target.value)}>{["Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"].map(name => <option key={name}>{name}</option>)}</select>
            <select aria-label="Estilo de párrafo" disabled={!canEdit} defaultValue="NORMAL_TEXT" onChange={event => apply([{updateParagraphStyle: {range: selectedRange(), paragraphStyle: {namedStyleType: event.target.value}, fields: "namedStyleType"}}])}>{[["NORMAL_TEXT", "Texto normal"], ["TITLE", "Título"], ["SUBTITLE", "Subtítulo"], ["HEADING_1", "Encabezado 1"], ["HEADING_2", "Encabezado 2"], ["HEADING_3", "Encabezado 3"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select aria-label="Tamaño de texto" disabled={!canEdit} defaultValue="12" onChange={event => command("fontSize", event.target.value)}>{["8", "10", "12", "14", "18", "24", "36"].map(size => <option key={size}>{size}</option>)}</select>
            <ColorPicker label="Color del texto" disabled={!canEdit} value="#222222" commitOnly onOpen={() => {const selection=window.getSelection();colorRange.current=selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;}} onChange={color => {if(colorRange.current){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(colorRange.current);}command("foreColor",color);}}/>
            <button title="Insertar enlace" aria-label="Insertar enlace" disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={async () => {const url = await promptBold("URL del enlace"); if (safeUrl(url)) command("createLink", url);}}><Link size={17}/></button>
            {[[AlignLeft, "START", "Izquierda"], [AlignCenter, "CENTER", "Centro"], [AlignRight, "END", "Derecha"]].map(([Icon, alignment, title]) => <button key={alignment} aria-label={`Alinear ${title}`} disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => apply([{updateParagraphStyle: {range: selectedRange(), paragraphStyle: {alignment}, fields: "alignment"}}])}><Icon size={17}/></button>)}
            <button aria-label="Lista con viñetas" disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => apply([{createParagraphBullets: {range: selectedRange(), bulletPreset: "BULLET_DISC_CIRCLE_SQUARE"}}])}><List size={17}/></button>
            <button aria-label="Lista numerada" disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => apply([{createParagraphBullets: {range: selectedRange(), bulletPreset: "NUMBERED_DIGIT_ALPHA_ROMAN"}}])}><ListOrdered size={17}/></button>
            <button onClick={insertTable} disabled={!canEdit}><Table2 size={16}/>Tabla</button>
            <button onClick={insertImage} disabled={!canEdit}><Image size={16}/>Imagen</button>
            <button disabled={!canEdit} onClick={() => apply([{insertText: {endOfSegmentLocation: tabId ? {tabId} : {}, text: "\n"}}])}><Plus size={16}/>Párrafo</button>
        </div>
        {notice && <p className="editor_notice" role="status">{notice}<button onClick={() => setNotice("")}>Cerrar</button></p>}
        <div className="editor_document_layout">
            <aside className="editor_document_outline" aria-label="Pestañas del documento">{tabs.map(item => <button key={item.id} aria-pressed={item.id === tabId} onClick={() => {
                if (Object.keys(drafts.current).length) {setNotice("Guarda los cambios antes de cambiar de pestaña."); return;}
                originals.current.clear(); setTabId(item.id); onPosition?.({tabId: item.id});
            }}>{item.name}</button>)}<hr/>{documentParagraphs(elements).filter(element => element.paragraph.paragraphStyle?.namedStyleType?.startsWith("HEADING")).map(element => <button key={element.startIndex} onClick={() => page.current.querySelector(`[data-index="${element.startIndex}"]`)?.focus()}>{paragraphText(element)}</button>)}</aside>
            <div className="editor_document_scroll"><div className="editor_ruler" aria-hidden="true">1　　　 2　　　 3　　　 4　　　 5　　　 6　　　 7</div><article ref={page} className="editor_document_page" style={{zoom: zoom / 100}}>{renderContent(elements)}</article></div>
        </div>
    </>;
}
