import {BackgroundSyncNotice} from "../core/shared/background_sync_notice.jsx";
import {backgroundRefresh} from "../core/google_cache.js";
import {moduleCache, moduleScope} from "../core/module_cache.js";
import { BoldSelect } from "../core/shared/bold_select.jsx";
import { AvatarImage } from "../core/shared/avatar_image.jsx";
import { TaskText, TaskTextEditor } from "../tareas/src/task_text_editor.jsx";
import { plainRichText } from "../tareas/src/rich_text.js";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bug, Check, CheckCircle2, ChevronRight, CircleHelp, Inbox, Lightbulb, Monitor, Palette, Pencil, Plus, RefreshCw, Search, Send, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useCore } from "../core/core_provider.jsx";
import { suggestionsApi } from "./suggestions_api.js";
import "./suggestions.css";

const categories = { bug: "Problema", visual: "Mejora visual", idea: "Idea", other: "Otro" };
const categoryIcons = { bug: Bug, visual: Palette, idea: Lightbulb, other: CircleHelp };
const statuses = { new: "Nueva", reviewing: "En revisión", accepted: "Aceptada", resolved: "Resuelta", dismissed: "Descartada" };
const priorities = { low: "Baja", medium: "Media", high: "Alta" };
const modules = { core: "General", tasks: "Tareas", calendar: "Calendario", notifications: "Notificaciones", permissions: "Permisos", administration: "Administración", docs: "Docs", drive: "Drive", inbox: "Bandeja de entrada", suggestions: "Sugerencias" };
const emptyFilters = { search: "", status: "", category: "", priority: "", source_module: "", unit: "", from: "", to: "", order: "newest" };
const titleOf = row => row.title || plainRichText(row.message || "").split("\n")[0].slice(0, 180) || "Reporte sin título";
const referenceOf = row => `#${row.id.slice(0, 8).toUpperCase()}`;
const dateOf = value => new Date(value).toLocaleString("es-GT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const options = labels => Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>);
const readableError = error => error?.fields?.detail || error?.message || "No se pudo completar la acción.";

function Badge({ kind, value, children }) {
    return <span className={`suggestions_badge is_${kind}`} data-value={value}>{kind === "priority" && <i aria-hidden="true" />}{children}</span>;
}

function Screenshot({ capture, reportId }) {
    const [url, setUrl] = useState(capture.data_url || ""), [error, setError] = useState("");
    useEffect(() => {
        if (capture.data_url) return;
        const controller = new AbortController(); let objectUrl;
        suggestionsApi.screenshot(reportId, capture.id, controller.signal).then(blob => {
            if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
        }).catch(caught => { if (caught.name !== "AbortError") setError("No se pudo cargar la captura."); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [reportId, capture.id, capture.data_url]);
    return url ? <a className="suggestions_capture" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Ampliar ${capture.name}`}><img src={url} alt={capture.name} /><span>{capture.name}</span></a> : <div className="suggestions_capture suggestions_capture_loading">{error || "Cargando captura…"}</div>;
}

function ReportForm({ row, busy, onSave, onCancel }) {
    const [draft, setDraft] = useState(() => ({ title: row ? titleOf(row) : "", message: row?.message || "", category: row?.category || "bug", priority: row?.priority || "medium", source_module: row?.source_module || "core", environment: row?.environment || "", screenshots: row?.screenshots || [] }));
    const [error, setError] = useState("");
    const change = (name, value) => setDraft(current => ({ ...current, [name]: value }));
    async function submit(event) {
        event.preventDefault(); setError("");
        const payload = { ...draft, title: draft.title.trim(), message: draft.message.trim(), environment: draft.environment.trim(), source_view: row?.source_view || "suggestions" };
        if (!payload.title || plainRichText(payload.message).trim().length < 10) { setError("Añade un título y una descripción de al menos 10 caracteres."); return; }
        try { await onSave(payload); } catch (caught) { setError(readableError(caught)); }
    }
    return <form className="suggestions_form" onSubmit={submit}>
        <div className="suggestions_form_heading"><span className="suggestions_form_icon"><Bug size={23} /></span><div><h2>{row ? "Editar reporte" : "Comparte lo que podemos mejorar"}</h2><p>Una idea clara. Un cambio que ayuda a todos.</p></div></div>
        <fieldset disabled={busy} className="suggestions_fields">
            <label>Título <span className="suggestions_required">*</span><input name="title" required maxLength={180} value={draft.title} onChange={event => change("title", event.target.value)} placeholder="Ej. El calendario no guarda los cambios" autoFocus={Boolean(row)} /></label>
            <label>Descripción <span className="suggestions_required">*</span><TaskTextEditor label="Descripción del reporte" maxLength={2000} value={draft.message} onChange={value => change("message", value)} disabled={busy} placeholder="¿Qué ocurrió? ¿Qué esperabas? Incluye los pasos para reproducirlo." /><small className="suggestions_counter">{plainRichText(draft.message).length.toLocaleString("es-GT")} / 2,000</small></label>
            <fieldset className="suggestions_choice_group"><legend>Tipo de reporte</legend><div className="suggestions_choices">{Object.entries(categories).map(([value, label]) => { const Icon = categoryIcons[value]; return <label key={value} className={draft.category === value ? "is_selected" : ""}><input type="radio" name="category" value={value} checked={draft.category === value} onChange={() => change("category", value)} /><Icon size={16} />{label}</label>; })}</div></fieldset>
            <div className="suggestions_form_columns"><label>Módulo<select name="source_module" value={draft.source_module} onChange={event => change("source_module", event.target.value)}>{options(modules)}</select></label><fieldset className="suggestions_choice_group"><legend>Prioridad</legend><div className="suggestions_choices suggestions_priorities">{Object.entries(priorities).map(([value, label]) => <label key={value} data-priority={value} className={draft.priority === value ? "is_selected" : ""}><input type="radio" name="priority" value={value} checked={draft.priority === value} onChange={() => change("priority", value)} /><i aria-hidden="true" />{label}</label>)}</div></fieldset></div>
            <label>Navegador / dispositivo <span className="suggestions_optional">Opcional</span><div className="suggestions_input_icon"><Monitor size={17} /><input name="environment" maxLength={160} value={draft.environment} onChange={event => change("environment", event.target.value)} placeholder="Ej. Chrome · Windows 11, Safari · iPhone" /></div></label>
        </fieldset>
        {error && <p className="suggestions_error" role="alert">{error}</p>}
        <footer className="suggestions_form_footer">{onCancel && <button type="button" disabled={busy} onClick={onCancel}>Cancelar</button>}<button type="submit" className="suggestions_primary" disabled={busy}><Send size={17} />{busy ? "Guardando…" : row ? "Guardar cambios" : "Enviar reporte"}</button>{!row && <small>IT recibirá tu reporte y podrás seguir su estado.</small>}</footer>
    </form>;
}

function ReportDetail({ row, owner, busy, onReview, onEdit, onRemove, onClose }) {
    const core = useCore();
    const author = core.directory.find(person => String(person.id) === String(row.author_assignment));
    const dialog = useRef(null);
    const [editing, setEditing] = useState(false), [confirmingDelete, setConfirmingDelete] = useState(false);
    const [review, setReview] = useState({ status: row.status, priority: row.priority || "medium", internal_note: row.internal_note || "" });
    const [error, setError] = useState("");
    useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
    useEffect(() => { setReview({ status: row.status, priority: row.priority || "medium", internal_note: row.internal_note || "" }); }, [row]);
    async function saveReview(event) {
        event.preventDefault(); setError("");
        try { await onReview(review); } catch (caught) { setError(readableError(caught)); }
    }
    async function deleteReport() {
        setError("");
        try { await onRemove(); } catch (caught) { setError(readableError(caught)); }
    }
    return <dialog ref={dialog} className="suggestions_dialog" aria-label={editing ? "Editar reporte" : titleOf(row)} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <header className="suggestions_detail_top"><span>{referenceOf(row)}</span><button type="button" aria-label="Cerrar reporte" disabled={busy} onClick={onClose}><X size={20} /></button></header>
        {editing ? <ReportForm row={row} busy={busy} onCancel={() => setEditing(false)} onSave={async payload => { await onEdit(payload); setEditing(false); }} /> : <div className="suggestions_detail_content">
            <div className="suggestions_detail_badges"><Badge kind="category" value={row.category}>{categories[row.category]}</Badge><Badge kind="priority" value={row.priority}>{priorities[row.priority || "medium"]}</Badge><Badge kind="status" value={row.status}>{statuses[row.status]}</Badge></div>
            <h2>{titleOf(row)}</h2><div className="suggestions_author"><span className="suggestions_avatar"><AvatarImage url={author?.avatar_url} initials={row.author_name?.split(" ").map(part => part[0]).slice(0, 2).join("")} /></span><div><strong>{row.author_name}</strong><small>{row.unit_name} · {dateOf(row.created_at)}</small></div></div>
            <dl className="suggestions_context"><div><dt>Módulo</dt><dd>{modules[row.source_module] || row.source_module || "General"}</dd></div><div><dt>Navegador / dispositivo</dt><dd>{row.environment || "Sin especificar"}</dd></div></dl>
            <section className="suggestions_description"><h3>Descripción</h3><TaskText value={row.message} />{row.screenshots?.length > 0 && <div className="suggestions_captures">{row.screenshots.map(capture => <Screenshot key={capture.id} capture={capture} reportId={row.id} />)}</div>}</section>
            {row.can_manage && <form className="suggestions_review" onSubmit={saveReview}><h3>Seguimiento IT</h3><fieldset disabled={busy}><div className="suggestions_form_columns"><label>Estado<select aria-label="Estado del reporte" value={review.status} onChange={event => setReview(current => ({ ...current, status: event.target.value }))}>{options(statuses)}</select></label><label>Prioridad<select aria-label="Prioridad del reporte" value={review.priority} onChange={event => setReview(current => ({ ...current, priority: event.target.value }))}>{options(priorities)}</select></label></div><label>Nota interna<TaskTextEditor compact label="Nota interna" maxLength={2000} value={review.internal_note} onChange={value => setReview(current => ({ ...current, internal_note: value }))} disabled={busy} placeholder="Diagnóstico, solución o siguiente paso…" /></label></fieldset><small>Visible para quienes gestionan estos reportes.</small>{error && <p className="suggestions_error" role="alert">{error}</p>}<button className="suggestions_primary" disabled={busy}><Check size={16} />{busy ? "Guardando…" : "Guardar seguimiento"}</button>{row.reviewed_at && <small>Última revisión: {row.reviewed_by_name || "IT"} · {dateOf(row.reviewed_at)}</small>}</form>}
            {error && !row.can_manage && <p className="suggestions_error" role="alert">{error}</p>}
            {owner && <footer className="suggestions_owner_actions">{confirmingDelete ? <><span role="status">¿Eliminar este reporte?</span><button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancelar</button><button type="button" className="suggestions_danger" disabled={busy} onClick={deleteReport}>Confirmar eliminación</button></> : <><button type="button" disabled={busy} onClick={() => setEditing(true)}><Pencil size={15} />Editar reporte</button><button type="button" className="suggestions_danger" disabled={busy} onClick={() => setConfirmingDelete(true)}><Trash2 size={15} />Eliminar</button></>}</footer>}
        </div>}
    </dialog>;
}

export default function SuggestionsModule() {
    const core = useCore();
    const [tab, setTab] = useState("new"), [canManage, setCanManage] = useState(Boolean(core.account?.is_superuser));
    const [filters, setFilters] = useState(emptyFilters), [search, setSearch] = useState("");
    const [page, setPage] = useState(1), [result, setResult] = useState({ results: [], count: 0, next: null });
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [revision, setRevision] = useState(0), [formVersion, setFormVersion] = useState(0);
    const assignmentId = core.activeAssignment?.id;
    const cacheScope = moduleScope(core);
    const [refreshing, setRefreshing] = useState(false);
    const displayedCacheKey = useRef("");
    useEffect(() => {
        let active = true;
        setSelected(null); setTab("new"); setPage(1); setFilters(emptyFilters); setSearch(""); setCanManage(Boolean(core.account?.is_superuser));
        if (!core.account?.is_superuser) core.permissions.can("suggestions.feedback.manage").then(value => { if (active) setCanManage(Boolean(value)); }).catch(() => {});
        return () => { active = false; };
    }, [assignmentId]);
    useEffect(() => {
        const timer = setTimeout(() => { setFilters(current => current.search === search.trim() ? current : { ...current, search: search.trim() }); setPage(1); }, 300);
        return () => clearTimeout(timer);
    }, [search]);
    useEffect(() => {
        if (tab === "new") return;
        const cacheKey = `suggestions:${tab}:${page}:${JSON.stringify(filters)}`;
        const saved = moduleCache.read(cacheScope, cacheKey), cacheGeneration = moduleCache.generation;
        const controller = new AbortController();
        if (saved) setResult(saved);
        else if (displayedCacheKey.current !== cacheKey) setResult({results: [], count: 0, next: null});
        setLoading(!saved && displayedCacheKey.current !== cacheKey); displayedCacheKey.current = cacheKey; setRefreshing(true); setError("");
        suggestionsApi.list({ ...filters, page, ...(tab === "mine" ? { author_assignment: assignmentId } : {}) }, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setResult(data); moduleCache.write(cacheScope, cacheKey, data, cacheGeneration); }
        }).catch(caught => { if (caught.name !== "AbortError") { if ([401, 403].includes(caught.status)) {moduleCache.invalidate(cacheScope, "suggestions:"); setResult({results: [], count: 0, next: null});} if (caught.status === 404 && page > 1) setPage(current => current - 1); else setError(readableError(caught)); } }).finally(() => { if (!controller.signal.aborted) {setLoading(false); setRefreshing(false);} });
        return () => controller.abort();
    }, [tab, filters, page, assignmentId, revision]);
    useEffect(() => { if (tab !== "new") return backgroundRefresh(() => setRevision(current => current + 1), {interval: 300000}); }, [tab]);
    const filter = (name, value) => { setFilters(current => ({ ...current, [name]: value })); setPage(1); };
    const resetFilters = () => { setFilters(emptyFilters); setSearch(""); setPage(1); };
    const changeTab = value => { setTab(value); resetFilters(); setError(""); };
    const activeFilters = Object.entries(filters).filter(([name, value]) => value && !["search", "order"].includes(name)).length;
    async function create(payload) {
        setBusy(true); setNotice("");
        try {
            const created = await suggestionsApi.create(payload);
            moduleCache.invalidate(cacheScope, "suggestions:");
            setFormVersion(current => current + 1); setNotice(`Reporte ${referenceOf(created)} enviado. Puedes seguirlo en Mis reportes.`); setRevision(current => current + 1);
        } finally { setBusy(false); }
    }
    async function update(payload, review = false) {
        setBusy(true); setNotice("");
        try { const updated = await (review ? suggestionsApi.review : suggestionsApi.update)(selected.id, payload); moduleCache.invalidate(cacheScope, "suggestions:"); setSelected(updated); setRevision(current => current + 1); setNotice(review ? "Seguimiento actualizado." : "Reporte actualizado."); }
        finally { setBusy(false); }
    }
    async function remove() {
        setBusy(true); setError("");
        try { await suggestionsApi.remove(selected.id); moduleCache.invalidate(cacheScope, "suggestions:"); setSelected(null); setRevision(current => current + 1); setNotice("Reporte eliminado."); }
        finally { setBusy(false); }
    }
    async function changeStatus(row, status) {
        if (busy || status === row.status) return;
        setBusy(true); setError(""); setNotice("");
        try {
            await suggestionsApi.review(row.id, { status });
            moduleCache.invalidate(cacheScope, "suggestions:");
            setRevision(current => current + 1);
            setNotice("Estado actualizado.");
        } catch (caught) { setError(readableError(caught)); }
        finally { setBusy(false); }
    }
    return <div className="suggestions_module">
        <BackgroundSyncNotice active={refreshing && tab !== "new"} label="Actualizando reportes…" />
        <header className="suggestions_header"><div><span className="suggestions_eyebrow"><Bug size={14} /> MEJORA CONTINUA</span><h1>Sugerencias y reportes</h1><p>Ayúdanos a hacer BOLD mejor, un detalle a la vez.</p></div>{tab !== "new" && <div className="suggestions_header_actions"><button type="button" aria-label="Actualizar reportes" disabled={loading} onClick={() => setRevision(current => current + 1)}><RefreshCw size={17} /></button><button type="button" className="suggestions_primary" onClick={() => changeTab("new")}><Plus size={17} />Nuevo reporte</button></div>}</header>
        <nav className="suggestions_tabs" aria-label="Vistas de sugerencias"><button type="button" aria-current={tab === "new" ? "page" : undefined} onClick={() => changeTab("new")}><Plus size={16} />Nuevo reporte</button><button type="button" aria-current={tab === "mine" ? "page" : undefined} onClick={() => changeTab("mine")}><Lightbulb size={16} />Mis reportes</button>{canManage && <button type="button" aria-current={tab === "it" ? "page" : undefined} onClick={() => changeTab("it")}><Inbox size={16} />Bandeja IT</button>}</nav>
        {notice && <div className="suggestions_success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}
        {error && <p className="suggestions_error" role="alert">{error}</p>}
        {tab === "new" ? <div className="suggestions_compose_layout"><ReportForm key={`${assignmentId}-${formVersion}`} busy={busy} onSave={create} /><aside className="suggestions_tips"><span className="suggestions_tip_icon"><Lightbulb size={23} /></span><h2>Los detalles hacen la diferencia</h2><p>Tu reporte llega al equipo de IT con el contexto que necesita para ayudarte.</p><ol><li><strong>Un título concreto</strong><span>Resume el problema o la idea en una frase.</span></li><li><strong>Cuéntanos cómo ocurre</strong><span>Incluye los pasos y el resultado que esperabas.</span></li><li><strong>Muéstranos el detalle</strong><span>Una captura ayuda a entenderlo más rápido.</span></li></ol><div className="suggestions_tip_footer"><CheckCircle2 size={17} /><p>Consulta el avance en <button type="button" onClick={() => changeTab("mine")}>Mis reportes</button>.</p></div></aside></div> : <section className="suggestions_board" aria-label={tab === "it" ? "Bandeja IT" : "Mis reportes"}>
            <div className="suggestions_board_heading"><div><h2>{tab === "it" ? "Bandeja IT" : "Mis reportes"}</h2><p>{`${result.count} reporte${result.count === 1 ? "" : "s"}`}{tab === "it" && " · dentro de tu alcance de permisos"}</p></div><label className="suggestions_sort">Ordenar<select aria-label="Ordenar reportes" value={filters.order} onChange={event => filter("order", event.target.value)}><option value="newest">Más recientes</option><option value="oldest">Más antiguos</option><option value="priority">Mayor prioridad</option></select></label></div>
            <div className="suggestions_toolbar"><label className="suggestions_search"><Search size={18} /><input type="search" aria-label="Buscar reportes" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar título, detalle, persona o referencia…" /></label><select aria-label="Filtrar por estado" value={filters.status} onChange={event => filter("status", event.target.value)}><option value="">Todos los estados</option>{options(statuses)}</select><select aria-label="Filtrar por prioridad" value={filters.priority} onChange={event => filter("priority", event.target.value)}><option value="">Toda prioridad</option>{options(priorities)}</select><details className="suggestions_filter_panel"><summary><SlidersHorizontal size={16} />Filtros{activeFilters > 0 && <span>{activeFilters}</span>}</summary><div><label>Tipo<select value={filters.category} onChange={event => filter("category", event.target.value)}><option value="">Todos los tipos</option>{options(categories)}</select></label><label>Módulo<select value={filters.source_module} onChange={event => filter("source_module", event.target.value)}><option value="">Todos los módulos</option>{options(modules)}</select></label>{tab === "it" && <label>Unidad<select value={filters.unit} onChange={event => filter("unit", event.target.value)}><option value="">Todas las unidades</option>{(core.units || []).map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}<label>Desde<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => filter("from", event.target.value)} /></label><label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => filter("to", event.target.value)} /></label><button type="button" onClick={resetFilters}>Limpiar filtros</button></div></details></div>
            <div className="suggestions_status_chips" aria-label="Estados rápidos">{[["", "Todos"], ...Object.entries(statuses)].map(([value, label]) => <button type="button" key={value} aria-pressed={filters.status === value} onClick={() => filter("status", value)}>{label}</button>)}{(activeFilters > 0 || filters.search) && <button type="button" className="suggestions_reset" onClick={resetFilters}><X size={13} />Limpiar</button>}</div>
            <div className="suggestions_report_list" aria-busy={loading}>{loading ? <div className="suggestions_empty" aria-busy="true" /> : result.results.length === 0 ? <div className="suggestions_empty"><Inbox size={32} /><h3>{activeFilters || filters.search ? "No encontramos reportes" : "Aún no hay reportes"}</h3><p>{activeFilters || filters.search ? "Prueba otros filtros o una búsqueda distinta." : "Las ideas y problemas aparecerán aquí."}</p>{(activeFilters > 0 || filters.search) && <button type="button" onClick={resetFilters}>Limpiar filtros</button>}</div> : result.results.map(row => { const Icon = categoryIcons[row.category] || CircleHelp; return <div key={row.id} className="suggestions_report_row"><button type="button" className="suggestions_report_open" onClick={() => setSelected(row)} aria-label={`Abrir ${referenceOf(row)}: ${titleOf(row)}`}><span className="suggestions_report_icon" data-category={row.category}><Icon size={20} /></span><span className="suggestions_report_main"><span className="suggestions_report_title"><small>{referenceOf(row)}</small><strong>{titleOf(row)}</strong></span><span className="suggestions_report_preview">{plainRichText(row.message)}</span><span className="suggestions_report_meta">{row.author_name} <i>·</i> {modules[row.source_module] || row.source_module || "General"} <i>·</i> {dateOf(row.created_at)}</span></span></button><div className="suggestions_report_labels"><Badge kind="priority" value={row.priority}>{priorities[row.priority || "medium"]}</Badge>{tab === "it" && row.can_manage ? <fieldset className="suggestions_status_select" disabled={busy} aria-busy={busy}><BoldSelect label={`Cambiar estado de ${referenceOf(row)}`} value={row.status} options={Object.entries(statuses).map(([value, label]) => ({ value, label: <Badge kind="status" value={value}>{label}</Badge> }))} onValueChange={value => changeStatus(row, value)} /></fieldset> : <Badge kind="status" value={row.status}>{statuses[row.status]}</Badge>}</div><button type="button" className="suggestions_report_arrow" aria-label={`Ver ${referenceOf(row)}`} onClick={() => setSelected(row)}><ChevronRight size={17} className="suggestions_row_arrow" /></button></div>; })}</div>
            <footer className="suggestions_pagination"><span>{result.count > 0 && !loading ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, result.count)} de ${result.count}` : "0 reportes"}</span><div><button type="button" aria-label="Página anterior" disabled={page === 1 || loading} onClick={() => setPage(current => current - 1)}><ArrowLeft size={16} /></button><span>Página {page}</span><button type="button" aria-label="Página siguiente" disabled={!result.next || loading} onClick={() => setPage(current => current + 1)}><ArrowRight size={16} /></button></div></footer>
        </section>}
        {selected && <ReportDetail key={`${assignmentId}-${selected.id}`} row={selected} owner={String(selected.author_assignment) === String(assignmentId)} busy={busy} onReview={payload => update(payload, true)} onEdit={payload => update(payload)} onRemove={remove} onClose={() => setSelected(null)} />}
    </div>;
}
