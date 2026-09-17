export function MfaManagementDialog({ open, enabled, busy, error, setup, recoveryCodes, onClose, onStart, onConfirm, onDisable, onTest }) {
    if (!open) return null;
    return <div className="core_mfa_backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <section className="core_mfa_dialog" role="dialog" aria-modal="true" aria-labelledby="core_mfa_title">
            <header className="core_mfa_header">
                <div><span>SEGURIDAD</span><h2 id="core_mfa_title">Autenticación de dos factores</h2></div>
                <button type="button" aria-label="Cerrar configuración MFA" onClick={onClose} disabled={busy}>×</button>
            </header>
            {error && <p className="core_mfa_error" role="alert">{error}</p>}
            {recoveryCodes.length ? <div className="core_mfa_content">
                <p>Guarda estos códigos en un lugar seguro. No volverán a mostrarse y cada uno funciona una sola vez.</p>
                <ul className="core_mfa_codes">{recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
                <button className="core_mfa_primary" type="button" onClick={onClose}>Ya guardé mis códigos</button>
            </div> : !enabled ? <div className="core_mfa_content">
                {!setup ? <>
                    <p>Genera una clave y agrégala manualmente a Google Authenticator, Microsoft Authenticator u otra aplicación TOTP.</p>
                    <button className="core_mfa_primary" type="button" onClick={onStart} disabled={busy}>{busy ? "Preparando…" : "Configurar MFA"}</button>
                </> : <form className="core_mfa_form" onSubmit={onConfirm}>
                    <p>Agrega esta clave a tu aplicación autenticadora:</p>
                    <code className="core_mfa_secret">{setup.secret}</code>
                    <label htmlFor="core_mfa_setup_code">Código de seis dígitos</label>
                    <input id="core_mfa_setup_code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required autoFocus disabled={busy} />
                    <button className="core_mfa_primary" type="submit" disabled={busy}>{busy ? "Verificando…" : "Activar MFA"}</button>
                </form>}
            </div> : <div className="core_mfa_content">
                <p>MFA está activo. Puedes cerrar sesión para comprobar el segundo paso o desactivarlo para repetir el enrolamiento.</p>
                <button className="core_mfa_secondary" type="button" onClick={onTest} disabled={busy}>Cerrar sesión y probar MFA</button>
                <form className="core_mfa_form core_mfa_danger" onSubmit={onDisable}>
                    <h3>Desactivar MFA</h3>
                    <p>Esta acción cerrará todas tus sesiones y eliminará los códigos de recuperación pendientes.</p>
                    <label htmlFor="core_mfa_password">Contraseña actual</label>
                    <input id="core_mfa_password" name="current_password" type="password" autoComplete="current-password" required disabled={busy} />
                    <label htmlFor="core_mfa_disable_code">Código MFA o de recuperación</label>
                    <input id="core_mfa_disable_code" name="code" inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" minLength="6" maxLength="10" required disabled={busy} />
                    <button className="core_mfa_danger_button" type="submit" disabled={busy}>{busy ? "Desactivando…" : "Desactivar MFA"}</button>
                </form>
            </div>}
        </section>
    </div>;
}
