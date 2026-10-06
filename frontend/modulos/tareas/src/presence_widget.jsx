import {useMemo, useState} from "react";
import {useCore} from "../../core/core_provider.jsx";
import {BoldSelect} from "../../core/shared/bold_select.jsx";
import {filterPresence, presenceLabel} from "../../core/shared/presence.js";
import "../../core/shared/presence.css";
import "./presence_widget.css";

export default function PresenceWidget({heading}) {
    const core = useCore();
    const [unit, setUnit] = useState(""), [query, setQuery] = useState("");
    const rows = core.presence?.rows || [];
    const units = useMemo(() => [...new Map(rows.flatMap(row => row.units || []).map(item => [item.id, item])).values()].sort((a,b) => a.name.localeCompare(b.name, "es")), [rows]);
    const visible = filterPresence(rows, unit, query);
    return <>{heading}<div className="home_presence_controls"><BoldSelect label="Filtrar empleados por departamento" value={unit} onValueChange={setUnit} options={[{value: "", label: "Toda la organización"}, ...units.map(item => ({value: item.id, label: item.name})), ...(unit && !units.some(item => item.id === unit) ? [{value: unit, label: "Departamento sin conexiones"}] : [])]}/><input type="search" aria-label="Buscar empleado conectado" placeholder="Buscar persona o estado…" value={query} onChange={event => setQuery(event.target.value)}/></div><div className="home_presence_list" role="list" aria-label="Empleados conectados">{visible.map(row => <div className="home_presence_person" key={row.employee_id} role="listitem"><div className="home_presence_avatar" aria-hidden="true">{row.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}<span className={`bold_presence_dot bold_presence_${row.status}`}/></div><div className="home_presence_identity"><strong title={row.name}>{row.name}</strong><span className="home_presence_status" title={presenceLabel(row)}>{presenceLabel(row)}</span>{row.description && <small className="home_presence_description" title={row.description}>{row.description}</small>}<small className="home_presence_units" title={row.units.map(item => item.name).join(" · ")}>{row.units.map(item => item.name).join(" · ")}</small></div></div>)}{!visible.length && <p className="home_empty" role="status">{core.presence ? "No hay personas conectadas con este filtro." : "Esperando la conexión en vivo. No se puede confirmar quién está conectado."}</p>}</div><small className="home_presence_hint">{core.presence ? `${visible.length} ${visible.length === 1 ? "persona conectada" : "personas conectadas"} · Actualización en vivo` : "La disponibilidad se comparte solo mientras BOLD está conectado."}</small></>;
}
