import { http } from "../core/http_client.js";

export const suggestionsApi = {
    list: () => http.request("/api/v2/suggestions/"),
    create: body => http.request("/api/v2/suggestions/", { method: "POST", body }),
    review: (id, body) => http.request(`/api/v2/suggestions/${id}/`, { method: "PATCH", body }),
};
