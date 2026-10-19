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
