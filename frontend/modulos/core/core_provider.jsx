import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { http, is_using_real_backend } from "./http_client.js";
import { coreApi } from "./core_api.js";
import { normalizeAssignment, selectEntranceAssignment } from "./core_models.js";
import { getCoreState, subscribeCore, updateCore, clearCore } from "./core_store.js";
import { LoginScreen } from "./login_screen.jsx";
import { MfaManagementDialog } from "./mfa_management.jsx";
import { createPermissionCache } from "./permission_cache.js";
import { createPermissionMonitor } from "./permission_monitor.js";
import { createNotificationRealtime } from "./session_realtime.js";
import { createSessionNotifications } from "./session_notifications.js";
import { contentCanRefresh } from "./refresh_coordinator.js";
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
    const notificationController = useRef(null);
    const [notificationSnapshot, setNotificationSnapshot] = useState({ assignmentId: null, rows: [], error: "" });
    const notificationRows = useCallback(() => notificationController.current?.getRows() || [], []);
    const setNotificationRead = useCallback((id, read) => notificationController.current?.setRead(id, read) || Promise.resolve(), []);
    const clearNotifications = useCallback(() => {
        notificationController.current?.dispose(); notificationController.current = null;
        setNotificationSnapshot({ assignmentId: null, rows: [], error: "" });
    }, []);
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
    const [mfaAssuranceRevision, setMfaAssuranceRevision] = useState(0);
    const real = is_using_real_backend();
    if (!permissionCache.current) {
        permissionCache.current = createPermissionCache({
            onRevisionChange: revision => window.dispatchEvent(new CustomEvent("bold:permissions-revision", { detail: { revision } })),
            authorize: ({ assignmentId, permissionCode, unitId, resourceId }) => coreApi.authorize({
                assignment: assignmentId,
                permission_code: permissionCode,
                target_unit: unitId,
                ...(resourceId ? { resource_id: resourceId } : {}),
            }),
        });
    }
    const clearLocalSession = useCallback(() => {
        generation.current++;
        clearNotifications();
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
        setMfaAssuranceRevision(0);
        http.setSession(false);
        permissionCache.current.clear();
        sessionStorage.removeItem("bold_v2_context");
        clearCore();
        updateCore({ sessionStatus: "anonymous" });
    }, [clearNotifications]);
    const logout = useCallback(async () => {
        await coreApi.logout().catch(() => {});
        clearLocalSession();
    }, [clearLocalSession]);
    const setActiveAssignment = useCallback(id => {
        generation.current++;
        clearNotifications();
        const assignment = getCoreState().assignments.find(item => item.id === id) || null;
        http.setAssignment(assignment?.id || null);
        permissionCache.current.clear();
        updateCore({ activeAssignment: assignment, error: "", securityUncertain: false, sessionStatus: assignment ? "ready" : "selecting" });
        persistSession();
    }, [clearNotifications]);
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
        const entranceAssignment = selectEntranceAssignment(assignments, savedId, enteredFromLogin.current);
        if (assignments.length > 1 && !entranceAssignment) {
            updateCore({ activeAssignment: null, sessionStatus: "selecting", error: "" });
        } else setActiveAssignment(entranceAssignment);
        if (!assignments.length) updateCore({ error: "Tu cuenta no tiene asignaciones activas. Contacta al administrador." });
    }
    const can = useCallback(async (permissionCode, unitId = getCoreState().activeUnit?.id, resourceId) => {
        if (!real) return true;
        const assignment = getCoreState().activeAssignment?.id;
        if (!assignment) return false;
        return permissionCache.current.can({ assignmentId: assignment, permissionCode, unitId, resourceId });
    }, [real]);
    const refreshDirectory = useCallback(async () => {
        const version = generation.current;
        const directory = (await coreApi.listAssignmentDirectory()).map(normalizeAssignment);
        if (version === generation.current) updateCore({ directory });
        return directory;
    }, []);
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
        if (!real || state.sessionStatus !== "ready" || !state.activeAssignment?.id) return undefined;
        const assignmentId = state.activeAssignment.id;
        const monitor = createPermissionMonitor({ assignmentId, cache: permissionCache.current,
            fetchRevision: () => coreApi.getPermissionRevision(),
            onInvalidate: detail => {
                updateCore({ securityUncertain: Boolean(detail.uncertain), authorizationRevision: getCoreState().authorizationRevision + 1 });
                window.dispatchEvent(new CustomEvent("bold:permissions-revision", { detail }));
                if (detail.contextChanged) {
                    // Rebuild Core identity/unit projections before remounting modules.
                    generation.current++;
                    const version = generation.current;
                    permissionCache.current.setUncertain(true);
                    updateCore({ sessionStatus: "loading" });
                    restore(assignmentId).catch(error => {
                        if (version === generation.current) { clearLocalSession(); updateCore({ error: error.message }); }
                    });
                }
            },
            onUnauthorized: clearLocalSession,
        });
        const change = event => monitor.localChange(event.detail?.revision);
        const control = event => { if (import.meta.env?.VITE_PERMISSION_CONTROL_ENABLED !== "false") monitor.control(event.detail?.envelope); };
        const disconnected = event => { if (event.detail?.assignmentId === assignmentId) monitor.disconnected(); };
        const recover = () => monitor.recover();
        const visibility = () => { if (document.visibilityState !== "hidden") recover(); };
        window.addEventListener("bold:permissions-changed", change);
        window.addEventListener("bold:control-message", control);
        window.addEventListener("bold:control-disconnected", disconnected);
        window.addEventListener("focus", recover);
        window.addEventListener("online", recover);
        window.addEventListener("offline", recover);
        document.addEventListener("visibilitychange", visibility);
        return () => {
            monitor.dispose();
            window.removeEventListener("bold:permissions-changed", change);
            window.removeEventListener("bold:control-message", control);
            window.removeEventListener("bold:control-disconnected", disconnected);
            window.removeEventListener("focus", recover);
            window.removeEventListener("online", recover);
            window.removeEventListener("offline", recover);
            document.removeEventListener("visibilitychange", visibility);
        };
    }, [real, state.sessionStatus, state.activeAssignment?.id]);
    useEffect(() => {
        if (!real || state.sessionStatus !== "ready" || !state.activeAssignment?.id) return undefined;
        const assignmentId = state.activeAssignment.id;
        let mounted = true;
        const report = error => {
            if (mounted && error?.name !== "AbortError") setNotificationSnapshot(current => ({ assignmentId, rows: current.assignmentId === assignmentId ? current.rows : [], error: error?.message || String(error) }));
        };
        const store = createSessionNotifications({ onChange: rows => {
            if (mounted) setNotificationSnapshot({ assignmentId, rows, error: "" });
        } });
        notificationController.current = store;
        if (getCoreState().securityUncertain) store.invalidate({ uncertain: true }).catch(report);
        const realtime = createNotificationRealtime();
        const reconcile = reason => {
            if (contentCanRefresh()) store.refresh({ reason }).catch(report);
        };
        const recover = () => reconcile("notification-focus-or-poll");
        const invalidate = event => store.invalidate(event.detail || {}).catch(report);
        window.addEventListener("bold:permissions-revision", invalidate);
        window.addEventListener("focus", recover);
        window.addEventListener("online", recover);
        document.addEventListener("visibilitychange", recover);
        realtime.connect({ assignmentId, getTicket: coreApi.websocketTicket,
            onNotification: () => reconcile("notification-event"),
            onConnected: () => reconcile("notification-connected"),
            onReconnect: () => reconcile("notification-reconnect"),
            onControl: envelope => mounted && window.dispatchEvent(new CustomEvent("bold:control-message", { detail: { envelope } })),
            onState: status => {
                if (mounted && status !== "open") window.dispatchEvent(new CustomEvent("bold:control-disconnected", { detail: { assignmentId } }));
            },
            onTerminal: error => {
                if (mounted && [401, 403].includes(error?.status)) window.dispatchEvent(new Event("bold:unauthorized"));
            },
            onError: report,
        }).catch(report);
        store.refresh({ reason: "notification-bootstrap", immediate: true }).catch(report);
        const timer = setInterval(recover, 300_000);
        return () => {
            mounted = false; realtime.disconnect(); store.dispose(); clearInterval(timer);
            if (notificationController.current === store) notificationController.current = null;
            window.removeEventListener("bold:permissions-revision", invalidate);
            window.removeEventListener("focus", recover); window.removeEventListener("online", recover);
            document.removeEventListener("visibilitychange", recover);
        };
    }, [real, state.sessionStatus, state.activeAssignment?.id]);
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
    const openMfaManagement = useCallback(() => { setMfaDialogOpen(true); setMfaManageError(""); }, []);
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
            setMfaAssuranceRevision(current => current + 1);
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
    const notifications = { rows: notificationSnapshot.assignmentId === active && !state.securityUncertain ? notificationSnapshot.rows : [], error: notificationSnapshot.assignmentId === active ? notificationSnapshot.error : "", getRows: notificationRows, setRead: setNotificationRead };
    const value = { ...state, ...http.getSession(), notifications, sessionEntrance: enteredFromLogin.current, setActiveAssignment, refreshDirectory, logout, websocketTicket: coreApi.websocketTicket, mfa: { enabled: mfaEnabled, open: openMfaManagement, assuranceRevision: mfaAssuranceRevision }, permissions: { can } };
    return <CoreContext.Provider value={value}><>{children}<MfaManagementDialog
        open={mfaDialogOpen} enabled={mfaEnabled} busy={mfaManageBusy} error={mfaManageError} setup={mfaManageSetup} recoveryCodes={mfaManageCodes}
        onClose={closeMfaManagement} onStart={startManagedMfa} onConfirm={confirmManagedMfa} onDisable={disableManagedMfa} onTest={logout}
    /></></CoreContext.Provider>;
}
