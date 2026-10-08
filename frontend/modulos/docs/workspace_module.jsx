import {useFileDrop} from "./use_file_drop.js";
import { createPortal } from "react-dom";
import { useDialog } from "../core/shared/use_dialog.js";
import InternalTabs from "./internal_tabs.jsx";
import GoogleEmbedViewer from "./google_embed_viewer.jsx";
import "./published_view.css";
import { useEffect, useRef, useState } from "react";
import { FileText, Sheet, Presentation, Plus, Upload } from "lucide-react";
import { workspaceApi } from "./workspace_api.js";
import GoogleConnection from "./google_connection.jsx";
import "./workspace.css";
import "./development_notice.css";
import DriveModule, { DriveFolderPicker, DriveUploadDialog } from "./drive_module.jsx";
import { useShell } from "../core/app_shell.jsx";
import WorkspaceEditor from "./workspace_editor.jsx";
import {officeUploadAccept, officeUploadError} from "./office_files.js?docs-uploads";

const kinds = { docs: ["Documentos", FileText, "#4285f4"], sheets: ["Hojas de cálculo", Sheet, "#0f9d58"], slides: ["Presentaciones", Presentation, "#e5a900"] };
export const fileKind = mime => Object.keys(kinds).find(kind => mime === `application/vnd.google-apps.${{ docs: "document", sheets: "spreadsheet", slides: "presentation" }[kind]}`);

export default function WorkspaceModule({ mode = "drive" }) {
    return mode === "drive" ? <DriveModule/> : <DocsModule mode={mode}/>;
}
function DocsHome({ creationRequest }) {
    const shell = useShell();
    const [connection, setConnection] = useState(null), [error, setError] = useState("");
    const [createType, setCreateType] = useState(""), [createName, setCreateName] = useState("Sin título"), [working, setWorking] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState(null);
    const uploadInput = useRef(null);
    function receiveFiles(items) {
        if (!items.length) return;
        const validation = officeUploadError(items);
        if (validation) {setError(validation); return;}
        if (!connection?.connected || createType || droppedFiles || mutation.current) {setError("Conecta Google y cierra el diálogo abierto antes de subir archivos."); return;}
        setError("");
        setDroppedFiles(items);
    }
    const fileDrop = useFileDrop(receiveFiles);
    const mutation = useRef(false);
    useDialog(Boolean(createType), ".docs_create_dialog", () => {if (!mutation.current) setCreateType("");});
    useEffect(() => {
        let current = true;
        workspaceApi.connection().then(result => {if (current) {setConnection(result); shell.sync_workspace_account(result);}}).catch(problem => {if (current) setError(problem.message);});
        return () => {current = false;};
    }, []);
    useEffect(() => {if (creationRequest) document.querySelector(".workspace_types button")?.focus();}, [creationRequest, connection?.connected]);
    async function submitCreate(parent) {
        if (mutation.current || !createName.trim()) return;
        mutation.current = true; setWorking(true); setError("");
        try {
            const item = await workspaceApi.create({type: createType, name: createName.trim(), parent});
            setCreateType(""); shell.open_workspace_tab(item);
        } catch (problem) {setError(problem.message);}
        finally {mutation.current = false; setWorking(false);}
    }
    return <section className="workspace_module">
        {fileDrop && <div className="drive_drop_hint" role="status"><Upload size={36}/><strong>Suelta aquí para subir</strong><span>Solo Word, Excel y PowerPoint · Luego elige la carpeta</span></div>}
        {connection?.connected && <p className="docs_drop_tip"><Upload size={16}/>Arrastra archivos de Word, Excel o PowerPoint aquí</p>}
        <input ref={uploadInput} type="file" hidden multiple accept={officeUploadAccept} onChange={event => {const items = Array.from(event.target.files || []); event.target.value = ""; receiveFiles(items);}}/>
        {droppedFiles && <DriveUploadDialog items={droppedFiles} connection={connection} close={() => setDroppedFiles(null)}/>}
        <header className="workspace_header"><div><h1>Docs</h1><p>Documentos, hojas de cálculo y presentaciones dentro de BOLD</p></div><span className="workspace_account_email" aria-label="Cuenta Google conectada">{connection?.email || "Sin cuenta Google conectada"}</span></header>
        {error && !createType && <p className="workspace_error" role="alert">{error}</p>}
        {!connection ? <p>Comprobando conexión…</p> : !connection.connected ? <GoogleConnection onConnected={result => {setConnection(result); shell.sync_workspace_account(result);}}/> : <div className="workspace_types">
            {Object.entries(kinds).map(([id, [label, Icon, color]]) => <article key={id}><Icon size={32} style={{color}}/><h2>{label}</h2><button disabled={working} onClick={() => {setError(""); setCreateName("Sin título"); setCreateType(id);}}><Plus size={16}/>Crear {label.toLowerCase()}</button><button disabled={working || !!createType || !!droppedFiles} onClick={() => uploadInput.current.click()}><Upload size={16}/>Subir archivo</button></article>)}
        </div>}
        <DocsDevelopmentNotice/>
        {createType && createPortal(<div className="workspace_overlay"><section className="workspace_dialog docs_create_dialog" role="dialog" aria-modal="true" aria-label="Crear archivo Google"><h2>Crear {kinds[createType][0].toLowerCase()}</h2>{error && <p role="alert">{error}</p>}<form onSubmit={event => event.preventDefault()}><label>Nombre<input disabled={working} value={createName} onChange={event => setCreateName(event.target.value)} maxLength={255} required/></label><p>Elige dónde guardar el archivo en Drive.</p><DriveFolderPicker label="Crear aquí" disabled={working || !createName.trim()} submit={submitCreate}/><button disabled={working} type="button" onClick={() => setCreateType("")}>Cancelar</button></form></section></div>, document.getElementById("bold-overlay-root") || document.body)}
    </section>;
}

// Pestañas conservadas por el shell al cambiar entre módulos.
function DocsDevelopmentNotice() {
    return <aside className="docs_development_notice" role="note"><p><strong>Se está trabajando en este módulo.</strong><span>Se recomienda crear y abrir en Google desde la vista del editor, arriba a la derecha.</span></p><img src="/bold-loader.svg" alt="" aria-hidden="true" width="210" height="122"/></aside>;
}

function DocsModule({ mode }) {
    const shell = useShell();
    const [connection, setConnection] = useState(null), [error, setError] = useState("");
    const [creationRequest, setCreationRequest] = useState(0);
    useEffect(() => {
        let current = true;
        workspaceApi.connection().then(result => { if (current) { setConnection(result); shell.sync_workspace_account(result); } }).catch(problem => { if (current) setError(problem.message); });
        return () => { current = false; };
    }, []);
    const currentConnection = shell.workspace_connection || connection;
    const state = shell.workspace_tab_state;
    const file = state.tabs.find(item => item.id === state.active);
    if (currentConnection?.editors_enabled) {
        return file ? <><WorkspaceEditor key={file.id} file={file} connection={currentConnection} close={() => shell.select_workspace_tab(null)} onDirty={shell.set_workspace_dirty} onBusy={shell.set_workspace_busy}/><DocsDevelopmentNotice/></> : <DocsHome mode={mode} creationRequest={creationRequest}/>;
    }
    return <section className="google_docs_module">
        <InternalTabs tabs={state.tabs} active={state.active} select={shell.select_workspace_tab} close={shell.close_workspace_tab} create={() => { shell.select_workspace_tab(null); setCreationRequest(value => value + 1); }}/>
        <div id="docs-tab-panel" role="tabpanel" aria-labelledby={file ? `docs-tab-${file.id}` : "docs-tab-home"}>
            {error && <p role="alert">{error}</p>}
            {!file ? <DocsHome mode={mode} creationRequest={creationRequest}/> : !currentConnection ? <p>Comprobando conexión…</p> : currentConnection.editors_enabled ? <WorkspaceEditor key={file.id} file={file} connection={currentConnection} close={() => shell.close_workspace_tab(file.id)} onDirty={shell.set_workspace_dirty} onBusy={shell.set_workspace_busy}/> : <GoogleEmbedViewer key={file.id} file={file} connection={currentConnection}/>}
        </div>
        {file && <DocsDevelopmentNotice/>}
    </section>;
}
