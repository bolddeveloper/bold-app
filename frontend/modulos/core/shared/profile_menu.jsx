import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ChevronDown, LogOut, Pencil, User, X} from "lucide-react";
import {useCore} from "../core_provider.jsx";
import {useDialog} from "./use_dialog.js";
import "./profile_menu.css";
export function ProfileAvatar({className = "", url, initials}) {
    return <span className={`bold_profile_avatar ${className}`}>{url ? <img src={url} alt=""/> : initials || "B"}</span>;
}

// One quick profile card for both entry points; the gear opens account settings.
export function ProfileQuickMenu({anchor, close, openProfile, changeDepartment}) {
    const core = useCore(), panel = useRef(null);
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
        const outside = event => {if (!panel.current?.contains(event.target) && !anchor.contains(event.target)) close();};
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [anchor, close]);
    const account = core.account, identity = core.activeAssignment;
    const dark = document.documentElement.dataset.boldTheme === "dark";
    return createPortal(<section ref={panel} className={`bold_profile_popover ${dark ? "theme_dark" : ""}`} role="dialog" aria-modal="true" aria-label="Ajustes rápidos del perfil" style={position}>
        <div className="bold_profile_banner" style={{background:account?.banner_color || "#ef1f2d"}}><button aria-label="Cerrar perfil" onClick={close}><X size={18}/></button></div>
        <div className="bold_profile_card_content">
            <ProfileAvatar url={account?.avatar_url} initials={identity?.initials}/>
            <h2>{core.employee?.full_name || identity?.name}</h2><p>{account?.email || identity?.email}</p>
            <p className="bold_profile_department">{identity?.unit_name} · {identity?.job_role_title}</p>
            <button className="bold_profile_action" onClick={() => {close(); openProfile(true);}}><Pencil size={17}/>Editar perfil</button>
            <button className="bold_profile_action" aria-expanded={departments} onClick={() => setDepartments(value => !value)}><User size={17}/>Cambiar departamento<ChevronDown size={17}/></button>
            {departments && <div className="bold_profile_departments" role="group" aria-label="Departamentos disponibles">
                {core.assignments.map(row => <button key={row.id} aria-pressed={row.id === identity?.id} onClick={() => {if (row.id === identity?.id) {close(); return;} if (changeDepartment(row.id)) close();}}><span><strong>{row.unit_name || row.name}</strong><small>{row.job_role_title || "Departamento"}</small></span>{row.id === identity?.id && <Check size={17}/>}</button>)}
                {core.assignments.length === 1 && <p>Solo tienes un departamento asignado.</p>}
            </div>}
            <button className="bold_profile_action" onClick={() => {close(); core.logout();}}><LogOut size={17}/>Cerrar sesión</button>
        </div>
    </section>, document.body);
}

