import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../../tests/test_client.js";
import { ApiError } from "../../../core/http_client.js";

test("network failures show a Spanish connection error without expiring the session", async () => {
    let expired = false;
    const api = createApiClient({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); }, onUnauthorized: () => { expired = true; } });
    await assert.rejects(api.login("ana@example.com", "test"), error => error.status === 0 && error.message.includes("No se pudo conectar"));
    assert.equal(expired, false);
});

test("V2 serializes JSON, merges headers and follows every page through the local proxy", async () => {
    const calls = [];
    const api = createApiClient({ baseUrl: "http://localhost:5173", fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(calls.length === 1 ? { count: 2, next: "http://127.0.0.1:8000/api/v2/tasks/?page=2", results: [{ id: "a" }] } : { results: [{ id: "b" }], next: null }));
    } });
    api.setSession(true, "ana@bold.gt"); api.setAssignment("assignment");
    assert.deepEqual(await api.listTasks({ unit: "unit" }), [{ id: "a" }, { id: "b" }]);
    assert.match(calls[0].url, /\/api\/v2\/tasks\/\?unit=unit/);
    assert.match(calls[1].url, /^http:\/\/localhost:5173\/api\/v2\/tasks\/\?page=2$/);
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.equal(calls[1].options.credentials, "include");
    assert.equal(calls[1].options.headers["X-Assignment-ID"], "assignment");
    await api.request("/api/v2/tasks/", { method: "POST", body: { title: "Tarea" }, headers: { Accept: "application/json" } });
    assert.equal(calls[2].options.body, '{"title":"Tarea"}');
    assert.equal(calls[2].options.headers.Authorization, undefined);
});
test("cookie login bootstraps CSRF and sends no stale assignment", async () => {
    let call = 0;
    const api = createApiClient({ fetchImpl: async (_, options) => {
        call++;
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers["X-Assignment-ID"], undefined);
        if (call === 1) { assert.equal(options.method, "GET"); return new Response('{"authenticated":false}'); }
        assert.deepEqual(JSON.parse(options.body), { email: "ana@bold.gt", password: "test" });
        return new Response('{"authenticated":true,"mfa_required":false}');
    } });
    api.setSession(true, "old@bold.gt"); api.setAssignment("old"); await api.login("ana@bold.gt", "test");
    assert.equal(api.getSession().authenticated, true);
    assert.equal(api.getSession().email, "ana@bold.gt");
    assert.equal(api.getSession().assignmentId, null);
});
test("204 never reads a body, 201 and 202 are successful", async () => {
    const api = createApiClient({ fetchImpl: async () => ({ ok: true, status: 204, text() { throw new Error("Must not read"); } }) });
    assert.equal(await api.deleteTask("task"), null);
    for (const status of [200, 201, 202]) {
        const client = createApiClient({ fetchImpl: async () => new Response('{"ok":true}', { status }) });
        assert.deepEqual(await client.createTask({}), { ok: true });
    }
});
for (const status of [400, 401, 403, 404]) test(`HTTP ${status} exposes validation details and only 401 expires session`, async () => {
    let expired = false;
    const api = createApiClient({ onUnauthorized: () => { expired = true; }, fetchImpl: async () => new Response('{"title":["Campo obligatorio"]}', { status }) });
    await assert.rejects(api.updateTask("task", {}), error => error instanceof ApiError && error.status === status && error.fields.title[0] === "Campo obligatorio");
    assert.equal(expired, status === 401);
});
test("context changes cancel in-flight responses and reject foreign pagination", async () => {
    let resolve;
    const api = createApiClient({ fetchImpl: () => new Promise(done => { resolve = done; }) });
    const old = api.listTasks(); api.setAssignment("new"); resolve(new Response("[]"));
    await assert.rejects(old, { name: "AbortError" });
    await assert.rejects(api.request("https://other.example/api/v2/tasks/"), /no permitida/);
    await assert.rejects(api.request("/api/tasks/"), /no permitida/);
});
test("staff account discovery matches login email, never the first account", async () => {
    const api = createApiClient({ fetchImpl: async () => new Response(JSON.stringify([{ id: "other", email: "other@example.com" }, { id: "own", email: "own@example.com" }])) });
    api.setSession(true, "own@example.com");
    assert.equal((await api.getCurrentAccount()).id, "own");
});
