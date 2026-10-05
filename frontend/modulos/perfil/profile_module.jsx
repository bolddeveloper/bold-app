import {useEffect, useRef, useState} from "react";
import {Bell, Pencil, Plug, User, X} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {useShell} from "../core/app_shell.jsx";
import {http} from "../core/http_client.js";
import {coreApi} from "../core/core_api.js";
import {ProfileAvatar} from "../core/shared/profile_menu.jsx";
import AvatarEditor from "../core/shared/avatar_editor.jsx";
import ColorPicker from "../core/shared/color_picker.jsx";
import GoogleConnection from "../docs/google_connection.jsx";
import "./profile.css";
import NotificationPreferences from "./notification_preferences.jsx";

export default function ProfileModule() {
    const core = useCore(), shell = useShell(), file = useRef(null);
    const [tab, setTab] = useState("account"), [profile, setProfile] = useState(null), [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [password, setPassword] = useState(false);
    const alive = useRef(true);
    const [photoFile, setPhotoFile] = useState(null);
    const editing = shell.profile_editing;
    useEffect(() => {shell.set_profile_dirty(Boolean(editing && profile && JSON.stringify(draft) !== JSON.stringify(profile))); return () => shell.set_profile_dirty(false);}, [editing, draft, profile]);
    useEffect(() => {if (editing) setTab("account");}, [editing]);
    async function load() {
        try {const value = await http.request("/api/v2/auth/profile/"); if (alive.current) {setProfile(value); setDraft(value); setError("");}}
        catch (problem) {if (alive.current) setError(problem.message);}
    }
    useEffect(() => {alive.current = true; load(); return () => {alive.current = false;};}, []);
    useEffect(() => {
        if (!editing || !profile) return;
        const warn = event => {if (JSON.stringify(draft) !== JSON.stringify(profile)) {event.preventDefault(); event.returnValue = "";}};
        window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
    }, [editing, draft, profile]);
    async function save(event) {
        event.preventDefault(); setBusy(true); setError("");
        try {const value = await http.request("/api/v2/auth/profile/", {method: "PATCH", body: {name: draft.name, avatar_url: draft.avatar_url, banner_color: draft.banner_color}}); if (!alive.current) return; setProfile(value); setDraft(value); core.updateProfile(value); shell.set_profile_editing(false); setNotice("Perfil guardado.");}
        catch (problem) {if (alive.current) setError(problem.message);}
        finally {if (alive.current) setBusy(false);}
    }
    function photo(event) {const image = event.target.files?.[0]; event.target.value = ""; if (image) setPhotoFile(image);}
    function leave() {if (shell.set_active_module("home")) shell.set_profile_editing(false);}
    function switchTab(next) {
        if (editing && JSON.stringify(draft) !== JSON.stringify(profile) && !window.confirm("\u00bfDescartar los cambios del perfil?")) return;
        setDraft(profile); shell.set_profile_editing(false); setTab(next);
    }
    const identity = core.activeAssignment, shown = editing ? draft : profile;
    return <section className="bold_profile_module">
        <header className="bold_profile_header"><h1>Perfil</h1><button aria-label="Cerrar ajustes del perfil" onClick={leave}><X size={21}/></button></header>
        <div className="bold_profile_layout">
            <aside className="bold_profile_navigation"><div className="bold_profile_identity"><ProfileAvatar url={core.account?.avatar_url} initials={identity?.initials}/><strong>{profile?.name || identity?.name}</strong></div>
                <nav aria-label="Ajustes del perfil"><button aria-current={tab === "account" ? "page" : undefined} onClick={() => setTab("account")}><User size={18}/>Cuenta</button><button aria-current={tab === "notifications" ? <NotificationPreferences/> : tab === "connectors" ? "page" : undefined} onClick={() => switchTab("connectors")}><Plug size={18}/>Conectores</button><button aria-current={tab === "notifications" ? "page" : undefined} onClick={() => switchTab("notifications")}><Bell size={18}/>Notificaciones</button></nav>
            </aside>
            <main className="bold_profile_main">{error && <div className="bold_profile_error" role="alert">{error}{!profile && <button onClick={load}>Reintentar</button>}</div>}{notice && <p role="status">{notice}</p>}
                {tab === "notifications" ? <NotificationPreferences/> : tab === "connectors" ? <><h2>Conectores</h2><p>Conexiones personales de tu cuenta BOLD.</p><GoogleConnection/></> : !profile ? <p role="status">Cargando perfil…</p> : <>
                    <div className="bold_profile_section_heading"><h2>{editing ? "Editar perfil" : "Información de cuenta"}</h2>{!editing && <button onClick={() => {setDraft(profile); shell.set_profile_editing(true); setNotice("");}}><Pencil size={16}/>Editar perfil</button>}</div>
                    <div className="bold_profile_editor">
                        <div className="bold_profile_account_fields"><dl><div><dt>Nombre</dt><dd>{profile.name}</dd></div><div><dt>Correo empresarial</dt><dd>{profile.email}</dd></div><div><dt>Departamento activo</dt><dd>{identity?.unit_name}</dd></div><div><dt>Cargo</dt><dd>{identity?.job_role_title}</dd></div></dl></div>
                        <section className="bold_profile_preview" aria-label="Tarjeta del perfil">{editing ? <ColorPicker value={draft.banner_color} label="Color del banner" onChange={color => setDraft(value => ({...value, banner_color: color}))}><span className="bold_profile_banner bold_profile_banner_edit" style={{background:draft.banner_color}}><Pencil size={22}/></span></ColorPicker> : <div className="bold_profile_banner" style={{background:profile.banner_color}}/>}
                            <form className="bold_profile_card_content" onSubmit={save}>
                                {editing ? <button className="bold_profile_photo_edit" type="button" aria-label="Cambiar foto del perfil" disabled={busy} onClick={() => file.current.click()}><ProfileAvatar url={shown?.avatar_url} initials={shown?.name?.split(/\s+/).slice(0,2).map(word => word[0]).join("")}/><span className="bold_profile_photo_overlay"><Pencil size={24}/></span></button> : <ProfileAvatar url={shown?.avatar_url} initials={shown?.name?.split(/\s+/).slice(0,2).map(word => word[0]).join("")}/>}
                                {editing ? <>
                                    <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={photo}/>
                                    <label>Nombre<input autoFocus maxLength={140} required value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></label>
                                </> : <h2>{profile.name}</h2>}
                                <p>{profile.email}</p><h3>Miembro desde</h3><p>{new Date(profile.created_at).toLocaleDateString("es", {day:"numeric", month:"short", year:"numeric"})}</p>
                                {editing && <>
                                    <p className="bold_profile_photo_help">PNG, JPG o WebP, hasta 10 MB.</p>
                                    <button type="button" disabled={busy || !draft.avatar_url} onClick={() => {setDraft({...draft, avatar_url: null});}}>Quitar foto</button>
                                    <div className="bold_profile_buttons"><button disabled={busy} className="bold_profile_primary" type="submit">{busy ? "Guardando…" : "Guardar cambios"}</button><button disabled={busy} type="button" onClick={() => {setDraft(profile); shell.set_profile_editing(false);}}>Cancelar</button></div>
                                </>}
                            </form>
                        </section>
                    </div>
                    <section className="bold_profile_security"><h2>Contraseña y seguridad</h2><div className="bold_profile_buttons"><button onClick={() => setPassword(value => !value)}>Cambiar contraseña</button><button onClick={core.mfa.open}>{core.mfa.enabled ? "Administrar MFA" : "Configurar MFA"}</button></div>
                        {password && <form onSubmit={async event => {event.preventDefault(); const data = new FormData(event.currentTarget); if (data.get("new") !== data.get("confirm")) {setError("Las contraseñas no coinciden."); return;} setBusy(true); try {await coreApi.changePassword(data.get("current"), data.get("new")); await core.logout();} catch (problem) {setError(problem.message); setBusy(false);}}}><label>Contraseña actual<input name="current" type="password" autoComplete="current-password" required/></label><label>Nueva contraseña<input name="new" type="password" autoComplete="new-password" required/></label><label>Confirmar contraseña<input name="confirm" type="password" autoComplete="new-password" required/></label><p>Al cambiar la contraseña, volverás a iniciar sesión.</p><button disabled={busy}>Guardar contraseña</button></form>}
                    </section>
                </>}
            </main>
        </div>
        {photoFile && <AvatarEditor file={photoFile} onClose={() => setPhotoFile(null)} onApply={url => {setDraft(value => ({...value, avatar_url:url}));setPhotoFile(null);}}/>}
    </section>;
}
