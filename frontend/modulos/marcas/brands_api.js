import {http} from "../core/http_client.js";
export const brandsApi = {
    list: options => http.listPage("brands", options),
    get: id => http.request(`/api/v2/brands/${id}/`),
    save: (draft, id) => id ? http.update("brands", id, draft) : http.create("brands", draft),
    share: (brand, member_ids) => http.request(`/api/v2/brands/${brand.id}/members/`, {method: "PUT", body: {revision: brand.revision, member_ids}}),
    archive: brand => http.request(`/api/v2/brands/${brand.id}/?revision=${brand.revision}`, {method: "DELETE"}),
};
