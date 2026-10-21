import {useEffect, useRef, useState} from "react";
import {Building2, Check, UserPlus, Users, X} from "lucide-react";
import {channelApi, channelError} from "./channel_api.js";
import {Dropdown, PersonIdentity, SearchField, DepartmentTag} from "./channel_picker.jsx";
import {invitePeople, personMatches} from "./channel_discovery.js";
import {normalizeQuery} from "./messaging_models.js";

export default function ChannelAccessFields({unit, channelId, visibility, members, onVisibility, onMembers, onBusyChange, disabled=false}) {
    const [query,setQuery]=useState(""),[people,setPeople]=useState([]),[departments,setDepartments]=useState([]),[next,setNext]=useState(null);
    const [error,setError]=useState(""),[loading,setLoading]=useState(false),[bulk,setBulk]=useState(null),[notice,setNotice]=useState("");
    const [open,setOpen]=useState(false),[tab,setTab]=useState("people"),[memberQuery,setMemberQuery]=useState("");
    const scope=channelId ? {channel:channelId} : {unit:unit || ""},request=useRef(null),bulkRequest=useRef(null),current=useRef(members);
    current.current=members;
    useEffect(()=>()=>{bulkRequest.current?.abort();bulkRequest.current=null;onBusyChange?.(false);},[channelId,unit]);
    useEffect(()=>{
        request.current?.abort();
        if(!open)return;
        const controller=new AbortController();request.current=controller;setPeople([]);setNext(null);setError("");setLoading(true);
        const timer=setTimeout(()=>channelApi.people({...scope,q:tab==="people" ? query : ""},{signal:controller.signal})
            .then(page=>{if(!controller.signal.aborted){setPeople(page.results);setDepartments(page.departments || []);setNext(page.next);}})
            .catch(err=>{if(!controller.signal.aborted)setError(channelError(err));})
            .finally(()=>{if(!controller.signal.aborted)setLoading(false);}),200);
        return()=>{clearTimeout(timer);controller.abort();};
    },[channelId,unit,query,open,tab]);
    async function more(){
        if(loading || !next)return;setLoading(true);const controller=request.current;
        try{const page=await channelApi.people({...scope,q:query},{signal:controller.signal},next);if(!controller.signal.aborted){setPeople(rows=>[...new Map([...rows,...page.results].map(row=>[row.employee_id,row])).values()]);setNext(page.next);}}
        catch(err){if(!controller.signal.aborted)setError(channelError(err));}finally{if(!controller.signal.aborted)setLoading(false);}
    }
    function add(people){const updated=invitePeople(current.current,people);const count=updated.length-current.current.length;onMembers(updated);setNotice(count ? `${count} ${count===1 ? "persona añadida" : "personas añadidas"}. Guarda para aplicar las invitaciones.` : "Estas personas ya tienen una regla; sus accesos se conservaron.");}
    async function inviteDepartment(department){
        if(bulkRequest.current)return;
        const controller=new AbortController();bulkRequest.current=controller;setBulk(department.id);onBusyChange?.(true);setError("");
        try{
            const filters={...scope,department:department.id},seen=new Set(),all=[];let cursor=null;
            do{
                const page=await channelApi.people(filters,{signal:controller.signal},cursor);
                if(controller.signal.aborted)return;
                all.push(...page.results);invitePeople(current.current,all); // fail atomically before mutating
                cursor=page.next;if(cursor && seen.has(cursor))throw Error("La lista cambió. Reintenta la invitación del departamento.");seen.add(cursor);
            }while(cursor);
            add(all);
        }catch(err){if(!controller.signal.aborted)setError(err.message && !err.status ? err.message : channelError(err));}
        finally{if(bulkRequest.current===controller){bulkRequest.current=null;if(!controller.signal.aborted){setBulk(null);onBusyChange?.(false);}}}
    }
    const locked=disabled || !!bulk;
    return <fieldset className="slack_access_fields" disabled={locked}>
        <legend>Privacidad y participación</legend>
        <label>Quién puede entrar<select value={visibility} onChange={event=>onVisibility(event.target.value)}>
            <option value="public">Todos los empleados</option>{unit && <option value="department">Departamento e invitados</option>}<option value="private">Solo personas invitadas</option>
        </select></label>
        <p className="slack_access_hint">{visibility==="private" ? "Ni el propietario ni los administradores pueden leer sin una invitación. Al crear, se incluye al creador como invitado." : visibility==="department" ? "Entra el departamento de la asignación activa y las personas añadidas. Las excepciones individuales prevalecen." : "Puede entrar cualquier empleado, salvo las restricciones individuales y del módulo Permisos."} El piloto sigue limitado a IT.</p>
        <Dropdown label={<><UserPlus size={18} aria-hidden="true"/>Invitar personas</>} open={open} onToggle={setOpen} disabled={locked}>
            <div className="slack_picker_tabs" role="group" aria-label="Tipo de invitación"><button type="button" aria-pressed={tab==="people"} onClick={()=>{setTab("people");setQuery("");}}><Users size={16} aria-hidden="true"/>Personas</button><button type="button" aria-pressed={tab==="departments"} onClick={()=>{setTab("departments");setQuery("");}}><Building2 size={16} aria-hidden="true"/>Departamentos</button></div>
            <SearchField label={tab==="people" ? "Buscar persona" : "Buscar departamento a invitar"} placeholder={tab==="people" ? "Nombre, correo o departamento" : "Nombre del departamento"} value={query} onChange={setQuery} autoFocus/>
            <div className="slack_picker_results slack_access_candidates" aria-label="Personas disponibles" aria-busy={loading || !!bulk}>
                {loading && <small role="status">Buscando…</small>}
                {tab==="people" ? <>{people.map(person=>{const added=members.some(row=>row.employee_id===person.employee_id);return <button type="button" data-picker-option key={person.employee_id} aria-label={added ? `${person.name}, ya añadido` : `Añadir a ${person.name}`} disabled={added || locked || members.length>=200} onClick={()=>{try{add([person]);}catch(err){setError(err.message);}}}><PersonIdentity person={person}/>{added ? <Check size={17} aria-hidden="true"/> : <UserPlus size={17} aria-hidden="true"/>}</button>;})}{!loading && !people.length && <p>No se encontraron personas activas.</p>}{next && <button type="button" disabled={loading || locked} onClick={more}>Cargar más personas</button>}</> : <>{departments.filter(row=>normalizeQuery(row.name).includes(normalizeQuery(query))).map(row=><button type="button" data-picker-option key={row.id} disabled={locked} onClick={()=>inviteDepartment(row)} aria-label={`Invitar departamento ${row.name}`}><Building2 size={22} aria-hidden="true"/><span className="slack_person_identity"><DepartmentTag department={row}/><small>{row.count} {row.count===1 ? "persona activa" : "personas activas"}</small></span><UserPlus size={18} aria-hidden="true"/></button>)}{!loading && !departments.some(row=>normalizeQuery(row.name).includes(normalizeQuery(query))) && <p>No hay departamentos coincidentes.</p>}</>}
            </div>
            {tab==="departments" && <p className="slack_access_hint">Añade a las personas activas actuales. No incluye futuros miembros ni cambia las reglas ya asignadas. Invitar no amplía el piloto fuera de IT.</p>}
        </Dropdown>
        {bulk && <p role="status">Preparando invitaciones del departamento…</p>}
        {notice && <p className="slack_access_feedback" role="status">{notice}</p>}
        {error && <p className="slack_error" role="alert">{error}</p>}
        <Dropdown label={<><Users size={18} aria-hidden="true"/>Personas con acceso o excepción ({members.length})</>} disabled={locked}>
            <SearchField label="Buscar persona invitada" value={memberQuery} onChange={setMemberQuery} placeholder="Nombre, correo o departamento" autoFocus/>
            <ul className="slack_access_members" aria-label="Excepciones e invitaciones">
                {members.filter(person=>personMatches(person,memberQuery)).map(person=><li key={person.employee_id}><div className="slack_person_row"><PersonIdentity person={person}/></div><div className="slack_member_actions"><label><span className="slack_sr_only">Acceso de {person.name || "empleado"}</span><select aria-label={`Acceso de ${person.name || "empleado"}`} value={person.access} onChange={event=>onMembers(members.map(row=>row.employee_id===person.employee_id ? {...row,access:event.target.value} : row))}><option value="write">Leer y participar</option><option value="read">Solo lectura</option><option value="blocked">Sin acceso</option></select></label><button type="button" aria-label={`Quitar excepción de ${person.name || "empleado"}`} onClick={()=>onMembers(members.filter(row=>row.employee_id!==person.employee_id))}><X size={17} aria-hidden="true"/></button></div></li>)}
                {!members.some(person=>personMatches(person,memberQuery)) && <li className="slack_members_empty">{members.length ? "No hay personas coincidentes." : "Aún no has añadido invitaciones ni excepciones."}</li>}
            </ul>
        </Dropdown>
        <small>Quitar una excepción restaura la regla general; en un canal privado retira la invitación. «Sin acceso» siempre bloquea la lectura. Máximo 200 personas, incluido el creador.</small>
    </fieldset>;
}
