import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useDialog} from "../core/shared/use_dialog.js";
import {DriveFolderPicker} from "../docs/drive_module.jsx";
import "../docs/workspace.css";
import {http} from "../core/http_client.js";
import {coreApi} from "../core/core_api.js";
import {promptBold} from "../core/shared/bold_dialog.js";
import GoogleConnection from "../docs/google_connection.jsx";

const root = "/api/v2/google/image-storage/";
export default function ImageStorage() {
    const [config, setConfig] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [browsing, setBrowsing] = useState(false);
    const alive = useRef(true), running = useRef(false);
    const close = () => {if (!running.current) setBrowsing(false);};
    useDialog(browsing, ".image_storage_dialog", close);
    async function load() {
        try {const result = await http.request(root); if (alive.current) {setConfig(result); setError("");}}
        catch (problem) {if (alive.current) setError(problem.message);}
    }
    useEffect(() => {
        alive.current = true; load();
        globalThis.addEventListener("bold:google-connection-changed", load);
        globalThis.addEventListener("focus", load);
        return () => {alive.current = false; globalThis.removeEventListener("bold:google-connection-changed", load); globalThis.removeEventListener("focus", load);};
    }, []);
    async function save(folderId) {
        if (!folderId || running.current) return;
        running.current = true; setBusy(true); setError("");
        try {
            const code = await promptBold("Código MFA para elegir la carpeta de imágenes de BOLD");
            if (code === null || !alive.current) return;
            if (!/^[0-9]{6}$/.test(code.trim())) throw new Error("Ingresa los seis dígitos de tu aplicación autenticadora.");
            await coreApi.stepUpMfa(code.trim());
            const result = await http.request(root, {method: "PUT", body: {folder_id: folderId}});
            if (alive.current) {setConfig(result); setBrowsing(false);}
        } catch (problem) {if (alive.current) setError(problem.message);}
        finally {running.current = false; if (alive.current) setBusy(false);}
    }
    return <section className="admin_connector">
        <div className="admin_connector_intro"><h2>Almacenamiento de imágenes</h2><span className="admin_connector_badge">{config?.folder ? config.storage_ready ? "Configurado" : "Pausado" : "Sin configurar"}</span></div>
        <p>Guarda las imágenes de perfiles, proyectos, tareas y otros módulos en una carpeta organizada de Drive.</p>
        {config?.folder && <div className="admin_connector_details"><div><strong>Carpeta</strong><span>{config.folder.name}</span></div><div><strong>Cuenta de almacenamiento</strong><span>{config.folder.account}</span></div><div><strong>Imágenes guardadas</strong><span>{config.stored_images}</span></div></div>}
        <p>Todos podrán ver las imágenes en BOLD según sus permisos, sin necesitar la cuenta administradora ni conectar su propio Drive. Para ver la carpeta directamente en Google Drive, su cuenta deberá tener acceso compartido.</p>
        <p>Si esta cuenta desconecta Drive, se pausarán las subidas y la visualización hasta que vuelva a conectarse. Cambiar la carpeta afecta solo a imágenes nuevas; los archivos anteriores se conservan.</p>
        {!config?.eligible && <p>Sube el JSON y conecta tu cuenta Google con permisos de Drive para habilitar la selección.</p>}
        {config && !config.eligible && <GoogleConnection onConnected={load}/>}
        {error && <p className="admin_connector_error" role="alert">{error}</p>}
        <div className="admin_connector_actions"><button disabled={!config?.eligible || busy} onClick={() => {setError(""); setBrowsing(true);}}>{config?.folder ? "Cambiar carpeta" : "Seleccionar carpeta"}</button><button disabled={busy} onClick={load}>Actualizar estado</button></div>
        {browsing && createPortal(<div className="workspace_overlay" onPointerDown={event => {if (event.target === event.currentTarget) close();}}><section className="workspace_dialog docs_create_dialog image_storage_dialog" role="dialog" aria-modal="true" aria-label="Seleccionar carpeta de imágenes">
            <h2>Almacenamiento de imágenes</h2><p>Elige dónde guardar las imágenes de BOLD en Drive.</p>
            {error && <p role="alert">{error}</p>}
            <DriveFolderPicker label="Seleccionar esta carpeta" disabled={busy} submit={save}/>
            <button type="button" disabled={busy} onClick={close}>Cancelar</button>
        </section></div>, document.getElementById("bold-overlay-root") || document.body)}
    </section>;
}
