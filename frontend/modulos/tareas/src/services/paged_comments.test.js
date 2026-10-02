import test from "node:test";
import assert from "node:assert/strict";
import { commentQueries, createPagedComments } from "./paged_comments.js";
import { createHttpClient } from "../../../core/http_client.js";
import { createTasksApi } from "./tasks_api.js";
const id = i => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const row = i => ({ id: id(i), created_at: `2026-10-02T12:00:${String(i % 60).padStart(2, "0")}Z` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}) {
    let clock = 0, visible = true, seq = 0; const timers = new Map(), calls = [];
    const store = createPagedComments({ queries: commentQueries({ taskIds: [id(1)] }),
        listPage: async (...args) => { calls.push(args); return { results: [row(1)], count: 5000, next: "next" }; },
        canRun: () => visible, now: () => clock, setTimer: fn => { timers.set(++seq, fn); return seq; }, clearTimer: key => timers.delete(key), ...overrides });
    return { store, calls, timers, visibility: value => { visible = value; }, time: value => { clock = value; },
        async tick() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); } };
}
test("scope queries preserve mine/project semantics and split disjoint UUID sets at 50", () => {
    assert.deepEqual(commentQueries({ scope: "mine" }), [{ recent: "1", mine: "1" }]);
    assert.deepEqual(commentQueries({ scope: "project", projectId: id(1) }), [{ recent: "1", project: id(1) }]);
    assert.deepEqual(commentQueries({ scope: "project" }), []);
    const queries = commentQueries({ taskIds: [...Array.from({ length: 101 }, (_, i) => id(i)), id(0), "invalid"] });
    assert.deepEqual(queries.map(query => query.tasks.split(",").length), [50, 50, 1]);
});
test("5000-comment count is real but only one page is fetched until explicit load more", async () => {
    const f = fixture(); await f.store.refresh();
    assert.equal(f.calls.length, 1); assert.equal(f.store.snapshot().count, 5000); assert.equal(f.store.snapshot().rows.length, 1);
    await f.store.more(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1][2].next, "next");
    assert.equal(f.store.snapshot().rows.length, 1); // duplicate ID is merged
    await f.store.more(); assert.equal(f.calls.length, 2); assert.match(f.store.snapshot().error, /No se pudieron/); // circular cursor stopped
    f.store.dispose(); assert.equal(f.timers.size, 0);
});
test("burst events coalesce; hidden/offline invalidation waits for visibility without polling", async () => {
    const f = fixture(); await f.store.refresh();
    for (let i = 0; i < 100; i++) f.store.invalidate();
    assert.equal(f.timers.size, 1); await f.tick(); assert.equal(f.calls.length, 2);
    f.visibility(false); for (let i = 0; i < 100; i++) f.store.invalidate();
    assert.equal(f.timers.size, 0); await f.store.refresh(); assert.equal(f.calls.length, 2);
    f.visibility(true); f.store.resume(); await f.tick(); assert.equal(f.calls.length, 3);
    f.store.resume(); assert.equal(f.timers.size, 0);
    f.time(300001); f.store.resume(); assert.equal(f.timers.size, 1); f.store.dispose(); assert.equal(f.timers.size, 0);
});
test("purge cancels old generation and cannot publish a late response after revocation", async () => {
    const pending = deferred(); let signal;
    const f = fixture({ listPage: (_, __, options) => { signal = options.signal; return pending.promise; } });
    const reading = f.store.refresh(); f.store.suspend(); assert.equal(signal.aborted, true);
    assert.deepEqual(f.store.snapshot().rows, []);
    pending.resolve({ results: [row(1)], count: 1, next: null }); await reading;
    assert.deepEqual(f.store.snapshot().rows, []); assert.equal(f.store.snapshot().count, 0); f.store.dispose();
});
test("events during a read request only one following round, never parallel duplicate rounds", async () => {
    const first = deferred(); let reads = 0;
    const f = fixture({ listPage: async () => { reads++; return reads === 1 ? first.promise : { results: [], count: 0, next: null }; } });
    const reading = f.store.refresh(); for (let i = 0; i < 100; i++) f.store.invalidate();
    await f.store.more(); assert.equal(reads, 1);
    first.resolve({ results: [row(1)], count: 1, next: null }); await reading;
    assert.equal(f.timers.size, 1); await f.tick(); assert.equal(reads, 2); f.store.dispose();
});
test("workspace batches are bounded to two concurrent reads with atomic publication", async () => {
    const waits = []; let active = 0, max = 0;
    const f = fixture({ queries: commentQueries({ taskIds: Array.from({ length: 151 }, (_, i) => id(i)) }),
        listPage: () => { active++; max = Math.max(active, max); const wait = deferred(); waits.push(wait); return wait.promise.finally(() => active--); } });
    const reading = f.store.refresh(); assert.equal(waits.length, 2);
    waits[0].resolve({ results: [row(1)], count: 100, next: null }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(waits.length, 3); assert.equal(f.store.snapshot().count, 0);
    waits[1].resolve({ results: [row(2)], count: 200, next: null }); await new Promise(resolve => setImmediate(resolve));
    waits[2].resolve({ results: [row(3)], count: 300, next: null }); waits[3].resolve({ results: [row(4)], count: 400, next: null }); await reading;
    assert.equal(max, 2); assert.equal(f.store.snapshot().count, 1000); assert.equal(f.store.snapshot().rows.length, 4); f.store.dispose();
});
test("403 purges previous rows; Retry-After prevents even manual repeat reads", async () => {
    let fail = false, calls = 0;
    const f = fixture({ listPage: async () => { calls++; if (fail) throw Object.assign(new Error("denied"), { status: 403, retryAfterMs: 120000 }); return { results: [row(1)], count: 1, next: null }; } });
    await f.store.refresh(); fail = true; await f.store.refresh();
    assert.equal(f.store.snapshot().rows.length, 0); await f.store.refresh(); f.store.invalidate(); assert.equal(calls, 2); assert.equal(f.timers.size, 0);
    f.time(120000); f.store.resume(); await f.tick(); assert.equal(calls, 3); f.store.dispose();
});
test("HTTP listPage makes one credentialed GET and normalizes only the same scoped collection", async () => {
    const calls = [];
    const http = createHttpClient({ baseUrl: "https://app.example", fetchImpl: async (url, options) => {
        calls.push({ url, options }); return Response.json({ results: [row(1)], count: 5000, next: "https://private/api/v2/comments/?recent=1&tasks=x&cursor=second" });
    } });
    http.setAssignment("a"); const page = await http.listPage("comments", { recent: "1", tasks: "x" });
    assert.equal(calls.length, 1); assert.equal(page.count, 5000);
    await http.listPage("comments", { recent: "1", tasks: "x" }, { next: page.next });
    assert.match(calls[1].url, /^https:\/\/app.example\/api\/v2\/comments\//);
    assert.equal(calls[1].options.credentials, "include"); assert.equal(calls[1].options.headers["X-Assignment-ID"], "a");
    await assert.rejects(http.listPage("comments", { tasks: "x" }, { next: "/api/v2/tasks/?tasks=x" }), /no permitida/);
    await assert.rejects(http.listPage("comments", { tasks: "x" }, { next: "/api/v2/comments/?tasks=y" }), /alcance/);
    assert.equal(calls.length, 2);
});
test("page cancellation composes local, module and identity signals without cancelling Core", async () => {
    const calls = [];
    const http = createHttpClient({ fetchImpl: (url, options) => new Promise(resolve => calls.push({ resolve, options })) });
    const api = createTasksApi(http), local = new AbortController();
    const reading = api.listPage("comments", {}, { signal: local.signal }); const core = http.request("/api/v2/core/health/");
    local.abort(); assert.equal(calls[0].options.signal.aborted, true); assert.equal(calls[1].options.signal.aborted, false);
    const rejected = assert.rejects(reading, { name: "AbortError" }); calls[0].resolve(Response.json({ results: [], count: 0 })); await rejected;
    const next = api.listPage("comments"); api.cancelRequests(); assert.equal(calls[2].options.signal.aborted, true);
    const moduleRejected = assert.rejects(next, { name: "AbortError" }); calls[2].resolve(Response.json({ results: [], count: 0 })); await moduleRejected;
    calls[1].resolve(Response.json({ ok: true })); await core;
});
