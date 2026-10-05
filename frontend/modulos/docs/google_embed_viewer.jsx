import { useEffect, useRef, useState } from "react";
import { workspaceApi } from "./workspace_api.js";
import { googleFileUrl } from "./google_links.js";

export default function GoogleEmbedViewer({ file, connection }) {
    const [view, setView] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [input, setInput] = useState(""), [associate, setAssociate] = useState(false), [attempt, setAttempt] = useState(0);
    const [frameState, setFrameState] = useState("loading");
    const generation = useRef(0);
    async function refresh() {
        const ticket = ++generation.current;
        setBusy(true); setError(""); setView(null);
        try { const result = await workspaceApi.publishedView(file.id); if (ticket === generation.current) setView(result); }
        catch (problem) { if (ticket === generation.current) setError(problem.message); }
        finally { if (ticket === generation.current) setBusy(false); }
    }
    useEffect(() => { refresh(); return () => { ++generation.current; }; }, [file.id, connection?.connection_key]);
    useEffect(() => {
        setFrameState("loading");
        if (!view?.embed_url) return undefined;
        const timer = setTimeout(() => setFrameState(state => state === "loading" ? "timeout" : state), 12000);
        return () => clearTimeout(timer);
    }, [view?.embed_url, attempt]);
    async function change(operation) {
        const ticket = ++generation.current;
        setBusy(true); setError("");
        try { await operation(); if (ticket === generation.current) { setAssociate(false); await refresh(); } }
        catch (problem) { if (ticket === generation.current) setError(problem.message); }
        finally { if (ticket === generation.current) setBusy(false); }
    }
    return <section className="google_embed_viewer" aria-label={`Visor de ${file.name}`}>
        <header><div><h1>{file.name}</h1><small>Solo lectura · {view?.state === "published" ? "Publicación detectada" : view?.state === "unpublished" ? "Sin publicación" : "Estado de publicación desconocido"}{view?.source === "manual" ? " · Enlace asociado, sin verificar publicación" : ""}</small></div><div className="workspace_actions">
            <a className="workspace_button" href={googleFileUrl(file, connection?.email)} target="_blank" rel="noopener noreferrer">Abrir en Google ↗</a>
            <button disabled={busy} onClick={() => { setAttempt(value => value + 1); refresh(); }}>Reintentar</button>
            <button onClick={() => setAssociate(value => !value)} aria-expanded={associate}>Asociar enlace publicado</button>
            {view?.associated_url && <button disabled={busy} onClick={() => change(() => workspaceApi.removePublishedView(file.id))}>Retirar asociación</button>}
        </div></header>
        {error && <p className="workspace_error" role="alert">{error}</p>}
        {(associate || (!view?.embed_url && !busy)) && <div className="google_publish_help">
            <p>En Google: Archivo → Compartir → Publicar en la Web → Incorporar. Publicar puede permitir acceso público, a tu organización o a grupos. Revisa la audiencia antes de publicar; Google administra las restricciones de Workspace.</p>
            <p>BOLD no publica archivos ni cambia permisos. Retirar el enlace aquí no detiene la publicación en Google.</p>
            <form onSubmit={event => { event.preventDefault(); change(() => workspaceApi.savePublishedView(file.id, input)); }}>
                <label>URL publicada o código iframe<textarea value={input} onChange={event => setInput(event.target.value)} maxLength={10000} required placeholder="https://docs.google.com/…"/></label>
                <button disabled={busy}>Guardar asociación</button>
            </form>
        </div>}
        {busy && <p role="status">Comprobando publicación…</p>}
        {view?.embed_url && <>
            <p className="google_embed_notice" role="status">{frameState === "error" ? "No se pudo mostrar este archivo dentro de BOLD." : frameState === "timeout" ? "Google no respondió en 12 segundos. Reintenta o abre el archivo en Google." : frameState === "loaded" ? "La carga terminó. BOLD no puede comprobar errores internos de Google; si el contenido no aparece, abre en Google." : "Cargando vista publicada…"}</p>
            <iframe key={`${view.embed_url}:${attempt}`} src={view.embed_url} title={file.name} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" onLoad={() => setFrameState("loaded")} onError={() => setFrameState("error")}/>
        </>}
    </section>;
}
