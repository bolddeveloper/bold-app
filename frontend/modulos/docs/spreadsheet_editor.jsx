import ColorPicker from "../core/shared/color_picker.jsx";
/* Spreadsheet grid: bounded pages, formulas, selection and cell-only writes. */
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Bold, Italic, Underline, Plus, ChevronLeft, ChevronRight, Undo2, AlignLeft, AlignCenter, AlignRight, BarChart3, ArrowDownAZ } from "lucide-react";
import { workspaceApi } from "./workspace_api.js";
import { cellText, columnName, cssRgb, googleRgb, sheetChanges, sheetRange } from "./editor_helpers.js";

export default function SpreadsheetEditor({ref, model, canEdit, zoom, onDirty, apply, position, onPosition}) {
    const sheets = model.content.sheets || [], [sheetId, setSheetId] = useState(sheets.find(sheet => sheet.properties.sheetId === position?.sheetId)?.properties.sheetId ?? sheets[0]?.properties.sheetId);
    const sheet = sheets.find(item => item.properties.sheetId === sheetId), properties = sheet?.properties || {};
    const [offset, setOffset] = useState(position?.rowOffset || 0), [columnOffset, setColumnOffset] = useState(position?.columnOffset || 0), [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false), [error, setError] = useState("");
    const [drafts, setDrafts] = useState({}), [selected, setSelected] = useState([offset, columnOffset]), [end, setEnd] = useState([offset, columnOffset]);
    const generation = useRef(0), table = useRef(null), history = useRef([]);
    const rowCount = Math.min(100, Math.max(1, (properties.gridProperties?.rowCount || 1000) - offset));
    const columnCount = Math.min(26, Math.max(1, (properties.gridProperties?.columnCount || 26) - columnOffset));
    const currentKey = selected.join(":"), cell = rows[selected[0] - offset]?.values?.[selected[1] - columnOffset];
    useImperativeHandle(ref, () => ({changes: () => sheetChanges(sheetId, drafts)}));
    useEffect(() => {onPosition?.({sheetId, rowOffset: offset, columnOffset});}, [sheetId, offset, columnOffset]);
    useEffect(() => {
        if (!properties.title) return;
        let alive = true; const ticket = ++generation.current;
        setLoading(true); setError(""); setRows([]);
        const range = columnOffset ? `'${properties.title.replaceAll("'", "''")}'!${columnName(columnOffset)}${offset + 1}:${columnName(columnOffset + columnCount - 1)}${offset + rowCount}` : sheetRange(properties.title, offset, rowCount, columnCount);
        workspaceApi.editor(model.file.id, range).then(result => {
            if (alive && ticket === generation.current) setRows(result.content.sheets?.find(item => item.properties.sheetId === sheetId)?.data?.[0]?.rowData || []);
        }).catch(problem => {if (alive) setError(problem.message);}).finally(() => {if (alive) setLoading(false);});
        return () => {alive = false; ++generation.current;};
    }, [sheetId, offset, columnOffset]);
    function change(values) {
        history.current.push(drafts);
        if (history.current.length > 100) history.current.shift();
        const next = {...drafts};
        for (const [key, value] of Object.entries(values)) {
            const [row, column] = key.split(":").map(Number);
            if (value === cellText(rows[row - offset]?.values?.[column - columnOffset])) delete next[key];
            else next[key] = value;
        }
        setDrafts(next); onDirty(Object.keys(next).length > 0);
    }
    function undo() {
        const previous = history.current.pop();
        if (previous) {setDrafts(previous); onDirty(Object.keys(previous).length > 0);}
    }
    function navigate(operation) {
        if (Object.keys(drafts).length) {setError("Guarda los cambios antes de cambiar de hoja o página."); return;}
        history.current = []; operation();
    }
    const selectionRange = () => ({sheetId, startRowIndex: Math.min(selected[0], end[0]), endRowIndex: Math.max(selected[0], end[0]) + 1, startColumnIndex: Math.min(selected[1], end[1]), endColumnIndex: Math.max(selected[1], end[1]) + 1});
    function format(path, value) {
        const format = path.startsWith("textFormat.") ? {textFormat: {[path.split(".")[1]]: value}} : {[path]: value};
        apply([{repeatCell: {range: selectionRange(), cell: {userEnteredFormat: format}, fields: `userEnteredFormat.${path}`}}]);
    }
    function focusCell(row, column) {
        const node = table.current.querySelector(`[data-cell="${row}:${column}"]`);
        if (node) {setSelected([row, column]); setEnd([row, column]); node.focus();}
    }
    function paste(event) {
        if (!canEdit || loading) return;
        event.preventDefault();
        const data = event.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "").split("\n").map(row => row.split("\t"));
        if (data.length + selected[0] > offset + rowCount || data.some(row => row.length + selected[1] > columnOffset + columnCount)) {setError("El contenido pegado excede la página visible. Divide el rango en bloques."); return;}
        const changes = {};
        data.forEach((row, i) => row.forEach((value, j) => {changes[`${selected[0] + i}:${selected[1] + j}`] = value;}));
        change(changes);
    }
    async function addSheet() {
        const title = window.prompt("Nombre de la hoja", `Hoja ${sheets.length + 1}`);
        if (title?.trim()) apply([{addSheet: {properties: {title: title.trim()}}}]);
    }
    function chart() {
        const range = selectionRange();
        apply([{addChart: {chart: {spec: {title: "Gráfico", basicChart: {chartType: "COLUMN", legendPosition: "BOTTOM_LEGEND", axis: [{position: "BOTTOM_AXIS", title: "Categoría"}, {position: "LEFT_AXIS", title: "Valor"}], domains: [{domain: {sourceRange: {sources: [{...range, endColumnIndex: range.startColumnIndex + 1}]}}}], series: [{series: {sourceRange: {sources: [{...range, startColumnIndex: Math.min(range.startColumnIndex + 1, range.endColumnIndex - 1)}]}}, targetAxis: "LEFT_AXIS"}]}}, position: {overlayPosition: {anchorCell: {sheetId, rowIndex: range.startRowIndex, columnIndex: range.endColumnIndex}}}}}}]);
    }
    return <>
        <div className="editor_toolbar" role="toolbar" aria-label="Formato de hoja de cálculo">
            <button aria-label="Deshacer edición local" disabled={!canEdit || !history.current.length} onClick={undo}><Undo2 size={17}/></button>
            {[[Bold, "bold", "Negrita"], [Italic, "italic", "Cursiva"], [Underline, "underline", "Subrayado"]].map(([Icon, name, title]) => <button key={name} title={title} aria-label={title} disabled={!canEdit || loading} onClick={() => format(`textFormat.${name}`, !cell?.userEnteredFormat?.textFormat?.[name])}><Icon size={17}/></button>)}
            <select aria-label="Fuente de celda" disabled={!canEdit} defaultValue="Arial" onChange={event => format("textFormat.fontFamily", event.target.value)}>{["Arial", "Georgia", "Times New Roman", "Verdana"].map(name => <option key={name}>{name}</option>)}</select>
            <select aria-label="Tamaño de celda" disabled={!canEdit} defaultValue="10" onChange={event => format("textFormat.fontSize", Number(event.target.value))}>{[8, 10, 12, 14, 18, 24, 36].map(size => <option key={size}>{size}</option>)}</select>
            <label title="Color de fondo">Fondo<ColorPicker label="Color de fondo de celdas" value="#ffffff" disabled={!canEdit} commitOnly onChange={color => format("backgroundColor", googleRgb(color))}/></label>
            <label title="Color del texto">Texto<ColorPicker label="Color de texto de celdas" value="#222222" disabled={!canEdit} commitOnly onChange={color => format("textFormat.foregroundColor", googleRgb(color))}/></label>
            {[[AlignLeft, "LEFT"], [AlignCenter, "CENTER"], [AlignRight, "RIGHT"]].map(([Icon, alignment]) => <button key={alignment} aria-label={`Alineación ${alignment}`} disabled={!canEdit} onClick={() => format("horizontalAlignment", alignment)}><Icon size={17}/></button>)}
            <button disabled={!canEdit} onClick={() => apply([{sortRange: {range: selectionRange(), sortSpecs: [{dimensionIndex: selected[1], sortOrder: "ASCENDING"}]}}])}><ArrowDownAZ size={16}/>Ordenar rango</button>
            <button disabled={!canEdit} onClick={chart}><BarChart3 size={16}/>Gráfico</button>
            <button disabled={!canEdit} onClick={() => apply([{appendDimension: {sheetId, dimension: "ROWS", length: 100}}])}>+100 filas</button>
            <button disabled={!canEdit} onClick={() => apply([{appendDimension: {sheetId, dimension: "COLUMNS", length: 26}}])}>+26 columnas</button>
        </div>
        <div className="editor_formula_bar"><span>{columnName(selected[1])}{selected[0] + 1}</span><b aria-hidden="true">ƒx</b><input aria-label="Valor o fórmula de celda seleccionada" disabled={!canEdit || loading} value={drafts[currentKey] ?? cellText(cell)} onChange={event => change({[currentKey]: event.target.value})} placeholder="Texto, número o =SUM(A1:A10)"/></div>
        {error && <p className="editor_error" role="alert">{error}</p>}
        {loading ? <p className="editor_loading">Cargando celdas…</p> : <div className="editor_grid_scroll" ref={table} style={{zoom: zoom / 100}}><table className="editor_sheet_grid" aria-label={`Hoja ${properties.title}`}><thead><tr><th aria-label="Números de fila"/>{Array.from({length: columnCount}, (_, j) => <th key={j}>{columnName(columnOffset + j)}</th>)}</tr></thead><tbody>{Array.from({length: rowCount}, (_, i) => <tr key={offset + i}><th>{offset + i + 1}</th>{Array.from({length: columnCount}, (_, j) => {
            const row = offset + i, column = columnOffset + j, key = `${row}:${column}`, cell = rows[i]?.values?.[j], format = cell?.effectiveFormat || {};
            const range = selectionRange(), highlighted = row >= range.startRowIndex && row < range.endRowIndex && column >= range.startColumnIndex && column < range.endColumnIndex;
            return <td key={column} className={highlighted ? "editor_cell_selected" : ""}><input data-cell={key} aria-label={`${columnName(column)}${row + 1}`} readOnly={!canEdit} value={drafts[key] ?? (currentKey === key ? cellText(cell) : cell?.formattedValue ?? cellText(cell))}
                style={{backgroundColor: cssRgb(format.backgroundColor), color: cssRgb(format.textFormat?.foregroundColor), fontWeight: format.textFormat?.bold ? 700 : undefined, fontStyle: format.textFormat?.italic ? "italic" : undefined, fontFamily: format.textFormat?.fontFamily, fontSize: format.textFormat?.fontSize ? `${format.textFormat.fontSize}pt` : undefined, textAlign: format.horizontalAlignment?.toLowerCase()}}
                onMouseDown={event => {if (event.shiftKey) {event.preventDefault(); setEnd([row, column]);} else {setSelected([row, column]); setEnd([row, column]);}}}
                onFocus={() => {setSelected([row, column]); setEnd([row, column]);}}
                onChange={event => change({[key]: event.target.value})} onPaste={paste}
                onKeyDown={event => {if (event.key === "Enter" || event.key === "Tab") {event.preventDefault(); focusCell(row + (event.key === "Enter" ? event.shiftKey ? -1 : 1 : 0), column + (event.key === "Tab" ? event.shiftKey ? -1 : 1 : 0));}}}/></td>;
        })}</tr>)}</tbody></table></div>}
        <footer className="editor_sheet_footer"><button aria-label="Añadir hoja" disabled={!canEdit} onClick={addSheet}><Plus size={17}/></button>{sheets.map(item => <button key={item.properties.sheetId} aria-pressed={sheetId === item.properties.sheetId} onClick={() => navigate(() => {setSheetId(item.properties.sheetId); setOffset(0); setColumnOffset(0); setSelected([0, 0]); setEnd([0, 0]);})} onDoubleClick={() => {if (!canEdit) return; const title = window.prompt("Nombre de la hoja", item.properties.title); if (title?.trim()) apply([{updateSheetProperties: {properties: {sheetId: item.properties.sheetId, title: title.trim()}, fields: "title"}}]);}}>{item.properties.title}</button>)}</footer>
        <div className="editor_grid_pagination"><button aria-label="Filas anteriores" disabled={!offset} onClick={() => navigate(() => {setOffset(Math.max(0, offset - 100)); setSelected([Math.max(0, offset - 100), columnOffset]); setEnd([Math.max(0, offset - 100), columnOffset]);})}><ChevronLeft size={16}/></button><span>Filas {offset + 1}–{offset + rowCount}</span><button aria-label="Filas siguientes" disabled={offset + rowCount >= (properties.gridProperties?.rowCount || 1000)} onClick={() => navigate(() => {setOffset(offset + 100); setSelected([offset + 100, columnOffset]); setEnd([offset + 100, columnOffset]);})}><ChevronRight size={16}/></button><button aria-label="Columnas anteriores" disabled={!columnOffset} onClick={() => navigate(() => {setColumnOffset(Math.max(0, columnOffset - 26)); setSelected([offset, Math.max(0, columnOffset - 26)]); setEnd([offset, Math.max(0, columnOffset - 26)]);})}><ChevronLeft size={16}/></button><span>{columnName(columnOffset)}–{columnName(columnOffset + columnCount - 1)}</span><button aria-label="Columnas siguientes" disabled={columnOffset + columnCount >= (properties.gridProperties?.columnCount || 26)} onClick={() => navigate(() => {setColumnOffset(columnOffset + 26); setSelected([offset, columnOffset + 26]); setEnd([offset, columnOffset + 26]);})}><ChevronRight size={16}/></button><small>Fórmulas calculadas por Google al guardar. Doble clic en pestaña para renombrar.</small></div>
    </>;
}
