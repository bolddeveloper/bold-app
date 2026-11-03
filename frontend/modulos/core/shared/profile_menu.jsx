import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ChevronRight, LogOut, Newspaper, Pencil, Building2, Clock3, X} from "lucide-react";
import {useCore} from "../core_provider.jsx";
import {useDialog} from "./use_dialog.js";
import "./profile_menu.css";
import PresenceMenu from "./presence_menu.jsx";
import {AvatarImage} from "./avatar_image.jsx";
export function ProfileAvatar({className = "", url, initials}) {
    return <span className={`bold_profile_avatar ${className}`}><AvatarImage url={url} initials={initials || "B"}/></span>;
}

// One quick profile card for both entry points; the gear opens account settings.
export function ProfileQuickMenu({anchor, close, openProfile, changeDepartment}) {
    const core = useCore(), panel = useRef(null), departmentPanel = useRef(null), departmentButton = useRef(null);
    const [position, setPosition] = useState({left: 12, top: 12}), [departments, setDepartments] = useState(false);
    const presenceButton = useRef(null);
    const [availability, setAvailability] = useState(false);
    const openAvailability = () => {setDepartments(false);setAvailability(true);};
    useDialog(true, ".bold_profile_popover", close);
    useLayoutEffect(() => {
        const place = () => {
            const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport;
            const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
            const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
            const above = rect.top > height / 2;
            setPosition({left: Math.max(left + 12, Math.min(rect.left, left + width - panel.current.offsetWidth - 12)), top: Math.max(top + 12, Math.min(above ? rect.top - panel.current.offsetHeight - 10 : rect.bottom + 10, top + height - panel.current.offsetHeight - 12))});
        };
        place(); window.addEventListener("resize", place); window.visualViewport?.addEventListener("resize", place);
        return () => {window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place);};
    }, [anchor, departments]);
    useEffect(() => {
        const outside = event => {if (!panel.current?.contains(event.target) && !departmentPanel.current?.contains(event.target) && !anchor.contains(event.target)) close();};
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [anchor, close]);
    const account = core.account, identity = core.activeAssignment;
    const dark = document.documentElement.dataset.boldTheme === "dark";
    return createPortal(<><section ref={panel} className={`bold_profile_popover bold_profile_quick ${dark ? "theme_dark" : ""}`} role="dialog" aria-modal="true" aria-label="Ajustes rápidos del perfil" style={position} onKeyDown={event=>{if(event.key==="Escape" && (departments || availability)){event.preventDefault();event.stopPropagation();if(departments){setDepartments(false);departmentButton.current?.focus();}else{setAvailability(false);presenceButton.current?.focus();}}}}>
        <header className="bold_profile_quick_header"><span>Tu cuenta</span><button type="button" aria-label="Cerrar perfil" onClick={close}><X size={17}/></button></header>
        <div className="bold_profile_quick_identity">
            <ProfileAvatar url={account?.avatar_url} initials={identity?.initials}/>
            <div><h2>{core.employee?.full_name || identity?.name}</h2><p>{account?.email || identity?.email}</p><small>{identity?.unit_name} · {identity?.job_role_title}</small></div>
        </div>
        <div className="bold_profile_quick_actions">
            <button type="button" className="bold_profile_action" onClick={() => {close();openProfile(true);}}><Pencil size={16}/>Editar perfil</button>
            <div>
                <button type="button" ref={presenceButton} className="bold_profile_action" aria-expanded={availability} onClick={()=>availability ? setAvailability(false):openAvailability()} onKeyDown={event=>{if(event.key==="ArrowRight"){event.preventDefault();openAvailability();window.requestAnimationFrame(()=>panel.current?.querySelector(".bold_profile_submenu button")?.focus());}}}><Clock3 size={16}/>Mi disponibilidad<ChevronRight size={15}/></button>
                {availability && <PresenceMenu trigger={presenceButton} dark={dark} close={()=>{setAvailability(false);presenceButton.current?.focus();}} configure={()=>{close();openProfile(false,"presence");}}/>}
            </div>
            <button type="button" ref={departmentButton} className="bold_profile_action" aria-expanded={departments} aria-controls={departments ? "bold_profile_departments":undefined} onClick={()=>{setAvailability(false);setDepartments(value=>!value);}} onKeyDown={event=>{if(event.key==="ArrowRight"){event.preventDefault();setAvailability(false);setDepartments(true);window.requestAnimationFrame(()=>departmentPanel.current?.querySelector("button")?.focus());}}}><Building2 size={16}/>Cambiar departamento<ChevronRight size={15}/></button>
            <button type="button" className="bold_profile_action" onClick={()=>{close();openProfile(false,"news");}}><Newspaper size={16}/>Novedades</button>
            <button type="button" className="bold_profile_action bold_profile_logout" onClick={()=>{close();core.logout();}}><LogOut size={16}/>Cerrar sesión</button>
        </div>
    {departments && <DepartmentMenu panel={departmentPanel} card={panel} trigger={departmentButton} position={position} dark={dark} close={() => {setDepartments(false); departmentButton.current?.focus();}} assignments={core.assignments} currentId={identity?.id} choose={async id => {if (id === identity?.id || await changeDepartment(id)) close();}}/>}</section></>, document.body);
}

function DepartmentMenu({panel, card, trigger, position, dark, close, assignments, currentId, choose}) {
    const [placement, setPlacement] = useState({left: 12, top: 12});
    useLayoutEffect(() => {
        const place = () => {
            const rect = card.current.getBoundingClientRect(), button = trigger.current.getBoundingClientRect(), viewport = window.visualViewport;
            const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
            const right = left + (viewport?.width || window.innerWidth), bottom = top + (viewport?.height || window.innerHeight);
            const width = panel.current.offsetWidth, height = panel.current.offsetHeight;
            const x = rect.right + width + 10 <= right - 12 ? rect.right + 10 : rect.left - width - 10;
            setPlacement({left: Math.max(left + 12, Math.min(x, right - width - 12)), top: Math.max(top + 12, Math.min(button.top, bottom - height - 12))});
        };
        place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true); window.visualViewport?.addEventListener("resize", place);
        return () => {window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.visualViewport?.removeEventListener("resize", place);};
    }, [position]);
    return <aside ref={panel} id="bold_profile_departments" className={`bold_profile_departments ${dark ? "theme_dark" : ""}`} aria-label="Cambiar departamento" style={placement} onKeyDown={event => {if (event.key === "Escape") {event.stopPropagation(); close();}}}>
        <header><h3>Departamentos</h3><button type="button" aria-label="Cerrar departamentos" onClick={close}><X size={17}/></button></header>
        {assignments.map(row => <button type="button" key={row.id} aria-pressed={row.id === currentId} onClick={() => choose(row.id)}><span><strong>{row.unit_name || row.name}</strong><small>{row.job_role_title || "Departamento"}</small></span>{row.id === currentId && <Check size={17}/>}</button>)}
        {assignments.length === 1 && <p>Solo tienes un departamento asignado.</p>}
    </aside>;
}

