import { AvatarImage } from "../../core/shared/avatar_image.jsx";
import { TaskText } from "./task_text_editor.jsx";
import {useState} from "react";
import {Filter, X} from "lucide-react";
import {createPortal} from "react-dom";
import {useDialog} from "../../core/shared/use_dialog.js";
import {useCore} from "../../core/core_provider.jsx";
import {useShell} from "../../core/app_shell.jsx";
import {groupPresence, presenceLabel} from "../../core/shared/presence.js";
import "../../core/shared/presence.css";
import "./presence_widget.css";

function PersonProfile({person, placements, onClose}) {
    useDialog(true, ".home_presence_profile", onClose);
    const emails = [...new Set(placements.map(row => row.email).filter(Boolean))];
    return createPortal(<div className="home_presence_profile_overlay" onClick={onClose}>
        <section className="home_presence_profile" role="dialog" aria-modal="true" aria-labelledby="person-profile-title" onClick={event => event.stopPropagation()}>
            <button type="button" className="home_presence_profile_close" aria-label="Cerrar información del empleado" onClick={onClose}><X size={20}/></button>
            <span className="home_presence_avatar"><AvatarImage url={person.avatar_url} initials={person.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}/></span>
            <h2 id="person-profile-title">{person.name}</h2><p>{presenceLabel(person)}</p>
            <dl><dt>Cargo y departamento</dt><dd>{placements.length ? placements.map(row => <div key={row.id}><strong>{row.job_role_title || "Empleado"}</strong><span>{row.unit_name}</span></div>) : person.units?.map(row => <div key={row.id}>{row.name}</div>)}</dd>
                <dt>Correo empresarial</dt><dd>{emails.length ? emails.map(email => <a key={email} href={`mailto:${email}`}>{email}</a>) : "No disponible"}</dd></dl>
        </section>
    </div>, document.getElementById("bold-overlay-root") || document.body);
}

export default function PresenceWidget({heading}) {
    const core = useCore();
    const shell = useShell();
    const [query, setQuery] = useState("");
    const [unit, setUnit] = useState("");
    const [filterOpen, setFilterOpen] = useState(false);
    const [profile, setProfile] = useState(null);
    const placementsFor = person => (core.directory || []).filter(item => String(item.personId || item.employee) === String(person.employee_id));
    const canChat = person => core.activeAssignment?.chat_enabled === true && shell?.open_direct_chat
        && person.employee_id !== (core.employee?.id || core.account?.employee || core.activeAssignment?.personId)
        && placementsFor(person).some(item => item.chat_enabled === true);
    const rows = core.presence?.rows || [];
    const departments = groupPresence(rows, "", "", core.activeUnit?.id, core.presence?.units || []);
    const groups = groupPresence(rows, query, unit, core.activeUnit?.id, core.presence?.units || []);
    return <>{heading}
        <div className="home_presence_controls"><div className="home_presence_search"><input type="search" aria-label="Buscar persona o estado" placeholder="Buscar persona o estado…" value={query} onChange={event => setQuery(event.target.value)}/><button type="button" className="home_presence_filter" title="Filtrar por departamento" aria-label="Filtrar por departamento" aria-expanded={filterOpen} data-active={!!unit} onClick={() => setFilterOpen(value => !value)}><Filter size={16}/></button></div>
            {filterOpen && <select aria-label="Departamento del equipo" value={unit} onChange={event => setUnit(event.target.value)}><option value="">Todos los departamentos</option>{departments.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
        </div>
        <div className="home_presence_list" aria-label="Personas por departamento">
            {groups.map(group => <section className="home_presence_department" key={group.id} aria-label={`${group.name}: ${group.people.length} personas`}>
                <h3>{group.name}<span>— {group.people.length}</span></h3>
                <div role="list">{group.people.map(row => <div className="home_presence_person" data-chat={Boolean(canChat(row))} key={row.employee_id} role="listitem" onClick={event => {if (canChat(row) && !event.target.closest("button,a")) shell.open_direct_chat(row);}}>
                    <button type="button" className="home_presence_avatar home_presence_chat" aria-label={`Ver perfil de ${row.name}`} title={`Ver información de ${row.name}`} onClick={() => setProfile(row)}><AvatarImage url={row.avatar_url} initials={row.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()} /><span className={`bold_presence_dot bold_presence_${row.status}`} aria-hidden="true"/></button>
                    {canChat(row) ? <button type="button" className="home_presence_identity home_presence_open_chat" aria-label={`Abrir chat con ${row.name}`} onClick={() => shell.open_direct_chat(row)}><strong title={row.name}>{row.name}</strong><span className="home_presence_status" title={presenceLabel(row)}>{presenceLabel(row)}</span>{row.description && <span className="home_presence_description">{row.description}</span>}</button> : <div className="home_presence_identity"><strong title={row.name}>{row.name}</strong><span className="home_presence_status" title={presenceLabel(row)}>{presenceLabel(row)}</span>{row.description && <TaskText className="home_presence_description" value={row.description}/>}</div>}
                </div>)}</div>
                {!group.people.length && <p className="home_presence_hint">Sin personas asignadas.</p>}
            </section>)}
            {!groups.length && <p className="home_empty" role="status">{core.presence ? "No hay personas con este filtro." : "Esperando la conexión en vivo. No se puede confirmar la disponibilidad."}</p>}
        </div>
        {profile && <PersonProfile person={profile} placements={placementsFor(profile)} onClose={() => setProfile(null)}/>}
    </>;
}
