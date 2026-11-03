import {Check,Link2} from "lucide-react";

export function ConnectionState({busy,connected,error}) {
    return <div className={`bold_connection_state ${connected ? "is_connected" : ""}`} role="status" aria-live="polite">
        <div className="bold_connection_motion" aria-hidden="true"><span><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="5"/></svg></span><i className={`bold_connection_line ${busy ? "is_connecting" : ""}`}/><span>{connected && !busy ? <Check/> : <Link2/>}</span></div>
        <p>{busy ? "Conectando tu cuenta…" : error ? "No se completó la conexión" : connected ? "Cuenta conectada" : "Tu espacio, conectado"}</p>
    </div>;
}
