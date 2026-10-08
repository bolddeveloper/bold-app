import { AvatarImage } from "../../core/shared/avatar_image.jsx";
import { TaskText } from "./task_text_editor.jsx";
import {useState} from "react";
import {useCore} from "../../core/core_provider.jsx";
import {groupPresence, presenceLabel} from "../../core/shared/presence.js";
import "../../core/shared/presence.css";
import "./presence_widget.css";

export default function PresenceWidget({heading}) {
    const core = useCore();
    const [query, setQuery] = useState("");
    const rows = core.presence?.rows || [];
    const groups = groupPresence(rows, query);
    return <>{heading}
        <div className="home_presence_controls"><input type="search" aria-label="Buscar empleado conectado" placeholder="Buscar persona o estado…" value={query} onChange={event => setQuery(event.target.value)}/></div>
        <div className="home_presence_list" aria-label="Empleados conectados por departamento">
            {groups.map(group => <section className="home_presence_department" key={group.id} aria-label={`${group.name}: ${group.people.length} personas conectadas`}>
                <h3>{group.name}<span>— {group.people.length}</span></h3>
                <div role="list">{group.people.map(row => <div className="home_presence_person" key={row.employee_id} role="listitem">
                    <div className="home_presence_avatar" aria-hidden="true"><AvatarImage url={row.avatar_url} initials={row.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()} /><span className={`bold_presence_dot bold_presence_${row.status}`}/></div>
                    <div className="home_presence_identity"><strong title={row.name}>{row.name}</strong><span className="home_presence_status" title={presenceLabel(row)}>{presenceLabel(row)}</span>{row.description && <TaskText className="home_presence_description" value={row.description} />}</div>
                </div>)}</div>
            </section>)}
            {!groups.length && <p className="home_empty" role="status">{core.presence ? "No hay personas conectadas con este filtro." : "Esperando la conexión en vivo. No se puede confirmar quién está conectado."}</p>}
        </div>
    </>;
}
