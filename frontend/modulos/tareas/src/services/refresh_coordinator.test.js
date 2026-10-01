import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoordinator } from "../../../core/refresh_coordinator.js";
import { createContextCache } from "../../../core/context_cache.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function clock() {
    const timers = new Map(); let id = 0;
    return { setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: id => timers.delete(id),
        advance() { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); }, timers };
}
test("a socket burst becomes one refresh and one pending round during a load", async () => {
    const timer = clock(), calls = []; let release;
    const coordinator = createRefreshCoordinator({ ...timer, run: batch => { calls.push(batch); return new Promise(resolve => { release = resolve; }); } });
    const first = coordinator.request({ reason: "event" });
    for (let i = 0; i < 14; i++) assert.equal(coordinator.request({ reason: "reconnect" }), first);
    timer.advance(); await tick(); assert.equal(calls.length, 1);
    const second = coordinator.request({ reason: "event" });
    for (let i = 0; i < 14; i++) assert.equal(coordinator.request({ reason: "event" }), second);
    release(); await first; await tick(); timer.advance(); await tick();
    assert.equal(calls.length, 2); release(); await second; coordinator.dispose();
});
test("hidden or offline content waits for one recovery; security is not delayed", async () => {
    const timer = clock(); let visible = false, calls = 0;
    const coordinator = createRefreshCoordinator({ ...timer, canRun: () => visible, run: async () => ++calls });
    const first = coordinator.request({ reason: "poll" }); timer.advance(); await tick(); assert.equal(calls, 0);
    coordinator.request({ reason: "focus" }); visible = true; coordinator.resume(); timer.advance();
    await first; assert.equal(calls, 1);
    visible = false; await coordinator.request({ reason: "permissions", security: true }); assert.equal(calls, 2);
    coordinator.dispose();
});
test("disposal rejects queued work and cannot start a request after cancellation", async () => {
    const timer = clock(); let calls = 0;
    const coordinator = createRefreshCoordinator({ ...timer, run: async () => ++calls });
    const first = coordinator.request(); const rejected = assert.rejects(first, { name: "AbortError" });
    coordinator.dispose(); timer.advance(); await rejected; assert.equal(calls, 0);
});
test("catalog cache deduplicates empty lists, expires and rejects old generations", async () => {
    let now = 0, calls = 0;
    const cache = createContextCache({ now: () => now, ttlMs: 100 });
    const load = async () => { calls++; return []; };
    const first = cache.get("tags:u", load); assert.equal(cache.get("tags:u", load), first);
    assert.deepEqual(await first, []); await cache.get("tags:u", load); assert.equal(calls, 1);
    now = 100; await cache.get("tags:u", load); assert.equal(calls, 2);
    let release;
    const old = cache.get("statuses:u", () => new Promise(resolve => { release = resolve; }));
    await tick(); const rejected = assert.rejects(old, { name: "AbortError" });
    cache.clear(); release(["secret-old-context"]); await rejected;
    assert.deepEqual(await cache.get("statuses:u", load), []);
});
