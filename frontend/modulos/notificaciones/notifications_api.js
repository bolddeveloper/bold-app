import { http } from "../core/http_client.js";


export function createNotificationsApi(client = http) {
    return {
        list: () => client.list("notifications"),
        markRead: id => client.request(`/api/v2/notifications/${id}/mark-read/`, { method: "POST" }),
        markUnread: id => client.request(`/api/v2/notifications/${id}/mark-unread/`, { method: "POST" }),
        markAllRead: () => client.request("/api/v2/notifications/mark-all-read/", { method: "POST" }),
        unreadCount: () => client.request("/api/v2/notifications/unread-count/"),
    };
}

export const notificationsApi = createNotificationsApi();
