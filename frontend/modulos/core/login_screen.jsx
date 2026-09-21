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

export function LoginScreen({ title, error, busy, account, assignments, active, mfaChallenge, recoveryMessage, passwordChangeRequired, mfaEnrollmentRequired, totpSetup, recoveryCodes, onLogin, onMfa, onRecovery, onRecoveryConfirm, onInvitationConfirm, onPasswordChange, onStartMfaEnrollment, onConfirmMfaEnrollment, onFinishMfaEnrollment, onAssignmentChange, onLogout }) {
    const [dark, setDark] = useState(readTheme);
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(() => Boolean(readEmail()));
    const [recoveryHelp, setRecoveryHelp] = useState(false);
    const [savedEmail] = useState(readEmail);
    const [resetToken, setResetToken] = useState(() => new URLSearchParams(location.search).get("reset_token") || "");
    const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(location.search).get("invitation_token") || "");
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
                    <h2 id="core_auth_heading">{account ? "Selecciona tu cargo" : passwordChangeRequired ? "Cambia tu contraseña" : mfaEnrollmentRequired ? "Protege tu cuenta" : invitationToken ? "Activa tu cuenta" : resetToken ? "Crea una contraseña nueva" : mfaChallenge ? "Verificación en dos pasos" : recoveryHelp ? "Recupera tu cuenta" : "Bienvenido de nuevo"}</h2>
                    <p className="core_auth_subtitle">{account ? "Elige la asignación con la que quieres continuar." : passwordChangeRequired ? "Debes reemplazar la contraseña temporal antes de continuar." : mfaEnrollmentRequired ? "Configura una aplicación autenticadora para completar el acceso." : invitationToken ? "Define tu contraseña para aceptar la invitación corporativa." : resetToken ? "El enlace se puede utilizar una sola vez." : mfaChallenge ? "Ingresa el código de tu aplicación autenticadora." : recoveryHelp ? "Enviaremos un enlace de un solo uso si la cuenta existe." : "Ingresa a tu cuenta para continuar."}</p>
                    {error && <p className="core_auth_error" role="alert">{error}</p>}
                    {recoveryMessage && !recoveryHelp && <p role="status">{recoveryMessage}</p>}
                    {!account && passwordChangeRequired ? <form key="required-password" className="core_auth_form" onSubmit={onPasswordChange}>
                        <label htmlFor="core_auth_current_password">Contraseña temporal</label>
                        <input id="core_auth_current_password" name="current_password" type="password" autoComplete="current-password" required disabled={busy} />
                        <label htmlFor="core_auth_required_password">Contraseña nueva</label>
                        <input id="core_auth_required_password" name="password" type="password" autoComplete="new-password" required minLength="8" disabled={busy} />
                        <label htmlFor="core_auth_required_password_confirm">Confirmar contraseña</label>
                        <input id="core_auth_required_password_confirm" name="password_confirm" type="password" autoComplete="new-password" required minLength="8" disabled={busy} />
                        <button className="core_auth_submit" type="submit" disabled={busy}>{busy ? "Guardando…" : "Cambiar contraseña"}</button>
                    </form> : !account && mfaEnrollmentRequired ? <div className="core_auth_form">
                        {recoveryCodes.length ? <>
                            <p>Guarda estos códigos en un lugar seguro. Cada uno funciona una sola vez.</p>
                            <ul>{recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
                            <button className="core_auth_submit" type="button" onClick={onFinishMfaEnrollment}>Ya guardé mis códigos</button>
                        </> : totpSetup ? <form key="required-mfa" className="core_auth_form" onSubmit={onConfirmMfaEnrollment}>
                            <p>Agrega esta clave manualmente en tu aplicación autenticadora:</p>
                            <code>{totpSetup.secret}</code>
                            <label htmlFor="core_auth_enrollment_code">Código de verificación</label>
                            <input id="core_auth_enrollment_code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required autoFocus disabled={busy} />
                            <label htmlFor="core_auth_enrollment_confirm_password">Contraseña actual</label>
                            <input id="core_auth_enrollment_confirm_password" name="current_password" type="password" autoComplete="current-password" required disabled={busy} />
                            <button className="core_auth_submit" type="submit" disabled={busy}>{busy ? "Verificando…" : "Activar MFA"}</button>
                        </form> : <form key="start-required-mfa" className="core_auth_form" onSubmit={onStartMfaEnrollment}>
                            <p>Confirma tu identidad antes de generar una nueva clave MFA.</p>
                            <label htmlFor="core_auth_enrollment_password">Contraseña actual</label>
                            <input id="core_auth_enrollment_password" name="current_password" type="password" autoComplete="current-password" required disabled={busy} />
                            <button className="core_auth_submit" type="submit" disabled={busy}>{busy ? "Preparando…" : "Configurar autenticador"}</button>
                        </form>}
                    </div> : !account && (resetToken || invitationToken) ? <form key={invitationToken ? "account-invitation" : "password-reset"} className="core_auth_form" onSubmit={async event => { const completed = invitationToken ? await onInvitationConfirm(event, invitationToken) : await onRecoveryConfirm(event, resetToken); if (completed) { setResetToken(""); setInvitationToken(""); } }}>
                        <label htmlFor="core_auth_new_password">Contraseña nueva</label>
                        <input id="core_auth_new_password" name="password" type="password" autoComplete="new-password" required minLength="8" />
                        <label htmlFor="core_auth_new_password_confirm">Confirmar contraseña</label>
                        <input id="core_auth_new_password_confirm" name="password_confirm" type="password" autoComplete="new-password" required minLength="8" />
                        <button className="core_auth_submit" type="submit">Guardar contraseña</button>
                    </form> : !account && mfaChallenge ? <form key="mfa-login" className="core_auth_form" onSubmit={onMfa}>
                        <label htmlFor="core_auth_mfa">Código de autenticación o recuperación</label>
                        <input id="core_auth_mfa" name="code" inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" minLength="6" maxLength="10" required autoFocus disabled={busy} />
                        <button className="core_auth_submit" type="submit" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
                    </form> : !account && recoveryHelp ? <form key="password-recovery" className="core_auth_form" onSubmit={onRecovery}>
                        <label htmlFor="core_auth_recovery_email">Correo corporativo</label>
                        <input id="core_auth_recovery_email" name="email" type="email" defaultValue={savedEmail} placeholder="nombre@bold.gt" required disabled={busy} />
                        <button className="core_auth_submit" type="submit" disabled={busy}>Enviar instrucciones</button>
                        {recoveryMessage && <span role="status">{recoveryMessage}</span>}
                        <button type="button" className="core_auth_text_button" onClick={() => setRecoveryHelp(false)}>Volver al inicio de sesión</button>
                    </form> : !account ? <form key="login" className="core_auth_form" onSubmit={handleSubmit}>
                        <label htmlFor="core_auth_email">Correo electrónico</label>
                        <input id="core_auth_email" name="email" type="email" autoComplete="username" placeholder="nombre@bold.gt" defaultValue={savedEmail} required disabled={busy} />
                        <label htmlFor="core_auth_password">Contraseña</label>
                        <div className="core_auth_password_field">
                            <input id="core_auth_password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Ingresa tu contraseña" required disabled={busy} />
                            <button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                        </div>
                        <div className="core_auth_options">
                            <label className="core_auth_remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Recordar correo</label>
                            <button type="button" className="core_auth_text_button" aria-expanded={recoveryHelp} onClick={() => setRecoveryHelp(true)}>¿Olvidaste tu contraseña?</button>
                        </div>
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
