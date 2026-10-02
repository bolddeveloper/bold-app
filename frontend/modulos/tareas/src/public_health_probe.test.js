import test from "node:test";
import assert from "node:assert/strict";
import { probePublicHealth, validateProbeOrigin } from "../../../testing/public_health_probe.mjs";

test("public probe is capped at 40 anonymous GETs and never follows a redirect", async () => {
    let requests = 0;
    const report = await probePublicHealth({ fetchImpl: async (url, options) => {
        requests++;
        assert.equal(url, "https://boldapp.boldapp-93b.workers.dev/health/");
        assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
        return { ok: true, status: 200, json: async () => ({ status: "ok", checks: { database: true, redis: true } }) };
    } });
    assert.equal(requests, 40); assert.equal(report.passed, true); assert.equal(report.retries, 0);
    assert.deepEqual(report.stages.map(stage => stage.concurrency), [5, 10, 25]);
});
test("quota, network failure or unhealthy dependencies stop before the next stage", async () => {
    for (const failure of [429, 502, "network", "database"]) {
        let requests = 0;
        const report = await probePublicHealth({ fetchImpl: async () => {
            requests++;
            if (failure === "network") throw new Error("offline");
            return { status: failure === "database" ? 200 : failure, ok: failure === "database",
                json: async () => ({ status: "ok", checks: { database: false, redis: true } }) };
        } });
        assert.equal(requests, 5); assert.equal(report.passed, false); assert.equal(report.stages.length, 1);
    }
});
test("probe rejects foreign URLs, credentials and query injection before network", () => {
    for (const url of ["http://boldapp.boldapp-93b.workers.dev", "https://evil.example", "https://x:y@boldapp.boldapp-93b.workers.dev", "https://boldapp.boldapp-93b.workers.dev/?token=secret"]) {
        assert.throws(() => validateProbeOrigin(url));
    }
});
test("an invalid JSON response retains its HTTP status without leaking its contents", async () => {
    const report = await probePublicHealth({ fetchImpl: async () => ({ status: 200, ok: true,
        json: async () => { throw new SyntaxError("private response content"); } }) });
    assert.deepEqual(report.stages[0].statuses, { 200: 5 });
    assert.deepEqual(report.stages[0].errors, { SyntaxError: 5 });
    assert.equal(JSON.stringify(report).includes("private response content"), false);
});
