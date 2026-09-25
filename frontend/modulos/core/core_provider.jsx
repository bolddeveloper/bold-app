import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { http, is_using_real_backend } from "./http_client.js";
import { coreApi } from "./core_api.js";
import { normalizeAssignment, selectAssignment } from "./core_models.js";
import { getCoreState, subscribeCore, updateCore, clearCore } from "./core_store.js";
import { LoginScreen } from "./login_screen.jsx";
import { MfaManagementDialog } from "./mfa_management.jsx";
import { createPermissionCache } from "./permission_cache.js";
const CoreContext = createContext(null);
export function useCore() {
    const core = useContext(CoreContext);
    if (!core) throw new Error("useCore requiere CoreProvider.");
    return core;
}
function readSession() { try { return JSON.parse(sessionStorage.getItem("bold_v2_context")) || {}; } catch { return {}; } }
function persistSession() { sessionStorage.setItem("bold_v2_context", JSON.stringify({ assignmentId: http.getSession().assignmentId })); }
export function CoreProvider({ children, mockIdentity, loginTitle = "Bold" }) {
    const state = useSyncExternalStore(subscribeCore, getCoreState);
    const generation = useRef(0);
    const permissionCache = useRef(null);
    const enteredFromLogin = useRef(false);
    const [mfaChallenge, setMfaChallenge] = useState("");
    const [pendingEmail, setPendingEmail] = useState("");
    const [recoveryMessage, setRecoveryMessage] = useState("");
    const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
    const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);
    const [totpSetup, setTotpSetup] = useState(null);
    const [recoveryCodes, setRecoveryCodes] = useState([]);
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [mfaDialogOpen, setMfaDialogOpen] = useState(false);
    const [mfaManageSetup, setMfaManageSetup] = useState(null);
    const [mfaManageCodes, setMfaManageCodes] = useState([]);
    const [mfaManageBusy, setMfaManageBusy] = useState(false);
    const [mfaManageError, setMfaManageError] = useState("");
    const real = is_using_real_backend();
    if (!permissionCache.current) {
        permissionCache.current = createPermissionCache({
            authorize: ({ assignmentId, permissionCode, unitId, resourceId }) => coreApi.authorize({
                assignment: assignmentId,
                permission_code: permissionCode,
                target_unit: unitId,
                ...(resourceId ? { resource_id: resourceId } : {}),
            }),
        });
    }
    function clearLocalSession() {
        generation.current++;
        enteredFromLogin.current = false;
        setMfaChallenge("");
        setPasswordChangeRequired(false);
        setMfaEnrollmentRequired(false);
        setTotpSetup(null);
        setRecoveryCodes([]);
        setMfaEnabled(false);
        setMfaDialogOpen(false);
        setMfaManageSetup(null);
        setMfaManageCodes([]);
        setMfaManageBusy(false);
        setMfaManageError("");
        http.setSession(false);
        permissionCache.current.clear();
        sessionStorage.removeItem("bold_v2_context");
        clearCore();
        updateCore({ sessionStatus: "anonymous" });
    }
    async function logout() {
        await coreApi.logout().catch(() => {});
        clearLocalSession();
    }
    function setActiveAssignment(id) {
        const assignment = getCoreState().assignments.find(item => item.id === id) || null;
        http.setAssignment(assignment?.id || null);
        permissionCache.current.clear();
        updateCore({ activeAssignment: assignment, error: "", sessionStatus: assignment ? "ready" : "selecting" });
        persistSession();
    }
    async function restore(savedId) {
        const version = generation.current;
        const account = await coreApi.getCurrentAccount();
        const [employee, own, rawDirectory, units] = await Promise.all([
            coreApi.getEmployee(account.employee), coreApi.listOwnAssignments(account), coreApi.listAssignmentDirectory(), coreApi.listUnits()
        ]);
        if (version !== generation.current) return;
        const directory = rawDirectory.map(normalizeAssignment);
        const assignments = directory.filter(item => own.some(row => row.id === item.id));
        updateCore({ account, employee, directory, assignments, units });
        setActiveAssignment(selectAssignment(assignments, savedId));
        if (!assignments.length) updateCore({ error: "Tu cuenta no tiene asignaciones activas. Contacta al administrador." });
    }
    async function can(permissionCode, unitId = getCoreState().activeUnit?.id, resourceId) {
        if (!real) return true;
        const assignment = getCoreState().activeAssignment?.id;
        if (!assignment) return false;
        return permissionCache.current.can({ assignmentId: assignment, permissionCode, unitId, resourceId });
    }
    async function refreshDirectory() {
        const directory = (await coreApi.listAssignmentDirectory()).map(normalizeAssignment);
        updateCore({ directory });
        return directory;
    }
    useEffect(() => {
        if (!real) { updateCore({ ...mockIdentity, sessionStatus: "ready" }); return () => clearCore(); }
        let mounted = true;
        clearCore(); updateCore({ sessionStatus: "loading" });
        window.addEventListener("bold:unauthorized", clearLocalSession);
        const saved = readSession();
        coreApi.restoreSession().then(result => {
            setMfaEnabled(Boolean(result.mfa_enabled));
            if (result.authenticated && result.password_change_required) {
                setPasswordChangeRequired(true);
                updateCore({ sessionStatus: "anonymous" });
                return;
            }
            if (result.authenticated && result.mfa_enrollment_required) {
                setMfaEnrollmentRequired(true);
                updateCore({ sessionStatus: "anonymous" });
                return;
            }
            if (result.authenticated) return restore(saved.assignmentId);
            updateCore({ sessionStatus: "anonymous" });
        }).catch(error => {
                if (mounted && error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" });
        });
        return () => { mounted = false; generation.current++; http.setSession(false); clearCore(); permissionCache.current.clear(); window.removeEventListener("bold:unauthorized", clearLocalSession); };
    }, []);
    useEffect(() => {
        if (!real || state.sessionStatus !== "ready") return undefined;
        let active = true;
        const refreshRevision = () => coreApi.getPermissionRevision()
            .then(result => {
                if (active && permissionCache.current.setRevision(result.revision)) {
                    window.dispatchEvent(new CustomEvent("bold:permissions-revision", { detail: { revision: result.revision } }));
                }
            })
            .catch(() => {});
        const handlePermissionChange = event => {
            const revision = event.detail?.revision;
            if (revision === undefined) permissionCache.current.invalidate();
            else permissionCache.current.setRevision(revision);
            window.dispatchEvent(new CustomEvent("bold:permissions-revision", { detail: { revision } }));
        };
        window.addEventListener("bold:permissions-changed", handlePermissionChange);
        refreshRevision();
        const interval = window.setInterval(refreshRevision, 5_000);
        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener("bold:permissions-changed", handlePermissionChange);
        };
    }, [real, state.sessionStatus]);
    async function login(event) {
        event.preventDefault(); updateCore({ sessionStatus: "loading", error: "" });
        const form = new FormData(event.currentTarget);
        try {
            const result = await coreApi.login(form.get("email"), form.get("password"));
            if (result.mfa_required) { setPendingEmail(form.get("email")); setMfaChallenge(result.challenge); updateCore({ sessionStatus: "anonymous" }); return; }
            if (result.password_change_required) { setPasswordChangeRequired(true); updateCore({ sessionStatus: "anonymous" }); return; }
            if (result.mfa_enrollment_required) { setMfaEnrollmentRequired(true); updateCore({ sessionStatus: "anonymous" }); return; }
            enteredFromLogin.current = true; await restore();
        }
        catch (error) { enteredFromLogin.current = false; if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    async function verifyMfa(event) {
        event.preventDefault(); updateCore({ sessionStatus: "loading", error: "" });
        try {
            const result = await coreApi.verifyMfa(mfaChallenge, new FormData(event.currentTarget).get("code"), pendingEmail);
            setMfaChallenge("");
            setMfaEnabled(true);
            if (result.password_change_required) { setPasswordChangeRequired(true); updateCore({ sessionStatus: "anonymous" }); return; }
            enteredFromLogin.current = true; await restore();
        }
        catch (error) { if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    async function requestRecovery(event) {
        event.preventDefault(); setRecoveryMessage("");
        try { const result = await coreApi.requestPasswordReset(new FormData(event.currentTarget).get("email")); setRecoveryMessage(result.detail); }
        catch (error) { setRecoveryMessage(error.message); }
    }
    async function confirmRecovery(event, token) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement), password = form.get("password");
        if (password !== form.get("password_confirm")) { updateCore({ error: "Las contraseñas no coinciden." }); return false; }
        try { const result = await coreApi.confirmPasswordReset(token, password); formElement.reset(); history.replaceState({}, "", location.pathname); setRecoveryMessage(result.detail); updateCore({ error: "" }); return true; }
        catch (error) { updateCore({ error: error.message }); return false; }
    }
    async function confirmInvitation(event, token) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement), password = form.get("password");
        if (password !== form.get("password_confirm")) { updateCore({ error: "Las contraseñas no coinciden." }); return false; }
        try { const result = await coreApi.confirmInvitation(token, password); formElement.reset(); history.replaceState({}, "", location.pathname); setRecoveryMessage(result.detail); updateCore({ error: "" }); return true; }
        catch (error) { updateCore({ error: error.message }); return false; }
    }
    async function changeRequiredPassword(event) {
        event.preventDefault();
        const form = new FormData(event.currentTarget), password = form.get("password");
        if (password !== form.get("password_confirm")) { updateCore({ error: "Las contraseñas no coinciden." }); return; }
        updateCore({ sessionStatus: "loading", error: "" });
        try {
            const result = await coreApi.changePassword(form.get("current_password"), password);
            clearLocalSession();
            setRecoveryMessage(result.detail);
        } catch (error) {
            if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" });
        }
    }
    async function startMfaEnrollment(event) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        updateCore({ sessionStatus: "loading", error: "" });
        try { setTotpSetup(await coreApi.setupTotp("Aplicación autenticadora", form.get("current_password"))); formElement.reset(); updateCore({ sessionStatus: "anonymous" }); }
        catch (error) { if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    async function confirmMfaEnrollment(event) {
        event.preventDefault(); updateCore({ sessionStatus: "loading", error: "" });
        try {
            const form = new FormData(event.currentTarget);
            const result = await coreApi.confirmTotp(totpSetup.method_id, form.get("code"), form.get("current_password"));
            setMfaEnabled(true);
            setRecoveryCodes(result.recovery_codes);
            updateCore({ sessionStatus: "anonymous" });
        } catch (error) { if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    async function finishMfaEnrollment() {
        setMfaEnrollmentRequired(false); setTotpSetup(null); setRecoveryCodes([]);
        enteredFromLogin.current = true;
        updateCore({ sessionStatus: "loading", error: "" });
        try { await restore(); } catch (error) { if (error.name !== "AbortError") updateCore({ error: error.message, sessionStatus: "anonymous" }); }
    }
    function openMfaManagement() { setMfaDialogOpen(true); setMfaManageError(""); }
    function closeMfaManagement() {
        if (mfaManageBusy) return;
        setMfaDialogOpen(false); setMfaManageSetup(null); setMfaManageCodes([]); setMfaManageError("");
    }
    async function startManagedMfa(event) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setMfaManageBusy(true); setMfaManageError("");
        try { setMfaManageSetup(await coreApi.setupTotp("Aplicación autenticadora", form.get("current_password"))); formElement.reset(); }
        catch (error) { setMfaManageError(error.message); }
        finally { setMfaManageBusy(false); }
    }
    async function confirmManagedMfa(event) {
        event.preventDefault(); setMfaManageBusy(true); setMfaManageError("");
        try {
            const form = new FormData(event.currentTarget);
            const result = await coreApi.confirmTotp(mfaManageSetup.method_id, form.get("code"), form.get("current_password"));
            setMfaEnabled(true); setMfaManageSetup(null); setMfaManageCodes(result.recovery_codes);
        } catch (error) { setMfaManageError(error.message); }
        finally { setMfaManageBusy(false); }
    }
    async function disableManagedMfa(event) {
        event.preventDefault(); setMfaManageBusy(true); setMfaManageError("");
        const form = new FormData(event.currentTarget);
        try {
            const result = await coreApi.disableMfa(form.get("current_password"), form.get("code"));
            clearLocalSession(); setRecoveryMessage(result.detail);
        } catch (error) { setMfaManageError(error.message); setMfaManageBusy(false); }
    }
    const { account, assignments, error } = state;
    const active = state.activeAssignment?.id || "", busy = state.sessionStatus === "loading";
    if (real && (!account || !active)) return <LoginScreen
        title={loginTitle} error={error} busy={busy} account={account} assignments={assignments}
        active={active} mfaChallenge={mfaChallenge} recoveryMessage={recoveryMessage}
        passwordChangeRequired={passwordChangeRequired} mfaEnrollmentRequired={mfaEnrollmentRequired} totpSetup={totpSetup} recoveryCodes={recoveryCodes}
        onLogin={login} onMfa={verifyMfa} onRecovery={requestRecovery} onRecoveryConfirm={confirmRecovery} onInvitationConfirm={confirmInvitation} onPasswordChange={changeRequiredPassword}
        onStartMfaEnrollment={startMfaEnrollment} onConfirmMfaEnrollment={confirmMfaEnrollment} onFinishMfaEnrollment={finishMfaEnrollment}
        onAssignmentChange={setActiveAssignment} onLogout={logout}
    />;
    if (state.sessionStatus !== "ready") return null;
    const value = { ...state, ...http.getSession(), sessionEntrance: enteredFromLogin.current, setActiveAssignment, refreshDirectory, logout, websocketTicket: coreApi.websocketTicket, mfa: { enabled: mfaEnabled, open: openMfaManagement }, permissions: { can } };
    return <CoreContext.Provider value={value}><>{children}<MfaManagementDialog
        open={mfaDialogOpen} enabled={mfaEnabled} busy={mfaManageBusy} error={mfaManageError} setup={mfaManageSetup} recoveryCodes={mfaManageCodes}
        onClose={closeMfaManagement} onStart={startManagedMfa} onConfirm={confirmManagedMfa} onDisable={disableManagedMfa} onTest={logout}
    /></></CoreContext.Provider>;
}
