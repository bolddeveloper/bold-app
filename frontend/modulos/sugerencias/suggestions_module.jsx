import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lightbulb, MessageSquarePlus, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import Swal from "sweetalert2";

import { useCore } from "../core/core_provider.jsx";
import { suggestionsApi } from "./suggestions_api.js";
import "./suggestions.css";

const categoryLabels = { idea: "Idea", bug: "Problema", visual: "Mejora visual", other: "Otro" };
const statusLabels = { new: "Nueva", reviewing: "En revisión", accepted: "Aceptada", resolved: "Resuelta", dismissed: "Descartada" };
const moduleLabels = { tasks: "Tareas", calendar: "Calendario", notifications: "Notificaciones", permissions: "Permisos", administration: "Administración", core: "General" };
const rowsOf = response => Array.isArray(response) ? response : response?.results || [];

function StatusPicker({ value, onChange, disabled, label, filter = false }) {
    return <details className="suggestions_status_picker" onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}>
        <summary aria-label={label} aria-disabled={disabled} data-status={value} onClick={event => disabled && event.preventDefault()}>{statusLabels[value] || "Todos los estados"}<span aria-hidden="true">⌄</span></summary>
        <div className="suggestions_status_options">{(filter ? [["", "Todos los estados"], ...Object.entries(statusLabels)] : Object.entries(statusLabels)).map(([status, name]) => <button type="button" key={status} data-status={status} aria-pressed={value === status} disabled={disabled} onClick={event => { event.currentTarget.closest("details").open = false; onChange(status); }}><i aria-hidden="true" />{name}{value === status && <CheckCircle2 size={15} />}</button>)}</div>
    </details>;
}

function readableError(error) {
    const detail = error?.fields?.detail;
    return Array.isArray(detail) ? detail.join(" ") : detail || error?.message || "No se pudo completar la acción.";
}

export default function SuggestionsModule() {
    const core = useCore();
    const [rows, setRows] = useState([]), [loading, setLoading] = useState(true);
    const [error, setError] = useState(""), [sent, setSent] = useState(false), [busy, setBusy] = useState(false);
    const [editingId, setEditingId] = useState(""), [editDraft, setEditDraft] = useState(null), [workingId, setWorkingId] = useState("");
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
        setEditingId(""); setEditDraft(null); setCanManage(Boolean(core.account?.is_superuser));
        load();
        if (!core.account?.is_superuser) core.permissions.can("suggestions.feedback.manage").then(value => active && setCanManage(Boolean(value))).catch(() => {});
        return () => { active = false; };
    }, [core.activeAssignment?.id]);

    const visible = useMemo(() => rows.filter(row => !statusFilter || row.status === statusFilter), [rows, statusFilter]);

    async function submit(event) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const payload = {
            category: form.get("category"), message: form.get("message"),
            source_module: form.get("source_module"), source_view: "suggestions",
        };
        const confirmation = await Swal.fire({
            icon: "question", title: "¿Enviar esta sugerencia?",
            text: "Confirma que el tipo, módulo y mensaje sean correctos. Todavía puedes volver y editarlos.",
            showCancelButton: true, confirmButtonText: "Enviar sugerencia", cancelButtonText: "Volver a editar",
            confirmButtonColor: "#ef1f2d", customClass: { popup: "suggestions_confirm" },
        });
        if (!confirmation.isConfirmed) return;
        setBusy(true); setError(""); setSent(false);
        try {
            const created = await suggestionsApi.create(payload);
            setRows(current => [created, ...current]); formElement.reset(); setSent(true);
        } catch (caught) { setError(readableError(caught)); }
        finally { setBusy(false); }
    }

    async function changeStatus(row, status) {
        setError(""); setWorkingId(row.id);
        try {
            const updated = await suggestionsApi.review(row.id, { status, internal_note: row.internal_note || "" });
            setRows(current => current.map(item => item.id === row.id ? updated : item));
        } catch (caught) { setError(readableError(caught)); }
        finally { setWorkingId(""); }
    }

    function startEdit(row) {
        setError(""); setSent(false); setEditingId(row.id);
        setEditDraft({ category: row.category, source_module: row.source_module || "core", message: row.message });
    }

    async function saveEdit(event, row) {
        event.preventDefault();
        if (!editDraft?.message.trim() || workingId) return;
        setError(""); setWorkingId(row.id);
        try {
            const updated = await suggestionsApi.update(row.id, { ...editDraft, source_view: row.source_view || "suggestions" });
            setRows(current => current.map(item => item.id === row.id ? updated : item));
            setEditingId(""); setEditDraft(null);
        } catch (caught) { setError(readableError(caught)); }
        finally { setWorkingId(""); }
    }

    async function remove(row) {
        const confirmation = await Swal.fire({
            icon: "warning", title: "¿Eliminar esta sugerencia?",
            text: "Dejará de aparecer en la aplicación. Esta acción no puede deshacerse desde esta pantalla.",
            showCancelButton: true, confirmButtonText: "Eliminar", cancelButtonText: "Cancelar",
            confirmButtonColor: "#ef1f2d", customClass: { popup: "suggestions_confirm" },
        });
        if (!confirmation.isConfirmed) return;
        setError(""); setWorkingId(row.id);
        try {
            await suggestionsApi.remove(row.id);
            setRows(current => current.filter(item => item.id !== row.id));
            if (editingId === row.id) { setEditingId(""); setEditDraft(null); }
        } catch (caught) { setError(readableError(caught)); }
        finally { setWorkingId(""); }
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
                <header><div><h2>{canManage ? "Sugerencias recibidas" : "Mis sugerencias"}</h2><p>{rows.length} registro{rows.length === 1 ? "" : "s"}</p></div><StatusPicker label="Filtrar por estado" value={statusFilter} onChange={setStatusFilter} filter /></header>
                {loading ? <p className="suggestions_empty">Cargando sugerencias…</p> : visible.length === 0 ? <p className="suggestions_empty">Aún no hay sugerencias en esta vista.</p> : <div className="suggestions_list">{visible.map(row => {
                    const isOwner = String(row.author_assignment) === String(core.activeAssignment?.id);
                    const isEditing = editingId === row.id;
                    return <article key={row.id}>
                        <div className="suggestions_meta"><span>{categoryLabels[row.category] || row.category}</span><span>{moduleLabels[row.source_module] || row.source_module || "General"}</span><time>{new Date(row.created_at).toLocaleDateString("es-GT")}</time></div>
                        {isEditing ? <form className="suggestions_edit_form" onSubmit={event => saveEdit(event, row)}>
                            <div><label>Tipo<select value={editDraft.category} onChange={event => setEditDraft(current => ({ ...current, category: event.target.value }))}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Módulo<select value={editDraft.source_module} onChange={event => setEditDraft(current => ({ ...current, source_module: event.target.value }))}>{Object.entries(moduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                            <label>Mensaje<textarea minLength="10" maxLength="2000" required value={editDraft.message} onChange={event => setEditDraft(current => ({ ...current, message: event.target.value }))} /></label>
                            <footer><button type="button" onClick={() => { setEditingId(""); setEditDraft(null); }}><X size={15} /> Cancelar</button><button className="suggestions_primary" disabled={workingId === row.id}><CheckCircle2 size={15} /> {workingId === row.id ? "Guardando…" : "Guardar cambios"}</button></footer>
                        </form> : <p>{row.message}</p>}
                        {!isEditing && <footer><small>{row.author_name} · {row.unit_name}</small><div className="suggestions_row_actions">{isOwner && <><button type="button" onClick={() => startEdit(row)} disabled={Boolean(workingId)}><Pencil size={15} /> Editar</button><button type="button" className="is_danger" onClick={() => remove(row)} disabled={Boolean(workingId)}><Trash2 size={15} /> Eliminar</button></>}{canManage ? <StatusPicker label={`Estado de ${row.message}`} disabled={workingId === row.id} value={row.status} onChange={status => changeStatus(row, status)} /> : <strong className="suggestions_status_badge" data-status={row.status}>{statusLabels[row.status]}</strong>}</div></footer>}
                    </article>;
                })}</div>}
            </section>
        </div>
    </div>;
}
