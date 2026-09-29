import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ExternalLink, Link2Off, RefreshCw, ShieldCheck, X } from "lucide-react";
import { http } from "../core/http_client.js";

export default function Connectors() {
    const [connection, setConnection] = useState(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [tutorial, setTutorial] = useState(false);
    const popupRef = useRef(null);
    const callbackStatusRef = useRef(null);
    async function load(report = false) {
        try {
            const result = await http.request("/api/v2/calendar/connection/");
            setConnection(result); setError("");
            if (report) setStatusMessage(result.connected ? `Conectado con ${result.email}.` : "Aún no hay una cuenta conectada. Si ya aceptaste los permisos, revisa el resultado en la ventana de Google.");
        }
        catch (problem) { setError(problem.message); }
    }
    async function verify() { setChecking(true); try { await load(true); } finally { setChecking(false); } }
    useEffect(() => { load(); }, []);
    useEffect(() => { if (!tutorial) return; const close = event => event.key === "Escape" && setTutorial(false); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [tutorial]);
    useEffect(() => {
        const receive = event => {
            if (event.source !== popupRef.current || event.origin !== connection?.callback_origin || event.data?.type !== "bold:google-calendar") return;
            callbackStatusRef.current = event.data.status;
            setBusy(false);
            setTutorial(false);
            if (event.data.status === "connected") load(true);
            else setError({ cancelled: "Se canceló la conexión con Google.", invalid_state: "La solicitud venció. Inicia una conexión nueva.", invalid_client: "Google rechazó el cliente OAuth. Revisa el ID y el secreto del servidor.", missing_refresh_token: "Google no entregó acceso sin conexión. Inicia una conexión nueva." }[event.data.status] || "Google no completó la conexión. Revisa el mensaje de la ventana emergente.");
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [connection?.callback_origin]);
    async function connect() {
        setTutorial(false); setError(""); setStatusMessage(""); setBusy(true); callbackStatusRef.current = null;
        const popup = window.open("", "bold-google-calendar", "width=540,height=700");
        popupRef.current = popup;
        try {
            const result = await http.request("/api/v2/calendar/oauth/start/", { method: "POST", body: {} });
            if (popup) {
                popup.location.href = result.authorization_url;
                const watcher = window.setInterval(() => { if (popup.closed) { window.clearInterval(watcher); setBusy(false); if (!callbackStatusRef.current) load(true); } }, 500);
            }
            else window.location.assign(result.authorization_url);
        } catch (problem) { popup?.close(); setError(problem.message); setBusy(false); }
    }
    async function disconnect() {
        if (!window.confirm("¿Desconectar Google Calendar para todo el equipo?")) return;
        setBusy(true);
        try { await http.request("/api/v2/calendar/connection/", { method: "DELETE" }); await load(); }
        catch (problem) { setError(problem.message); }
        finally { setBusy(false); }
    }
    return <div className="admin_connector"><div className="admin_connector_intro"><span className="admin_connector_icon"><CalendarDays size={25} /></span><div><h2>Google Calendar</h2><p>Un calendario principal para organizar eventos con tu equipo, sin salir de Bold.</p></div><span className={`admin_connector_badge${connection?.connected ? " is_connected" : ""}`}>{connection?.connected ? "Conectado" : "Sin conectar"}</span></div>
        {error && <p className="admin_connector_error" role="alert">{error}</p>}
        {statusMessage && !error && <p className="admin_connector_status" role="status">{statusMessage}</p>}
        {!connection ? error ? <button type="button" onClick={load}>Reintentar conexión</button> : <p>Cargando el estado de la conexión…</p> : <><div className="admin_connector_details"><div><strong>Cuenta</strong><span>{connection.email || "Todavía no hay una cuenta vinculada"}</span></div><div><strong>Calendario</strong><span>Principal · {connection.time_zone}</span></div><div><strong>Última comprobación</strong><span>{connection.last_checked_at ? new Date(connection.last_checked_at).toLocaleString("es") : "Aún no comprobado"}</span></div></div>
            <div className="admin_connector_actions"><button className="admin_connector_primary" disabled={busy} onClick={() => connection.configured ? setTutorial(true) : setError("Falta configurar GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET y GOOGLE_CALENDAR_REDIRECT_URI en el servidor. El proyecto de Google Cloud por sí solo no conecta la app.")}><ExternalLink size={16} />{connection.connected ? "Reconectar" : "Conectar con Google"}</button><button type="button" disabled={checking} onClick={verify}><RefreshCw size={16} />{checking ? "Verificando…" : "Verificar estado"}</button>{connection.connected && <button disabled={busy} onClick={disconnect}><Link2Off size={16} />Desconectar</button>}{!connection.configured && <small>Configura el cliente OAuth web en el servidor para abrir la selección de cuentas de Google.</small>}</div></>}
        <p className="admin_connector_note"><ShieldCheck size={17} /> Solo el dueño conecta la cuenta. Los usuarios activos pueden buscar contactos de esa cuenta y gestionar eventos y tareas. Bold registra quién realiza cada cambio.</p>
        {tutorial && <div className="admin_connector_overlay" onMouseDown={event => event.target === event.currentTarget && setTutorial(false)}><section className="admin_connector_tutorial" role="dialog" aria-modal="true" aria-labelledby="google-tutorial-title"><button autoFocus className="admin_connector_close" aria-label="Cerrar" onClick={() => setTutorial(false)}><X size={20} /></button><span className="admin_connector_icon"><CalendarDays size={28} /></span><h2 id="google-tutorial-title">Conecta tu calendario</h2><p>Selecciona la cuenta de Google que quieres compartir con tu equipo. Google te mostrará los permisos para gestionar Calendar y Google Tasks, y consultar tus Contactos para autocompletar invitados; podrás revocarlos más adelante.</p><ol><li>Habilita Calendar API, Google Tasks API y People API en el mismo proyecto de Cloud.</li><li>Elige tu cuenta y acepta los permisos.</li><li>Vuelve a Bold: el estado cambiará a «Conectado».</li></ol><div className="admin_connector_tutorial_actions"><button onClick={() => setTutorial(false)}>Ahora no</button><button className="admin_connector_primary" onClick={connect}><CheckCircle2 size={17} />Conectar ahora</button></div><button className="admin_connector_skip" onClick={connect}>Omitir guía y conectar directamente</button></section></div>}
    </div>;
}
