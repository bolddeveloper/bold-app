import { http } from "../core/http_client.js";

export const suggestionsApi = {
    list: (params, options) => http.listPage("suggestions", params, options),
    create: body => http.request("/api/v2/suggestions/", { method: "POST", body }),
    review: (id, body) => http.request(`/api/v2/suggestions/${id}/`, { method: "PATCH", body }),
    update: (id, body) => http.request(`/api/v2/suggestions/${id}/`, { method: "PATCH", body }),
    remove: id => http.request(`/api/v2/suggestions/${id}/`, { method: "DELETE" }),
    screenshot: (id, image, signal) => http.request(`/api/v2/suggestions/${id}/screenshots/?image=${encodeURIComponent(image)}`, { responseType: "blob", signal }),
};
