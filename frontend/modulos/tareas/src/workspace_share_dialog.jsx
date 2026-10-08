import {createPortal} from "react-dom";
import {Search, Trash2, X} from "lucide-react";
import {AvatarImage} from "../../core/shared/avatar_image.jsx";
import {useDialog} from "../../core/shared/use_dialog.js";
import {normalizeSearchText} from "../../core/global_search.js";

export default function WorkspaceShareDialog({folder, members, ids, onChange, busy, error, onClose, query, setQuery, core}) {
    useDialog(true, ".folder_share_dialog", onClose);
    const matching = person => normalizeSearchText(`${person.name} ${person.email || ""}`).includes(normalizeSearchText(query));
    const candidates = members.filter(person => person.id !== core.activeAssignment?.id && !ids.includes(person.id) && matching(person));
    const personRow = (person, added) => <><span className="folder_share_avatar"><AvatarImage url={person.avatar_url} initials={person.initials}/></span><span><strong>{person.name}</strong><small>{person.email}</small></span>{added ? <button type="button" className="folder_share_remove" disabled={busy} aria-label={`Quitar a ${person.name} de la carpeta`} onClick={() => onChange(person, true)}><Trash2 size={16}/></button> : <small>Agregar</small>}</>;
    return createPortal(<div className="folder_overlay" onPointerDown={event => {if (event.target === event.currentTarget) onClose();}}><section className="folder_dialog folder_share_dialog" role="dialog" aria-modal="true" aria-label="Personas de la carpeta">
        <header><h2>Personas de la carpeta</h2><button type="button" aria-label="Cerrar personas de la carpeta" onClick={onClose}><X size={18}/></button></header>
        <p>{folder.name} · {ids.length + 1} personas</p>
        <label className="folder_share_search"><Search size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar personas del departamento"/></label>
        <div className="folder_share_people">
            <div className="folder_share_person"><span className="folder_share_avatar"><AvatarImage url={core.account?.avatar_url} initials={core.activeAssignment?.initials || "Tú"}/></span><span><strong>{core.activeAssignment?.name || "Tú"}</strong><small>{core.account?.email}</small></span><small>Propietario</small></div>
            {members.filter(person => person.id !== core.activeAssignment?.id && ids.includes(person.id) && matching(person)).map(person => <div className="folder_share_person" key={person.id}>{personRow(person, true)}</div>)}
            {!!query.trim() && <><small>{candidates.length} personas para agregar</small>{candidates.map(person => <button type="button" className="folder_share_person" key={person.id} disabled={busy} onClick={() => onChange(person)}>{personRow(person, false)}</button>)}</>}
        </div>{error && <p role="alert">{error}</p>}<small>Busca personas de tu departamento. Los permisos de proyectos y Drive se mantienen.</small>
    </section></div>, document.body);
}
