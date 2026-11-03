import {createPortal} from "react-dom";
import {Search, Trash2, X} from "lucide-react";
import {AvatarImage} from "../../core/shared/avatar_image.jsx";
import {useDialog} from "../../core/shared/use_dialog.js";
import {normalizeSearchText} from "../../core/global_search.js";
import {personIdentity, uniquePeople} from "../../core/shared/people.js";

export default function WorkspaceShareDialog({folder, members, ids, onChange, busy, error, onClose, query, setQuery, core}) {
    useDialog(true, ".folder_share_dialog", onClose);
    const matching = person => normalizeSearchText(`${person.name} ${person.email || ""}`).includes(normalizeSearchText(query));
    const people = uniquePeople(members, ids).filter(person => personIdentity(person) !== personIdentity(core.activeAssignment));
    const assigned = people.filter(person => ids.includes(person.id));
    const candidates = people.filter(person => !ids.includes(person.id) && matching(person));
    const personRow = (person, added) => <><span className="folder_share_avatar"><AvatarImage url={person.avatar_url} initials={person.initials}/></span><span><strong>{person.name}</strong><small>{person.email}</small></span>{added ? <button type="button" className="folder_share_remove" disabled={busy} aria-label={`Quitar a ${person.name} de la carpeta`} onClick={() => onChange(person, true)}><Trash2 size={16}/></button> : <small>Agregar</small>}</>;
    return createPortal(<div className="folder_overlay" onPointerDown={event => {if (event.target === event.currentTarget) onClose();}}><section className="folder_dialog folder_share_dialog" role="dialog" aria-modal="true" aria-label="Personas de la carpeta">
        <header><h2>Personas de la carpeta</h2><button type="button" aria-label="Cerrar personas de la carpeta" onClick={onClose}><X size={18}/></button></header>
        <p className="folder_share_context">{folder.name} · {assigned.length + 1} personas</p>
        <p className="folder_help">Comparte la organización de esta carpeta y sus subcarpetas. Cada proyecto, tarea y archivo conserva sus permisos.</p>
        <label className="folder_share_search"><Search size={16}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o correo interno" aria-label="Buscar personas de BOLD"/></label>
        <div className="folder_share_people">
            <div className="folder_share_person"><span className="folder_share_avatar"><AvatarImage url={core.account?.avatar_url} initials={core.activeAssignment?.initials || "Tú"}/></span><span><strong>{core.activeAssignment?.name || "Tú"}</strong><small>{core.account?.email}</small></span><small>Propietario</small></div>
            {assigned.filter(matching).map(person => <div className="folder_share_person" key={person.id}>{personRow(person, true)}</div>)}
            <div className="folder_share_candidates_heading">Añadir personas <span>{candidates.length}</span></div>
            {candidates.slice(0,50).map(person => <button type="button" className="folder_share_person" key={person.id} disabled={busy} aria-label={`Agregar a ${person.name} a la carpeta`} onClick={() => onChange(person)}>{personRow(person, false)}</button>)}
            {!candidates.length && <p>No hay personas que coincidan para agregar.</p>}
            {candidates.length>50 && <small>Mostrando 50 personas. Busca por nombre o correo para acotar.</small>}
        </div>{error && <p role="alert">{error}</p>}<footer><small role="status">{busy ? "Guardando acceso…" : "Las personas añadidas pueden organizar este contexto compartido."}</small><button type="button" className="primary_button" disabled={busy} onClick={onClose}>Listo</button></footer>
    </section></div>, document.body);
}
