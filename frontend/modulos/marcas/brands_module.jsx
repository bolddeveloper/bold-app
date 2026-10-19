import {useEffect, useRef, useState} from "react";
import {useCore} from "../core/core_provider.jsx";
import {http} from "../core/http_client.js";
import {backgroundRefresh} from "../core/google_cache.js";
import {confirmBold} from "../core/shared/bold_dialog.js";
import AvatarEditor from "../core/shared/avatar_editor.jsx";
import {uniquePeople} from "../core/shared/people.js";
import {brandsApi} from "./brands_api.js";
import {brandFields, emptyBrand, brandDraft, toggleBrandLink} from "./brand_fields.js";
import "./brands.css";
import "../docs/development_notice.css";

export default function BrandsModule() {
    const core = useCore();
    const [rows, setRows] = useState([]), [page, setPage] = useState(1), [hasNext, setHasNext] = useState(false);
    const [selected, setSelected] = useState(null), [draft, setDraft] = useState(null), [search, setSearch] = useState("");
    const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
    const [capabilities, setCapabilities] = useState({}), [logoFile, setLogoFile] = useState(null), [shareOpen, setShareOpen] = useState(false), [personQuery, setPersonQuery] = useState("");
    const [pick, setPick] = useState(null), [resources, setResources] = useState([]), [resourcePage, setResourcePage] = useState(1), [resourceNext, setResourceNext] = useState(false);
    const [extraKey, setExtraKey] = useState(""), [extraValue, setExtraValue] = useState("");
    const mounted = useRef(true), lock = useRef(false), ticket = useRef(0), editing = useRef(false), currentPage = useRef(page), selection = useRef(null);
    editing.current = Boolean(draft || shareOpen); currentPage.current = page;
    selection.current = selected;
    const scope = `${core.account?.id}:${core.activeAssignment?.id}`;
    useEffect(() => {
        mounted.current = true; let alive = true;
        const reload = async () => {
            if (lock.current || editing.current) return;
            const seq = ++ticket.current;
            try {
                const result = await brandsApi.list({page: currentPage.current});
                if (alive && seq === ticket.current) {setRows(result.results || result); setHasNext(Boolean(result.next)); setError("");}
                if (selection.current && alive && !editing.current && !lock.current) {
                    const current = await brandsApi.get(selection.current.id);
                    if (alive && seq === ticket.current && !editing.current && !lock.current) setSelected(current);
                }
            } catch (problem) {if (alive && seq === ticket.current) {setRows([]); if ([403,404].includes(problem.status)) setSelected(null); setError(problem.message);}}
            finally {if (alive) setLoading(false);}
        };
        const permissions = async () => {
            const actions = ["read", "create", "manage", "share"];
            try {const flags = await Promise.all(actions.map(action => core.permissions.can(`brands.brand.${action}`)));
                if (alive) setCapabilities(Object.fromEntries(actions.map((action, index) => [action, flags[index]])));
            } catch {if (alive) setCapabilities({});}
        };
        const revoked = () => {++ticket.current; setRows([]); setSelected(null); setDraft(null); setShareOpen(false); setCapabilities({}); permissions(); reload();};
        permissions(); reload(); const stop = backgroundRefresh(reload, {interval: 180000});
        window.addEventListener("bold:permissions-revision", revoked);
        return () => {alive = false; mounted.current = false; ++ticket.current; stop(); window.removeEventListener("bold:permissions-revision", revoked);};
    }, [scope, page]);

    async function run(operation) {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError(""); ++ticket.current;
        try {await operation();}
        catch (problem) {if (mounted.current) setError(problem.status === 409 ? "La marca fue actualizada en otro dispositivo. Conservamos tu formulario; cancela y vuelve a abrir para revisar la versión más reciente." : problem.message);}
        finally {lock.current = false; if (mounted.current) setBusy(false);}
    }
    async function open(row) {
        if (draft && !await confirmBold("¿Descartar los cambios sin guardar de la marca?")) return;
        await run(async () => {const value = await brandsApi.get(row.id); if (mounted.current) {setSelected(value); setDraft(null); setShareOpen(false);}});
    }
    async function save(event) {
        event.preventDefault();
        await run(async () => {
            const value = await brandsApi.save(draft, selected?.id);
            if (!mounted.current) return;
            setRows(items => [...items.filter(row => row.id !== value.id), value]); setSelected(value); setDraft(null);
        });
    }
    async function pickResources(field, nextPage = 1) {
        setPick(field);
        await run(async () => {const resource = field === "project_ids" ? "projects" : "tasks";
            const result = await http.listPage(resource, {page: nextPage});
            if (mounted.current) {setResources(result.results || result); setResourcePage(nextPage); setResourceNext(Boolean(result.next));}});
    }
    const creator = selected && (selected.owner === core.account?.id || core.account?.is_superuser);
    const people = uniquePeople(core.directory || [], selected?.member_ids || []).filter(person => person.name?.toLocaleLowerCase().includes(personQuery.toLocaleLowerCase()) || person.email?.toLocaleLowerCase().includes(personQuery.toLocaleLowerCase()));
    const field = (key, value) => setDraft(current => ({...current, details: {...current.details, [key]: value}}));
    const candidates = rows.filter(row => `${row.name} ${row.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <section className="brands_module">
        <header><div><h1>Marcas</h1><p>Contexto, proyectos y equipo de cada marca.</p></div><button disabled={busy || !capabilities.create} onClick={async () => {if (draft && !await confirmBold("¿Descartar los cambios sin guardar?")) return; setSelected(null); setDraft(emptyBrand()); setShareOpen(false);}}>Nueva marca</button></header>
        {error && <p role="alert" className="brands_error">{error}</p>}
        <div className="brands_layout"><aside><label>Buscar marcas<input type="search" value={search} onChange={event => setSearch(event.target.value)}/></label>
            {loading ? <p role="status">Cargando marcas…</p> : !candidates.length && <p>No hay marcas en esta página. Solo verás las creadas por ti o compartidas contigo; el propietario puede verlas todas.</p>}
            {candidates.map(row => <button className="brand_card" key={row.id} onClick={() => open(row)} disabled={busy}><span>{row.logo && <img src={row.logo} alt=""/>}<strong>{row.name}</strong></span><small>{row.unit_name} · {row.owner_name}</small></button>)}
            <nav aria-label="Páginas de marcas"><button disabled={page === 1 || busy || Boolean(draft)} onClick={() => {setSelected(null); setPage(value => value - 1);}}>Anterior</button><span>{page}</span><button disabled={!hasNext || busy || Boolean(draft)} onClick={() => {setSelected(null); setPage(value => value + 1);}}>Siguiente</button></nav>
        </aside><article>
            {draft ? <form onSubmit={save} aria-busy={busy}>
                <h2>{selected ? "Editar marca" : "Nueva marca"}</h2>
                <label>Nombre<input required maxLength={120} value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></label>
                <label>Descripción<textarea maxLength={5000} value={draft.description} onChange={event => setDraft({...draft, description: event.target.value})}/></label>
                <label>Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {if (event.target.files?.[0]) setLogoFile(event.target.files[0]); event.target.value = "";}}/></label>
                {draft.logo && <div><img className="brand_logo" src={draft.logo} alt="Logo de la marca"/><button type="button" onClick={() => setDraft({...draft, logo: null})}>Quitar logo</button></div>}
                <fieldset><legend>Contexto de la marca</legend><div className="brand_fields">{brandFields.map(([key, label]) => <label key={key}>{label}<input type={key === "client_email" ? "email" : "text"} maxLength={key === "notes" ? 3000 : key === "communication" ? 500 : key === "client_phone" ? 50 : key === "budget" || key === "client_role" ? 120 : 160} value={draft.details[key] || ""} onChange={event => field(key, event.target.value)}/></label>)}</div>
                    <label className="brand_check"><input type="checkbox" checked={Boolean(draft.details.paid_ads)} onChange={event => field("paid_ads", event.target.checked)}/>Tiene pauta publicitaria</label>
                    <label className="brand_check"><input type="checkbox" checked={Boolean(draft.details.audiovisual)} onChange={event => field("audiovisual", event.target.checked)}/>Incluye trabajo audiovisual</label>
                    <h3>Características adicionales</h3>{Object.entries(draft.details.extra || {}).map(([key, value]) => <div key={key}><label>{key}<input maxLength={500} value={value} onChange={event => field("extra", {...draft.details.extra, [key]: event.target.value})}/></label><button type="button" onClick={() => {const next = {...draft.details.extra}; delete next[key]; field("extra", next);}}>Quitar característica</button></div>)}
                    <div className="brand_fields"><label>Nueva característica<input maxLength={80} value={extraKey} onChange={event => setExtraKey(event.target.value)} placeholder="Por ejemplo: Objetivo"/></label><label>Dato<input maxLength={500} value={extraValue} onChange={event => setExtraValue(event.target.value)}/></label></div><button type="button" disabled={!extraKey.trim() || Object.keys(draft.details.extra || {}).length >= 20} onClick={() => {field("extra", {...draft.details.extra, [extraKey.trim()]: extraValue}); setExtraKey(""); setExtraValue("");}}>Agregar característica</button>
                </fieldset>
                <fieldset><legend>Proyectos y tareas asociados</legend>{["project_ids", "task_ids"].map(key => <div key={key}><button disabled={busy} type="button" onClick={() => pickResources(key)}>{key === "project_ids" ? "Elegir proyectos" : "Elegir tareas"} ({draft[key].length})</button>{draft[key].map(id => <button type="button" title="Quitar asociación; no elimina el original" key={id} onClick={() => setDraft({...draft, [key]: toggleBrandLink(draft[key], id)})}>{id.slice(0, 8)} ×</button>)}</div>)}
                    {pick && <section aria-label="Elegir asociaciones"><p>Solo aparecen recursos autorizados. Compartir la marca no cambia sus permisos.</p>{resources.map(row => <label className="brand_check" key={row.id}><input type="checkbox" checked={draft[pick].includes(row.id)} onChange={() => setDraft({...draft, [pick]: toggleBrandLink(draft[pick], row.id)})}/>{row.name || row.title || row.label || row.id}</label>)}<button type="button" disabled={busy || resourcePage === 1} onClick={() => pickResources(pick, resourcePage - 1)}>Anterior</button><button type="button" disabled={busy || !resourceNext} onClick={() => pickResources(pick, resourcePage + 1)}>Siguiente</button><button type="button" onClick={() => setPick(null)}>Cerrar selección</button></section>}
                </fieldset>
                <footer><button disabled={busy} type="button" onClick={async () => {if (await confirmBold("¿Descartar los cambios sin guardar?")) {setDraft(null); setPick(null);}}}>Cancelar</button><button disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar marca"}</button></footer>
            </form> : selected ? <>
                <header><h2>{selected.name}</h2>{selected.logo && <img className="brand_logo" src={selected.logo} alt="Logo"/>}</header><p className="brand_description">{selected.description || "Sin descripción"}</p>
                <dl>{brandFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{selected.details[key] || "—"}</dd></div>)}<div><dt>Pauta publicitaria</dt><dd>{selected.details.paid_ads ? "Sí" : "No"}</dd></div><div><dt>Audiovisual</dt><dd>{selected.details.audiovisual ? "Sí" : "No"}</dd></div>{Object.entries(selected.details.extra || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
                <p>{selected.project_ids.length} proyectos · {selected.task_ids.length} tareas asociados.</p><BrandResources brand={selected}/>
                <footer><button disabled={busy || !capabilities.manage} onClick={() => {setDraft(brandDraft(selected)); setPick(null);}}>Editar marca</button>{creator && <><button disabled={busy || !capabilities.share} onClick={() => setShareOpen(value => !value)}>Gestionar colaboradores ({selected.member_ids.length})</button><button disabled={busy || !capabilities.manage} onClick={async () => {if (await confirmBold("¿Archivar la marca? Sus proyectos y tareas no se eliminarán.")) run(async () => {await brandsApi.archive(selected); if (mounted.current) {setRows(rows.filter(row => row.id !== selected.id)); setSelected(null);}});}}>Archivar</button></>}</footer>
                {shareOpen && <section><h3>Colaboradores</h3><p>Selecciona empleados de cualquier departamento. Para editar necesitan también el permiso de marcas de su cargo.</p><input aria-label="Buscar colaboradores" placeholder="Nombre o correo" value={personQuery} onChange={event => setPersonQuery(event.target.value)}/>{people.map(person => <label className="brand_check" key={person.id}><input type="checkbox" disabled={busy} checked={selected.member_ids.includes(person.id)} onChange={() => run(async () => {const value = await brandsApi.share(selected, toggleBrandLink(selected.member_ids, person.id)); if (mounted.current) {setSelected(value); setRows(items => items.map(row => row.id === value.id ? value : row));}})}/>{person.name} · {person.unit_name}</label>)}</section>}
            </> : <p>Selecciona una marca para consultar su contexto o crea una nueva.</p>}
        </article></div>
        <aside className="docs_development_notice" role="note"><p><strong>Se está trabajando en este módulo.</strong></p><img src="/bold-loader.svg" alt="" aria-hidden="true" width="210" height="122"/></aside>
        {logoFile && draft && <AvatarEditor file={logoFile} onClose={() => setLogoFile(null)} onApply={value => {setDraft(current => ({...current, logo: value})); setLogoFile(null);}}/>}
    </section>;
}

function BrandResources({brand}) {
    const [projects, setProjects] = useState([]), [tasks, setTasks] = useState([]), [error, setError] = useState("");
    useEffect(() => {
        let alive = true; setProjects([]); setTasks([]); setError("");
        const batches = ids => Array.from({length: Math.ceil(ids.length / 50)}, (_, index) => ids.slice(index * 50, index * 50 + 50));
        const load = async () => {
            try {
                // Detail-only lookups, never download all organization tasks on every refresh.
                const [p, t] = await Promise.all([
                    Promise.all(batches(brand.project_ids).map(ids => http.list("projects", {ids: ids.join(",")}))),
                    Promise.all(batches(brand.task_ids).map(ids => http.list("tasks", {ids: ids.join(",")}))),
                ]);
                if (alive) {setProjects(p.flat()); setTasks(t.flat().filter(row => brand.task_ids.includes(row.id)));}
            } catch (problem) {if (alive) setError(problem.message);}
        };
        load(); return () => {alive = false;};
    }, [brand.id, brand.revision]);
    return <section><h3>Proyectos autorizados</h3>{projects.map(row => <button key={row.id} onClick={() => window.dispatchEvent(new CustomEvent("bold:brand-resource", {detail: {project: row.id}}))}>{row.name}</button>)}<h3>Tareas autorizadas</h3>{tasks.map(row => <button key={row.id} onClick={() => window.dispatchEvent(new CustomEvent("bold:brand-resource", {detail: {task: row.id, project: row.project}}))}>{row.title || row.name}</button>)}{error && <p role="alert">{error}</p>}<small>Las asociaciones sin permiso no muestran su contenido.</small></section>;
}
