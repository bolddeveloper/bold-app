import { http } from "./http_client.js";
export function createCoreApi(client = http) {
    const { request, list } = client;
    return {
        async login(username, password) {
            const result = await request("/api/v2/core/auth/token/", { method: "POST", body: { username, password }, anonymous: true });
            client.setToken(result.token, username.trim().toLowerCase());
            return result;
        },
        async getCurrentAccount() {
            const accounts = await list("core/user-accounts");
            const account = accounts.find(item => item.email.toLowerCase() === client.getSession().email);
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
        authorize: body => request("/api/v2/core/authorize/", { method: "POST", body })
    };
}
export const coreApi = createCoreApi();
