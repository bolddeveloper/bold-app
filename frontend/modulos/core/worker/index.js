const backend_paths = ["/api/", "/ws/", "/health"];


function is_backend_request(pathname) {
    return backend_paths.some((prefix) => pathname.startsWith(prefix));
}


function create_backend_request(request) {
    const public_url = new URL(request.url);
    const backend_url = new URL(`${public_url.pathname}${public_url.search}`, "http://backend");
    const proxy_request = new Request(backend_url, request);

    // Django receives the private Docker hostname for ALLOWED_HOSTS while the
    // original public origin remains available for redirects, CSRF and logs.
    proxy_request.headers.delete("host");
    proxy_request.headers.set("x-forwarded-host", public_url.host);
    proxy_request.headers.set("x-forwarded-proto", public_url.protocol.slice(0, -1));

    return proxy_request;
}


export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (!is_backend_request(url.pathname)) {
            return env.ASSETS.fetch(request);
        }

        try {
            return await env.BACKEND.fetch(create_backend_request(request));
        } catch {
            return Response.json(
                { detail: "El backend no esta disponible temporalmente." },
                { status: 502, headers: { "Cache-Control": "no-store" } },
            );
        }
    },
};
