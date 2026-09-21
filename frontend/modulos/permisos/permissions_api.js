import { http } from "../core/http_client.js";

export const permissionsApi = {
    access: () => http.request("/api/v2/permissions/access/"),
    revision: () => http.request("/api/v2/permissions/revision/"),
    catalog: () => http.request("/api/v2/permissions/catalog/"),
    rolePolicies: () => http.request("/api/v2/permissions/role-policies/"),
    replaceRolePolicy: body => http.request("/api/v2/permissions/role-policies/", { method: "POST", body }),
    grants: () => http.request("/api/v2/permissions/access-rules/"),
    createGrant: body => http.request("/api/v2/permissions/access-rules/", { method: "POST", body }),
    revokeGrant: (id, body) => http.request(`/api/v2/permissions/access-rules/${id}/revoke/`, { method: "POST", body }),
    authorities: () => http.request("/api/v2/permissions/authorities/"),
    createAuthority: body => http.request("/api/v2/permissions/authorities/", { method: "POST", body }),
    revokeAuthority: (id, body) => http.request(`/api/v2/permissions/authorities/${id}/revoke/`, { method: "POST", body }),
    effective: unit => http.request(`/api/v2/permissions/effective/?${new URLSearchParams({ unit })}`),
    audit: params => http.request(`/api/v2/permissions/audit/?${new URLSearchParams(params || {})}`),
};

