import { useShell } from "../core/app_shell.jsx";
import { useEffect, useRef, useState } from "react";
import { workspaceApi } from "./workspace_api.js";
import "./workspace.css";

export default function GoogleConnection({ onConnected }) {
    const authorized = connection => ["drive", "calendar", "tasks", "contacts", "gmail"].every(service => connection?.services?.[service]?.status === "available");
    const shell = useShell();
    const [connection, setConnection] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const popup = useRef(null), watcher = useRef(null);
    async function load(report = false) {
        try { const result = await workspaceApi.connection(); setConnection(result); shell?.sync_workspace_account(result); setError(""); if (report) onConnected?.(result); }
        catch (problem) { setError(problem.message); }
    }
    useEffect(() => { load(); return () => clearInterval(watcher.current); }, []);
    useEffect(() => {const changed = () => load(true); globalThis.addEventListener("bold:google-connection-changed", changed); return () => globalThis.removeEventListener("bold:google-connection-changed", changed);}, []);
    useEffect(() => {
        const receive = event => {
            if (event.source !== popup.current || event.origin !== connection?.callback_origin || event.data?.type !== "bold:workspace") return;
            clearInterval(watcher.current); setBusy(false);
            if (event.data.status === "connected") load(true); else setError(event.data.status === "wrong_account" ? (connection?.demo_email ? `Para esta demo elige ${connection.demo_email}.` : "Elige la cuenta empresarial que corresponde a tu usuario BOLD.") : "No se completó la conexión. Elige tu cuenta y acepta los permisos de Google.");
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [connection?.callback_origin, connection?.demo_email]);
    async function connect() {
        setError(""); setBusy(true);
        popup.current = window.open("", "bold-workspace", "width=560,height=740");
        try {
            const result = await workspaceApi.start();
            if (!popup.current) { window.location.assign(result.authorization_url); return; }
            popup.current.location.href = result.authorization_url;
            clearInterval(watcher.current);
            watcher.current = setInterval(() => { if (popup.current?.closed) { clearInterval(watcher.current); setBusy(false); load(true); } }, 700);
        } catch (problem) { popup.current?.close(); setBusy(false); setError(problem.message); }
    }
    return <section className="workspace_connection"><h2>Conectar servicios de Google</h2><p>{connection?.connected ? `Conectado como ${connection.email}` : (connection?.demo_email ? `Demo local: conecta ${connection.demo_email}.` : "Conecta tu cuenta empresarial de Google.")}</p><p>Autoriza Drive, Docs, Sheets, Slides, Calendario, Google Tasks, Contactos y Gmail en una sola conexión. Cada empleado conecta su propia cuenta y conserva sus permisos de Google.</p>{connection?.connected && <p>{authorized(connection) ? "Todos los servicios están autorizados." : "Faltan permisos. Conecta los servicios y selecciona todos los permisos en Google."}</p>}{error && <p role="alert">{error}</p>}{connection ? <div className="workspace_actions"><button disabled={busy || !connection.configured} onClick={connect}>{busy ? "Conectando…" : "Conectar servicios de Google"}</button>{connection.connected && <button onClick={async () => { if (!window.confirm("¿Desconectar tu cuenta de Google de BOLD?")) return; try { await workspaceApi.disconnect(); await load(true); } catch (problem) { setError(problem.message); } }}>Desconectar mi cuenta</button>}<button onClick={() => load(true)}>Verificar conexión</button></div> : <button onClick={load}>Comprobar conexión</button>}{connection && !connection.configured && <p>El administrador debe subir el JSON OAuth una vez en Administración → Conectores. Los empleados solo tendrán que conectar su cuenta.</p>}</section>;
}
