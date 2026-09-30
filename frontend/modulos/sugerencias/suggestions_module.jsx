import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lightbulb, MessageSquarePlus, RefreshCw } from "lucide-react";

import { useCore } from "../core/core_provider.jsx";
import { suggestionsApi } from "./suggestions_api.js";
import "./suggestions.css";

const categoryLabels = { idea: "Idea", bug: "Problema", visual: "Mejora visual", other: "Otro" };
const statusLabels = { new: "Nueva", reviewing: "En revisión", accepted: "Aceptada", resolved: "Resuelta", dismissed: "Descartada" };
const rowsOf = response => Array.isArray(response) ? response : response?.results || [];

function readableError(error) {
    const detail = error?.fields?.detail;
    return Array.isArray(detail) ? detail.join(" ") : detail || error?.message || "No se pudo completar la acción.";
}

export default function SuggestionsModule() {
    const core = useCore();
    const [rows, setRows] = useState([]), [loading, setLoading] = useState(true);
    const [error, setError] = useState(""), [sent, setSent] = useState(false), [busy, setBusy] = useState(false);
    const [canManage, setCanManage] = useState(Boolean(core.account?.is_superuser));
    const [statusFilter, setStatusFilter] = useState("");

    async function load() {
        setLoading(true); setError("");
        try { setRows(rowsOf(await suggestionsApi.list())); }
        catch (caught) { setError(readableError(caught)); }
        finally { setLoading(false); }
    }

    useEffect(() => {
        let active = true;
        load();
        if (!core.account?.is_superuser) core.permissions.can("suggestions.feedback.manage").then(value => active && setCanManage(Boolean(value))).catch(() => {});
        return () => { active = false; };
    }, [core.activeAssignment?.id]);

    const visible = useMemo(() => rows.filter(row => !statusFilter || row.status === statusFilter), [rows, statusFilter]);

    async function submit(event) {
        event.preventDefault(); setBusy(true); setError(""); setSent(false);
        const form = new FormData(event.currentTarget);
        try {
            const created = await suggestionsApi.create({
                category: form.get("category"), message: form.get("message"),
                source_module: form.get("source_module"), source_view: "suggestions",
            });
            setRows(current => [created, ...current]); event.currentTarget.reset(); setSent(true);
        } catch (caught) { setError(readableError(caught)); }
        finally { setBusy(false); }
    }

    async function changeStatus(row, status) {
        setError("");
        try {
            const updated = await suggestionsApi.review(row.id, { status, internal_note: row.internal_note || "" });
            setRows(current => current.map(item => item.id === row.id ? updated : item));
        } catch (caught) { setError(readableError(caught)); }
    }

    return <div className="suggestions_module">
        <header className="suggestions_header"><div><span><MessageSquarePlus size={18} /> Mejora continua</span><h1>Sugerencias</h1><p>Comparte ideas, problemas y ajustes sin salir de Bold.</p></div><button type="button" onClick={load} disabled={loading}><RefreshCw size={17} /> Actualizar</button></header>
        {error && <div className="suggestions_error" role="alert">{error}</div>}
        <div className="suggestions_layout">
            <form className="suggestions_form" onSubmit={submit}>
                <div className="suggestions_form_intro"><Lightbulb /><div><h2>Enviar una sugerencia</h2><p>La recibirá el equipo autorizado dentro de la aplicación.</p></div></div>
                <label>Tipo<select name="category" defaultValue="idea"><option value="idea">Idea</option><option value="bug">Problema</option><option value="visual">Mejora visual</option><option value="other">Otro</option></select></label>
                <label>Módulo relacionado<select name="source_module" defaultValue="tasks"><option value="tasks">Tareas</option><option value="calendar">Calendario</option><option value="notifications">Notificaciones</option><option value="permissions">Permisos</option><option value="administration">Administración</option><option value="core">General</option></select></label>
                <label>Mensaje<textarea name="message" minLength="10" maxLength="2000" required placeholder="Describe qué observaste y cómo podría mejorarse…" /></label>
                {sent && <p className="suggestions_success"><CheckCircle2 size={17} /> Sugerencia enviada correctamente.</p>}
                <button className="suggestions_primary" disabled={busy}>{busy ? "Enviando…" : "Enviar sugerencia"}</button>
            </form>
            <section className="suggestions_history">
                <header><div><h2>{canManage ? "Sugerencias recibidas" : "Mis sugerencias"}</h2><p>{rows.length} registro{rows.length === 1 ? "" : "s"}</p></div><select aria-label="Filtrar por estado" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></header>
                {loading ? <p className="suggestions_empty">Cargando sugerencias…</p> : visible.length === 0 ? <p className="suggestions_empty">Aún no hay sugerencias en esta vista.</p> : <div className="suggestions_list">{visible.map(row => <article key={row.id}>
                    <div className="suggestions_meta"><span>{categoryLabels[row.category] || row.category}</span><span>{row.source_module || "General"}</span><time>{new Date(row.created_at).toLocaleDateString("es-GT")}</time></div>
                    <p>{row.message}</p>
                    <footer><small>{row.author_name} · {row.unit_name}</small>{canManage ? <select aria-label={`Estado de ${row.message}`} value={row.status} onChange={event => changeStatus(row, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <strong data-status={row.status}>{statusLabels[row.status]}</strong>}</footer>
                </article>)}</div>}
            </section>
        </div>
    </div>;
}
