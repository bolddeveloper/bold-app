const cache_name = "bold_tasks_shell_v1";


// Lists the static assets that make the empty application shell available offline.
const shell_assets = [
    "/",
    "/index.html",
    "/icon.svg",
    "/manifest.webmanifest"
];


// Checks whether a request belongs to the PWA origin and can be cached safely.
function should_cache_request(request) {
    const request_url = new URL(request.url);

    return request_url.origin === self.location.origin;
}


// Stores successful same-origin responses for offline fallback.
function cache_response(request, response) {
    if (!should_cache_request(request) || !response || !response.ok) {
        return response;
    }

    const response_clone = response.clone();

    caches.open(cache_name).then((cache_store) => {
        cache_store.put(request, response_clone);
    });

    return response;
}


// Returns a cached response or the application shell when the network is unavailable.
function resolve_offline_response(request) {
    return caches.match(request).then((cached_response) => {
        if (cached_response) {
            return cached_response;
        }

        if (request.mode === "navigate") {
            return caches.match("/index.html");
        }

        return new Response("", {
            status: 504,
            statusText: "Offline"
        });
    });
}


// Installs the first offline shell cache for the PWA.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(cache_name).then((cache_store) => {
            return cache_store.addAll(shell_assets);
        })
    );
});


// Removes older shell caches after the service worker activates.
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cache_keys) => {
            return Promise.all(
                cache_keys
                    .filter((cache_key) => cache_key !== cache_name)
                    .map((cache_key) => caches.delete(cache_key))
            );
        })
    );
});


// Serves fresh files first and falls back to cached assets for offline use.
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => cache_response(event.request, response))
            .catch(() => resolve_offline_response(event.request))
    );
});
