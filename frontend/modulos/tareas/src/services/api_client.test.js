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

test("V2 serializes JSON, merges headers and follows every page", async () => {
    const calls = [];
    const api = createApiClient({ fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(calls.length === 1 ? { count: 2, next: "http://127.0.0.1:8000/api/v2/tasks/?page=2", results: [{ id: "a" }] } : { results: [{ id: "b" }], next: null }));
    } });
    api.setToken("secret"); api.setAssignment("assignment");
    assert.deepEqual(await api.listTasks({ unit: "unit" }), [{ id: "a" }, { id: "b" }]);
    assert.match(calls[0].url, /\/api\/v2\/tasks\/\?unit=unit/);
    assert.equal(calls[1].options.headers.Authorization, "Token secret");
    assert.equal(calls[1].options.headers["X-Assignment-ID"], "assignment");
    await api.request("/api/v2/tasks/", { method: "POST", body: { title: "Tarea" }, headers: { Accept: "application/json" } });
    assert.equal(calls[2].options.body, '{"title":"Tarea"}');
    assert.equal(calls[2].options.headers.Authorization, "Token secret");
});
test("anonymous login uses username and sends no stale credentials", async () => {
    const api = createApiClient({ fetchImpl: async (_, options) => {
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers["X-Assignment-ID"], undefined);
        assert.deepEqual(JSON.parse(options.body), { username: "ana@example.com", password: "test" });
        return new Response('{"token":"new"}');
    } });
    api.setToken("old"); api.setAssignment("old"); await api.login("ana@example.com", "test");
    assert.equal(api.getSession().token, "new");
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
    api.setToken("token", "own@example.com");
    assert.equal((await api.getCurrentAccount()).id, "own");
});
