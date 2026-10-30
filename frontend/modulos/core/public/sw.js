const cache_name = "bold_app_shell_v4___BOLD_PWA_RELEASE__";
const shell_assets = ["/index.html", "/icon.svg", "/manifest.webmanifest", /* BUILD_ASSETS */];

function should_cache_request(request) {
    const url = new URL(request.url);
    return request.method === "GET" && url.origin === self.location.origin
        && !/^\/(api|ws|health)(\/|$)/.test(url.pathname)
        && (request.mode === "navigate" || shell_assets.includes(url.pathname)
            || ["script", "style", "image", "font"].includes(request.destination));
}

self.addEventListener("install", event => {
    // Existing clients retain their worker until they consent to reload.
    event.waitUntil(caches.open(cache_name).then(cache => cache.addAll(
        shell_assets.map(url => new Request(url, {cache: "reload"}))
    )));
});

self.addEventListener("message", event => {
    if (event.data?.type === "BOLD_SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

// Push is a private invalidation hint. Never trust provider payload text or URLs.
self.addEventListener("push", event => {
    event.waitUntil((async () => {
        try {
            const hint = event.data?.json();
            const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
            if (hint?.v !== 1 || !["device_id", "notification_id", "binding", "assignment_id"].every(key => uuid.test(hint[key]))) return;
            const url = new URL("/api/v2/notifications/push/resolve/", self.location.origin);
            for (const key of ["device_id", "notification_id", "binding"]) url.searchParams.set(key, hint[key]);
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
            let response;
            try { response = await fetch(url.href, {credentials: "include", cache: "no-store", signal: controller.signal,
                headers: {"X-Assignment-ID": hint.assignment_id}}); }
            finally {clearTimeout(timer);}
            if (!response.ok) return;
            const notice = await response.json();
            if (notice.allowed !== true) return;
            const clients = await self.clients.matchAll({type: "window", includeUncontrolled: true});
            const visible = clients.some(client => client.visibilityState === "visible" && new URL(client.url).origin === self.location.origin);
            await self.registration.showNotification(notice.actor_is_owner === true ? "BOLD · Propietario" : "BOLD", {
                body: "Tienes actividad pendiente. Abre BOLD para revisarla.", tag: `bold-${hint.notification_id}`,
                icon: "/logo-bold.svg", badge: "/icon.svg", silent: visible || notice.sound !== true,
            });
        } catch { /* Offline, revoked sessions and expired hints disclose nothing. */ }
    })());
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
        const app = windows.find(client => new URL(client.url).origin === self.location.origin);
        if (app) await app.focus();
        else await self.clients.openWindow("/");
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = (await caches.keys()).filter(key => /^(bold_tasks_shell_|bold_app_shell_)/.test(key));
        // One previous release supports other tabs' already-loaded hashed assets.
        const previous = keys.filter(key => key !== cache_name).at(-1);
        await Promise.all(keys.filter(key => key !== cache_name && key !== previous).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (!should_cache_request(request)) return;
    const navigation = request.mode === "navigate";
    event.respondWith((async () => {
        const cache = await caches.open(cache_name).catch(() => null);
        try {
            const response = await fetch(navigation ? new Request(request, {cache: "no-cache"}) : request);
            if (cache && response.ok && response.type !== "opaque") {
                const write = cache.put(navigation ? "/index.html" : request, response.clone()).catch(() => {});
                event.waitUntil(write);
            }
            return response;
        } catch {
            return await cache?.match(navigation ? "/index.html" : request)
                || (!navigation && await caches.match(request))
                || new Response("Sin conexión", {status: 504, statusText: "Offline"});
        }
    })());
});
