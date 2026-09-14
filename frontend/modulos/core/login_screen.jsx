import { useEffect, useState } from "react";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";

const themeKey = "bold_color_theme";
const emailKey = "bold_remembered_email";
function readTheme() {
    try {
        const saved = localStorage.getItem(themeKey);
        return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch { return false; }
}
function readEmail() { try { return localStorage.getItem(emailKey) || ""; } catch { return ""; } }

export function LoginScreen({ title, error, busy, account, assignments, active, onLogin, onAssignmentChange, onLogout }) {
    const [dark, setDark] = useState(readTheme);
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(() => Boolean(readEmail()));
    const [recoveryHelp, setRecoveryHelp] = useState(false);
    const [savedEmail] = useState(readEmail);
    useEffect(() => {
        try { localStorage.setItem(themeKey, dark ? "dark" : "light"); } catch {}
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
        document.documentElement.dataset.boldTheme = dark ? "dark" : "light";
        document.documentElement.classList.toggle("theme_dark", dark);
    }, [dark]);
    function handleSubmit(event) {
        const email = new FormData(event.currentTarget).get("email");
        try {
            if (remember) localStorage.setItem(emailKey, email);
            else localStorage.removeItem(emailKey);
        } catch {}
        onLogin(event);
    }
    return <main className={`core_auth_page ${dark ? "theme_dark" : ""}`}>
        <div className="core_auth_layout">
            <section className="core_auth_brand" aria-label="Bold">
                <div className="core_auth_logo">bold<span aria-hidden="true">.</span></div>
                <div className="core_auth_brand_message">
                    <span className="core_auth_eyebrow">TU ESPACIO DE TRABAJO</span>
                    <h1>Todo tu trabajo, en un solo lugar.</h1>
                    <p>Organiza lo que importa y mantén a tu equipo en movimiento.</p>
                </div>
                <span className="core_auth_brand_footer">{title}</span>
            </section>
            <section className="core_auth_content" aria-labelledby="core_auth_heading">
                <button className="core_auth_theme" type="button" aria-label={dark ? "Activar modo claro" : "Activar modo oscuro"} onClick={() => setDark(!dark)}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
                <div className="core_auth_form_wrap">
                    <div className="core_auth_mobile_logo" aria-hidden="true">bold<span>.</span></div>
                    <p className="core_auth_section">{title}</p>
                    <h2 id="core_auth_heading">{account ? "Selecciona tu cargo" : "Bienvenido de nuevo"}</h2>
                    <p className="core_auth_subtitle">{account ? "Elige la asignación con la que quieres continuar." : "Ingresa a tu cuenta para continuar."}</p>
                    {error && <p className="core_auth_error" role="alert">{error}</p>}
                    {!account ? <form className="core_auth_form" onSubmit={handleSubmit}>
                        <label htmlFor="core_auth_email">Correo electrónico</label>
                        <input id="core_auth_email" name="email" type="email" autoComplete="username" placeholder="nombre@empresa.com" defaultValue={savedEmail} required disabled={busy} />
                        <label htmlFor="core_auth_password">Contraseña</label>
                        <div className="core_auth_password_field">
                            <input id="core_auth_password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Ingresa tu contraseña" required disabled={busy} />
                            <button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                        </div>
                        <div className="core_auth_options">
                            <label className="core_auth_remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Recordar correo</label>
                            <button type="button" className="core_auth_text_button" aria-expanded={recoveryHelp} onClick={() => setRecoveryHelp(!recoveryHelp)}>¿Olvidaste tu contraseña?</button>
                        </div>
                        {recoveryHelp && <p className="core_auth_recovery">Solicita a un administrador que restablezca tu contraseña. Esta instalación no dispone de recuperación automática.</p>}
                        <button className="core_auth_submit" type="submit" disabled={busy}>{busy ? <><span className="core_auth_spinner" aria-hidden="true" /> Iniciando sesión…</> : "Iniciar sesión"}</button>
                    </form> : <div className="core_auth_form">
                        <label htmlFor="core_auth_assignment">Cargo activo</label>
                        <select id="core_auth_assignment" value={active} onChange={event => onAssignmentChange(event.target.value)}><option value="">Seleccionar asignación</option>{assignments.map(item => <option key={item.id} value={item.id}>{item.job_role_title} · {item.unit_name}</option>)}</select>
                        <button type="button" className="core_auth_text_button" onClick={onLogout}>Cerrar sesión</button>
                    </div>}
                </div>
                <p className="core_auth_copyright">© {new Date().getFullYear()} BOLD</p>
            </section>
        </div>
    </main>;
}
