import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ChevronRight, LogOut, Newspaper, Pencil, User, X} from "lucide-react";
import {useCore} from "../core_provider.jsx";
import {useDialog} from "./use_dialog.js";
import "./profile_menu.css";
export function ProfileAvatar({className = "", url, initials}) {
    return <span className={`bold_profile_avatar ${className}`}>{url ? <img src={url} alt=""/> : initials || "B"}</span>;
}

// One quick profile card for both entry points; the gear opens account settings.
export function ProfileQuickMenu({anchor, close, openProfile, changeDepartment}) {
    const core = useCore(), panel = useRef(null), departmentPanel = useRef(null), departmentButton = useRef(null);
    const [position, setPosition] = useState({left: 12, top: 12}), [departments, setDepartments] = useState(false);
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
    return createPortal(<><section ref={panel} className={`bold_profile_popover ${dark ? "theme_dark" : ""}`} role="dialog" aria-modal="true" aria-label="Ajustes rápidos del perfil" style={position}>
        <div className="bold_profile_banner" style={{background:account?.banner_color || "#ef1f2d"}}><button aria-label="Cerrar perfil" onClick={close}><X size={18}/></button></div>
        <div className="bold_profile_card_content">
            <ProfileAvatar url={account?.avatar_url} initials={identity?.initials}/>
            <h2>{core.employee?.full_name || identity?.name}</h2><p>{account?.email || identity?.email}</p>
            <p className="bold_profile_department">{identity?.unit_name} · {identity?.job_role_title}</p>
            <button className="bold_profile_action" onClick={() => {close(); openProfile(true);}}><Pencil size={17}/>Editar perfil</button>
            <button ref={departmentButton} className="bold_profile_action" aria-expanded={departments} aria-controls={departments ? "bold_profile_departments" : undefined} aria-haspopup="dialog" onClick={() => setDepartments(value => !value)}><User size={17}/>Cambiar departamento<ChevronRight size={17}/></button>
            <button className="bold_profile_action" onClick={() => {close(); openProfile(false, "news");}}><Newspaper size={17}/>Novedades</button>
            <button className="bold_profile_action" onClick={() => {close(); core.logout();}}><LogOut size={17}/>Cerrar sesión</button>
        </div>
    </section>{departments && <DepartmentMenu panel={departmentPanel} card={panel} trigger={departmentButton} position={position} dark={dark} close={() => setDepartments(false)} assignments={core.assignments} currentId={identity?.id} choose={async id => {if (id === identity?.id || await changeDepartment(id)) close();}}/>}</>, document.body);
}

function DepartmentMenu({panel, card, trigger, position, dark, close, assignments, currentId, choose}) {
    const [placement, setPlacement] = useState({left: 12, top: 12});
    useDialog(true, ".bold_profile_departments", close);
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
    return <aside ref={panel} id="bold_profile_departments" className={`bold_profile_departments ${dark ? "theme_dark" : ""}`} role="dialog" aria-modal="true" aria-label="Cambiar departamento" style={placement}>
        <header><h3>Departamentos</h3><button type="button" aria-label="Cerrar departamentos" onClick={close}><X size={17}/></button></header>
        {assignments.map(row => <button type="button" key={row.id} aria-pressed={row.id === currentId} onClick={() => choose(row.id)}><span><strong>{row.unit_name || row.name}</strong><small>{row.job_role_title || "Departamento"}</small></span>{row.id === currentId && <Check size={17}/>}</button>)}
        {assignments.length === 1 && <p>Solo tienes un departamento asignado.</p>}
    </aside>;
}

