import {useEffect, useId, useRef, useState} from "react";
import {Check, ChevronDown, Hash, Search, X} from "lucide-react";
import {AvatarImage} from "../core/shared/avatar_image.jsx";
import {initials} from "./messaging_models.js";
import {channelColor, channelMatches} from "./channel_discovery.js";

export function DepartmentTag({department}) {
    return <span className="slack_person_department" style={{"--department-color":channelColor(department)}}>{department.name}</span>;
}
export function PersonIdentity({person}) {
    return <><span className="slack_person_avatar" aria-hidden="true"><AvatarImage url={person.avatar_url} initials={initials(person.name || "Empleado")}/></span><span className="slack_person_identity"><strong>{person.name || "Empleado"}</strong><span className="slack_person_departments">{person.departments?.length ? person.departments.map(row=><DepartmentTag key={row.id || row.name} department={row}/>) : <small>Sin departamento activo</small>}</span></span></>;
}
export function SearchField({label, value, onChange, placeholder, autoFocus=false}) {
    const id=useId(),input=useRef(null);
    return <div className="slack_search_field"><label className="slack_sr_only" htmlFor={id}>{label}</label><Search size={17} aria-hidden="true"/><input ref={input} id={id} type="search" autoComplete="off" autoFocus={autoFocus} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} maxLength={80}/>{value && <button type="button" className="slack_search_clear" aria-label={`Limpiar ${label.toLowerCase()}`} title="Limpiar búsqueda" onClick={()=>{onChange("");input.current?.focus();}}><X size={16} aria-hidden="true"/></button>}</div>;
}
// A disclosure with native buttons and fields: Tab and arrow navigation, no fake
// listbox roles around nested permission selects or bulk-invitation actions.
export function Dropdown({label, children, disabled=false, className="", onOpen, open:controlled, onToggle}) {
    const [local,setLocal]=useState(false),ref=useRef(null),trigger=useRef(null),id=useId();
    const open=controlled ?? local;
    function toggle(value){if(onToggle)onToggle(value);else setLocal(value);if(value)onOpen?.();}
    useEffect(()=>{
        if(!open)return;
        const outside=event=>{if(!ref.current?.contains(event.target))toggle(false);};
        // Panels occupy document flow. Closing on pointerdown would move a
        // sibling trigger between pointerdown and click and swallow activation.
        document.addEventListener("click",outside);
        return()=>document.removeEventListener("click",outside);
    },[open]);
    return <div ref={ref} className={`slack_dropdown ${className}`} onFocusCapture={event=>{
        if(event.target.tagName!=='SELECT')return;
        const dialog=ref.current?.closest('.slack_editor');if(!dialog)return;
        const control=event.target.getBoundingClientRect(),header=dialog.querySelector(':scope>header')?.getBoundingClientRect(),footer=dialog.querySelector('.slack_access_footer')?.getBoundingClientRect();
        const panel=dialog.getBoundingClientRect();
        if(control.top<(header?.bottom ?? panel.top)+8 || control.bottom>(footer?.top ?? panel.bottom)-8) event.target.scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});
    }} onKeyDown={event=>{
        if(event.key==="Escape" && open){event.preventDefault();event.stopPropagation();toggle(false);trigger.current?.focus();}
        if(event.key==="ArrowDown" && event.target===trigger.current){event.preventDefault();if(!open)toggle(true);else ref.current.querySelector(".slack_dropdown_panel input,.slack_dropdown_panel button")?.focus();}
        if(open && ["ArrowDown","ArrowUp","Home","End"].includes(event.key) && event.target.matches("[data-picker-option]")){
            event.preventDefault();const items=[...ref.current.querySelectorAll("[data-picker-option]:not(:disabled)")],index=items.indexOf(event.target);
            items[event.key==="Home" ? 0 : event.key==="End" ? items.length-1 : (index+(event.key==="ArrowDown" ? 1 : -1)+items.length)%items.length]?.focus();
        }
    }}><button ref={trigger} type="button" className="slack_dropdown_trigger" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>toggle(!open)}>{label}<ChevronDown size={17} className={open ? "is_open" : ""} aria-hidden="true"/></button>{open && <div id={id} className="slack_dropdown_panel">{typeof children==="function" ? children(()=>{toggle(false);trigger.current?.focus();}) : children}</div>}</div>;
}
export function ChannelPicker({rows, value, onChange, disabled, next, onMore, loading}) {
    const [query,setQuery]=useState("");
    return <Dropdown className="slack_access_catalog" disabled={disabled} label={value ? <ChannelIdentity channel={value}/> : "Elegir canal a administrar"}>{close=><><SearchField label="Buscar canal a administrar" value={query} onChange={setQuery} placeholder="Nombre del canal" autoFocus/><div className="slack_picker_results">{rows.filter(row=>channelMatches(row.name,query)).map(row=><button type="button" data-picker-option key={row.id} aria-pressed={row.id===value?.id} onClick={()=>{onChange(row);close();}}><ChannelIdentity channel={row}/>{row.id===value?.id && <Check size={17} aria-hidden="true"/>}</button>)}{!rows.some(row=>channelMatches(row.name,query)) && <p>No hay canales coincidentes.</p>}{next && <button type="button" disabled={loading} onClick={onMore}>{loading ? "Cargando…" : "Cargar más canales"}</button>}</div></>}</Dropdown>;
}
export function ChannelIdentity({channel}) {
    return <span className="slack_channel_identity"><span className="slack_channel_swatch" style={{"--channel-color":channelColor(channel)}}><Hash size={19} aria-hidden="true"/></span><span><strong>{channel.name}</strong><small>{channel.department?.name || "Sin departamento"} · {channel.visibility==="private" ? "Privado" : channel.visibility==="department" ? "Departamental" : "Público"}</small></span></span>;
}
