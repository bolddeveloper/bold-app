import { http } from "./http_client.js";
export function createCoreApi(client = http) {
    const { request, list } = client;
    return {
        async login(username, password) {
            await request("/api/v2/auth/session/", { anonymous: true });
            const result = await request("/api/v2/auth/login/", { method: "POST", body: { email: username, password }, anonymous: true });
            if (!result.mfa_required) client.setSession(true, username.trim().toLowerCase());
            return result;
        },
        async verifyMfa(challenge, code, email) {
            const result = await request("/api/v2/auth/mfa/verify/", { method: "POST", body: { challenge, code }, anonymous: true });
            client.setSession(true, email.trim().toLowerCase());
            return result;
        },
        async restoreSession() {
            const result = await request("/api/v2/auth/session/", { anonymous: true });
            client.setSession(result.authenticated, result.account?.email || null);
            return result;
        },
        async logout() {
            try { await request("/api/v2/auth/logout/", { method: "POST" }); } finally { client.setSession(false); }
        },
        changePassword: (currentPassword, password) => request("/api/v2/auth/password/change/", { method: "POST", body: { current_password: currentPassword, password } }),
        setupTotp: (label, currentPassword) => request("/api/v2/auth/mfa/totp/setup/", { method: "POST", body: { label, current_password: currentPassword } }),
        confirmTotp: (methodId, code, currentPassword) => request("/api/v2/auth/mfa/totp/confirm/", { method: "POST", body: { method_id: methodId, code, current_password: currentPassword } }),
        stepUpMfa: code => request("/api/v2/auth/mfa/step-up/", { method: "POST", body: { code } }),
        disableMfa: (currentPassword, code) => request("/api/v2/auth/mfa/disable/", { method: "POST", body: { current_password: currentPassword, code } }),
        websocketTicket: body => request("/api/v2/auth/websocket-ticket/", { method: "POST", body }),
        requestPasswordReset: email => request("/api/v2/auth/password/reset/request/", { method: "POST", body: { email }, anonymous: true }),
        confirmPasswordReset: (token, password) => request("/api/v2/auth/password/reset/confirm/", { method: "POST", body: { token, password }, anonymous: true }),
        confirmInvitation: (token, password) => request("/api/v2/auth/invitation/confirm/", { method: "POST", body: { token, password }, anonymous: true }),
        async getCurrentAccount() {
            const accounts = await list("core/user-accounts");
            const account = accounts.find(item => item.email.toLowerCase() === client.getSession().email?.toLowerCase());
            if (!account) throw new Error("No se pudo identificar la cuenta autenticada.");
            return account;
        },
        async listOwnAssignments(account) {
            const own = account || await this.getCurrentAccount();
            if (!own.employee) return [];
            return (await list("core/position-assignments", { employee: own.employee })).filter(item => item.employee === own.employee && item.is_active && !item.released_at);
        },
        listAssignmentDirectory: () => list("core/position-assignments/directory"),
        getEmployee: id => id ? request(`/api/v2/core/employees/${id}/`) : Promise.resolve(null),
        listUnits: () => list("core/organizational-units"),
        authorize: body => request("/api/v2/core/authorize/", { method: "POST", body }),
        getPermissionRevision: () => request("/api/v2/permissions/revision/")
    };
}
export const coreApi = createCoreApi();
