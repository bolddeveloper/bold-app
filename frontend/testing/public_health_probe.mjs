// Deliberately not a user/load test. At most 40 anonymous read-only requests.
export const PROBE_ORIGIN = "https://boldapp.boldapp-93b.workers.dev";
export const PROBE_STAGES = [5, 10, 25];
export function validateProbeOrigin(value) {
    const url = new URL(value);
    if (url.origin !== PROBE_ORIGIN || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("La sonda solo admite el origen público de Bold, sin credenciales ni parámetros.");
    }
    return url.origin;
}
export async function probePublicHealth({ origin = PROBE_ORIGIN, fetchImpl = fetch, now = () => performance.now() } = {}) {
    origin = validateProbeOrigin(origin);
    let requestsStarted = 0;
    const stages = [];
    const quantile = (values, percentile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
    for (const concurrency of PROBE_STAGES) {
        const results = await Promise.all(Array.from({ length: concurrency }, async () => {
            if (requestsStarted >= 40) throw new Error("Presupuesto de sonda agotado.");
            requestsStarted++;
            const started = now();
            let status = 0;
            try {
                const response = await fetchImpl(`${origin}/health/`, {
                    method: "GET", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
                    headers: { "Accept": "application/json" },
                });
                status = response.status;
                // Status/booleans only; never record headers, credentials or response bodies.
                const body = response.ok ? await response.json() : null;
                const healthy = response.ok && body?.status === "ok" && body?.checks?.database === true && body?.checks?.redis === true;
                return { status: response.status, healthy, durationMs: Math.max(0, now() - started) };
            } catch (error) {
                const safeCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);
                const errorCode = safeCodes.has(error?.cause?.code) ? error.cause.code
                    : ["TimeoutError", "AbortError", "SyntaxError", "TypeError"].includes(error?.name) ? error.name : "unexpected-error";
                return { status, errorCode, healthy: false, durationMs: Math.max(0, now() - started) };
            }
        }));
        const durations = results.map(result => result.durationMs);
        const statuses = {};
        const errors = {};
        results.forEach(result => { statuses[result.status] = (statuses[result.status] || 0) + 1; });
        results.forEach(result => { if (result.errorCode) errors[result.errorCode] = (errors[result.errorCode] || 0) + 1; });
        stages.push({ concurrency, requests: results.length, healthy: results.filter(result => result.healthy).length,
            statuses, errors, p50Ms: Math.round(quantile(durations, 0.5)), p95Ms: Math.round(quantile(durations, 0.95)) });
        if (results.some(result => !result.healthy)) break; // no next stage or retry on 429/1027/network/DB error
    }
    return { scope: "public-health-proxy-only-not-authenticated-user-capacity", checkedAt: new Date().toISOString(),
        origin, requestBudget: 40, requestsStarted, retries: 0, stages,
        passed: stages.length === PROBE_STAGES.length && stages.every(stage => stage.healthy === stage.requests) };
}
