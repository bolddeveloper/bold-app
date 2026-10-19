import {http} from "../core/http_client.js";

const root = "/api/v2/messaging/conversations/";
const identity = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) throw new Error("Identificador de conversación no válido.");
    return value;
};

// A proxy can return its private hostname in pagination. Keep only the exact
// authenticated collection path and cursor, never follow a third-party origin.
export function pagePath(collection, next) {
    if (!next) return collection;
    const url = new URL(next, "https://pagination.invalid");
    if (url.pathname !== collection || !url.searchParams.get("cursor")) throw new Error("Página de conversación no válida.");
    return `${collection}?${new URLSearchParams({cursor: url.searchParams.get("cursor")})}`;
}

export function createMessagingApi(client = http) {
    const messagesPath = conversation => `${root}${identity(conversation)}/messages/`;
    return {
        preferences: options => client.request("/api/v2/messaging/preferences/", options),
        savePreferences: (enterBehavior, options) => client.request("/api/v2/messaging/preferences/", {...options, method: "PUT", body: {enter_behavior: enterBehavior}}),
        list: (next, options) => client.request(pagePath(root, next), options),
        open: (employee, options) => client.request(root, {...options, method: "POST", body: {employee_id: identity(employee)}}),
        detail: (conversation, options) => client.request(`${root}${identity(conversation)}/`, options),
        messages: (conversation, next, options) => client.request(pagePath(messagesPath(conversation), next), options),
        send: (conversation, body, clientId, options) => client.request(messagesPath(conversation), {...options, method: "POST", body: {body, client_id: clientId}}),
        edit: (conversation, message, body, version, options) => client.request(`${messagesPath(conversation)}${identity(message)}/`, {...options, method: "PATCH", body: {body, version}}),
    };
}

export const messagingApi = createMessagingApi();
