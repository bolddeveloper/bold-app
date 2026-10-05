import { useEffect, useRef, useState } from "react";
import { http } from "../core/http_client.js";
import { clearGoogleCache } from "../core/google_cache.js";
import "../docs/workspace.css";

// Una configuración cifrada por instalación; las autorizaciones siguen siendo personales.
export default function Connectors() { return <GoogleConfiguration/>; }
function GoogleConfiguration() {
    const [config, setConfig] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [verification, setVerification] = useState(null);
    const input = useRef(null), alive = useRef(true);
    const root = "/api/v2/google/configuration/";
    async function load() {try {const value = await http.request(root); if (alive.current) {setConfig(value); setError("");}} catch (problem) {if (alive.current) {if (problem.status === 403) setDenied(true); else setError(problem.message);}}}
    useEffect(() => {alive.current = true; load(); return () => {alive.current = false;};}, []);
    async function operation(run, changed = false) {
        setBusy(true); setError("");
        try {const result = await run(); if (!alive.current) return; if (changed) {setConfig(result); setVerification(null); clearGoogleCache(); globalThis.dispatchEvent(new Event("bold:google-connection-changed"));} else setVerification(result);}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false); if (input.current) input.current.value = "";}
    }
    if (denied) return null;
    const labels = {unknown: "No comprobado", available: "Disponible", authorization_required: "Requiere autorización", unconfigured: "Sin configurar", api_disabled: "API deshabilitada", reconnect_required: "Reconectar", temporary_error: "Error temporal", permission_denied: "Permiso insuficiente"};
    return <section className="admin_connector"><div className="admin_connector_intro"><h2>Configuración Google Cloud</h2><span className="admin_connector_badge">{config?.configured ? "Configurado" : "Sin configurar"}</span></div><p>El dueño sube una sola credencial OAuth. Cada empleado conecta su cuenta y autoriza los servicios que utiliza.</p>{error && <p className="admin_connector_error" role="alert">{error}</p>}{config ? <><div className="admin_connector_details"><div><strong>Proyecto</strong><span>{config.project_id || "Configuración del servidor"}</span></div><div><strong>Cliente OAuth</strong><span>{config.client_id || "Sin cliente"}</span></div><div><strong>Callback autorizado</strong><span>{config.callback}</span></div></div><p>Sube el JSON original de Google Cloud para una Aplicación web. El secreto se cifra en backend y no se devuelve al navegador.</p><input ref={input} type="file" accept=".json,application/json" hidden onChange={event => {const file = event.target.files?.[0]; if (!file) return; if (file.size > 65536) {setError("El JSON no puede superar 64 KB."); event.target.value = ""; return;} const body = new FormData(); body.append("file", file); operation(() => http.request(root, {method: "PUT", body}), true);}}/><div className="admin_connector_actions"><button disabled={busy} onClick={() => input.current?.click()}>Subir/reemplazar JSON</button><button disabled={busy} onClick={() => operation(() => http.request(`${root}verify/`, {method: "POST", body: {}}))}>Verificar conexión</button>{config.configured && <button disabled={busy} onClick={() => {if (window.confirm("¿Eliminar las credenciales de BOLD? Se desactivarán los servicios Google para todos y deberán reconectar. No se borrarán archivos ni eventos de Google.")) operation(async () => {await http.request(root, {method: "DELETE"}); return http.request(root);}, true);}}>Eliminar credenciales</button>}</div>{verification && <div role="status"><p>{verification.note}</p>{Object.entries(verification.services || {}).map(([service, value]) => <p key={service}><strong>{service}</strong>: {labels[value.status] || value.status}{value.message && ` · ${value.message}`}</p>)}</div>}</> : <button disabled={busy} onClick={load}>Comprobar configuración</button>}</section>;
}
