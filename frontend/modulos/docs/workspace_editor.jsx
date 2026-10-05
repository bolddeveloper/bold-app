/* Editor shell: connection, save state, navigation and Google fallback. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, FileText, Sheet, Presentation, Save, RefreshCw, Download, Star, Users } from "lucide-react";
import { workspaceApi } from "./workspace_api.js";
import { googleFileUrl } from "./google_links.js";
import { triggerDownload } from "./drive_helpers.js";
import DocumentEditor from "./document_editor.jsx";
import SpreadsheetEditor from "./spreadsheet_editor.jsx";
import PresentationEditor from "./presentation_editor.jsx";
import { ShareFileDialog } from "./drive_module.jsx";
import "./editors.css";

const labels = {docs: "Documento", sheets: "Hoja de cálculo", slides: "Presentación"};
const icons = {docs: FileText, sheets: Sheet, slides: Presentation};

export default function WorkspaceEditor({file, connection, close, onDirty, onBusy}) {
    const [model, setModel] = useState(null), [error, setError] = useState("");
    const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false), [saved, setSaved] = useState(0), [zoom, setZoom] = useState(100);
    const [download, setDownload] = useState(null), [name, setName] = useState(file.name);
    const [sharing, setSharing] = useState(false);
    const [position, setPosition] = useState({});
    const child = useRef(null), generation = useRef(0), working = useRef(false), dirtyRef = useRef(false);
    const kind = model?.kind || file.editorKind || ({"application/vnd.google-apps.document": "docs", "application/vnd.google-apps.spreadsheet": "sheets", "application/vnd.google-apps.presentation": "slides"}[file.mimeType]);
    const Icon = icons[kind] || FileText, canEdit = !!model?.file.capabilities?.canEdit;
    function changed(value = true) {dirtyRef.current = value; setDirty(value); onDirty?.(value);}
    const load = useCallback(async () => {
        const ticket = ++generation.current;
        setLoading(true); setError("");
        try {
            const result = await workspaceApi.editor(file.id);
            if (ticket !== generation.current) return;
            setModel(result); setName(result.file.name); setSaved(value => value + 1);
            dirtyRef.current = false; setDirty(false); onDirty?.(false);
        } catch (problem) {if (ticket === generation.current) setError(problem.message);}
        finally {if (ticket === generation.current) setLoading(false);}
    }, [file.id]);
    useEffect(() => {load(); return () => {++generation.current; onDirty?.(false); onBusy?.(false);};}, [load]);
    useEffect(() => {
        const leave = event => {if (dirtyRef.current || working.current) {event.preventDefault(); event.returnValue = "";}};
        window.addEventListener("beforeunload", leave);
        return () => window.removeEventListener("beforeunload", leave);
    }, []);
    useEffect(() => () => {if (download) URL.revokeObjectURL(download.url);}, [download]);
    useEffect(() => {
        const closeMenus = event => {if (!event.target.closest(".editor_menubar details")) document.querySelectorAll(".editor_menubar details[open]").forEach(menu => {menu.open = false;});};
        document.addEventListener("pointerdown", closeMenus);
        return () => document.removeEventListener("pointerdown", closeMenus);
    }, []);

    async function commit(requests) {
        if (working.current || !requests.length) return false;
        working.current = true; onBusy?.(true); setSaving(true); setError("");
        try {
            await workspaceApi.edit(file.id, {requests, revision: model.content.revisionId, version: model.file.version, source_checksum: model.source_checksum});
            // Keep drafts if refresh fails; never retry an ambiguous write automatically.
            const result = await workspaceApi.editor(file.id);
            setModel(result); setSaved(value => value + 1); changed(false);
            return true;
        } catch (problem) {setError(problem.message); return false;}
        finally {working.current = false; onBusy?.(false); setSaving(false);}
    }
    async function save() {await commit(child.current?.changes() || []);}
    async function apply(requests) {
        if (dirtyRef.current) {setError("Guarda los cambios pendientes antes de insertar o modificar la estructura."); return false;}
        return commit(requests);
    }
    function reload() {
        if (working.current) return;
        if (!dirtyRef.current || window.confirm("¿Descartar los cambios sin guardar y cargar la versión de Google?")) load();
    }
    function back() {
        if (working.current) return;
        if (!dirtyRef.current || window.confirm("¿Salir y descartar los cambios sin guardar?")) {changed(false); close();}
    }
    async function rename() {
        if (!canEdit || !name.trim() || name === model.file.name || working.current) return;
        if (dirtyRef.current) {setError("Guarda el contenido antes de cambiar el nombre."); setName(model.file.name); return;}
        working.current = true; onBusy?.(true); setSaving(true); setError("");
        try {
            const metadata = await workspaceApi.update(file.id, {name: name.trim()});
            setModel(old => ({...old, file: metadata}));
            await load();
        } catch (problem) {setError(problem.message); setName(model.file.name);}
        finally {working.current = false; onBusy?.(false); setSaving(false);}
    }
    async function exportFile(format) {
        try {setError(""); const blob = await workspaceApi.download(file.id, format, true); const name = (model?.file.name || file.name).replace(/\.(docx?|xlsx?|pptx?)$/i, ""); setDownload(triggerDownload(blob, `${name}.${format}`));}
        catch (problem) {setError(problem.message);}
    }
    const Editor = {docs: DocumentEditor, sheets: SpreadsheetEditor, slides: PresentationEditor}[kind];
    return <section className={`bold_editor bold_editor_${kind}`} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {event.preventDefault(); if (dirty && !saving) save();}
        if (event.key === "Escape") event.currentTarget.querySelectorAll("details[open]").forEach(menu => {menu.open = false; menu.querySelector("summary")?.focus();});
    }} aria-busy={loading || saving}>
        <header className="editor_header">
            <button aria-label="Volver a Docs" onClick={back} disabled={saving}><ArrowLeft size={20}/></button>
            <Icon className="editor_brand" size={34}/>
            <div className="editor_identity">
                <input aria-label={`Nombre de ${labels[kind]?.toLowerCase()}`} value={name} maxLength={255} disabled={!canEdit || saving} onChange={event => setName(event.target.value)} onBlur={rename} onKeyDown={event => {if (event.key === "Enter") event.currentTarget.blur();}}/>
                <span role="status">{loading ? "Cargando desde Google…" : saving ? "Guardando en Google…" : dirty ? "Cambios sin guardar" : canEdit ? "Guardado en Google Drive" : "Solo lectura"}</span>
            </div>
            <a className="editor_google" href={googleFileUrl(model?.file || file, connection?.email)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Abrir en Google</a>
            <button disabled={!model || saving} onClick={() => setSharing(true)}><Users size={16}/>Compartir</button>
            <button className="editor_save" disabled={!dirty || saving || !canEdit} onClick={save}><Save size={16}/>Guardar</button>
        </header>
        <nav className="editor_menubar" aria-label="Opciones del archivo">
            <details><summary>Archivo</summary><div><button onClick={save} disabled={!dirty || saving}>Guardar cambios</button><button onClick={() => exportFile("pdf")}>Descargar PDF guardado</button><button onClick={() => exportFile({docs: "docx", sheets: "xlsx", slides: "pptx"}[kind])}>Descargar Office guardado</button><button onClick={back}>Cerrar</button></div></details>
            <button onClick={reload} disabled={saving}><RefreshCw size={14}/>Actualizar</button>
            <label>Zoom<select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[50, 75, 100, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
            <button onClick={async () => {
                if (dirtyRef.current) {setError("Guarda el contenido antes de cambiar destacados."); return;}
                if (working.current) return;
                working.current = true; onBusy?.(true); setSaving(true);
                try {await workspaceApi.update(file.id, {starred: !model.file.starred}); await load();}
                catch (problem) {setError(problem.message);}
                finally {working.current = false; onBusy?.(false); setSaving(false);}
            }} disabled={!model || saving}><Star size={14} fill={model?.file.starred ? "currentColor" : "none"}/>Destacado</button>
            <span className="editor_account">{connection?.email}</span>
        </nav>
        {error && <div className="editor_error" role="alert">{error}<button onClick={reload}>Volver a cargar</button></div>}
        {download && <p className="editor_notice"><Download size={14}/><a href={download.url} download={download.name}>Descargar {download.name}</a><button onClick={() => setDownload(null)}>Cerrar</button></p>}
        {model && !loading && Editor && <Editor key={`${file.id}:${saved}`} ref={child} model={model} canEdit={canEdit && !saving} zoom={zoom} onDirty={changed} apply={apply} position={position} onPosition={setPosition}/>}
        {loading && <p className="editor_loading">Cargando {labels[kind]?.toLowerCase()}…</p>}
        {sharing && <ShareFileDialog file={model.file} close={() => setSharing(false)}/>}
    </section>;
}
