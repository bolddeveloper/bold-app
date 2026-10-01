import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionMonitor } from "../../core/permission_monitor.js";
import { createPermissionCache } from "../../core/permission_cache.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
    let time = 0, id = 0, calls = 0, online = true;
    const timers = new Map(), events = [];
    const cache = createPermissionCache({ now: () => time, authorize: async () => ({ allowed: true, policy_revision: 1 }) });
    const monitor = createPermissionMonitor({ assignmentId: "mine", cache, now: () => time, online: () => online,
        fetchRevision: async () => { calls++; return { revision: 1, state: "one" }; },
        setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
        clearTimer: key => timers.delete(key), onInvalidate: detail => events.push(detail), ...options });
    let sequence = 0;
    const control = (extra = {}, overrides = {}) => monitor.control({ event_version: 2, event_type: "control.ready", entity_id: "stream",
        payload: { assignment: "mine", capabilities: { permissions_revision: true }, revision: 1, state: "one",
            lease_ms: 45000, boundary_ms: 86400000, sequence: ++sequence, force: false, ...extra }, ...overrides });
    async function advance(ms) {
        const end = time + ms;
        for (;;) {
            const job = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!job || job[1].at > end) break;
            time = job[1].at; timers.delete(job[0]); job[1].fn(); await flush();
        }
        time = end; await flush();
    }
    return { cache, monitor, control, advance, events, timers, calls: () => calls, online: value => { online = value; } };
}
const query = { assignmentId: "mine", permissionCode: "tasks.task.read", unitId: "unit" };

test("authenticated control cuts the stable-hour revision budget from 720 to 60", async () => {
    const h = harness(); await flush(); h.control();
    for (let i = 0; i < 120; i++) { await h.advance(30000); h.control(); }
    assert.equal(h.calls() - 1, 60); // initial verification is reported separately
    assert.equal(h.monitor.snapshot().intervalMs, 60000);
    assert.equal(h.events.length, 0); // unchanged heartbeats/polls never reload content
    h.monitor.dispose(); assert.equal(h.timers.size, 0);
});
test("legacy backend keeps 5s checks and cannot accidentally enable the slower fallback", async () => {
    const h = harness(); await flush();
    h.control({ capabilities: {} });
    await h.advance(3600000);
    assert.equal(h.calls() - 1, 720); assert.equal(h.monitor.snapshot().healthy, false);
    h.monitor.dispose();
});
test("push invalidates cached allows immediately, deduplicates sequences and isolates assignments", async () => {
    const h = harness(); await flush(); h.control();
    assert.equal(await h.cache.can(query), true);
    h.control({ sequence: 2, revision: 2, state: "two", force: true }, { event_type: "permissions.revision" });
    assert.equal(h.events.length, 1);
    // An authorization from an older revision must not bring its allowance back.
    assert.equal(await h.cache.can(query), false);
    h.control({ sequence: 2, revision: 2, state: "two", force: true });
    h.control({ assignment: "another", revision: 3, force: true });
    assert.equal(h.events.length, 1); h.monitor.dispose();
});
test("lost/half-open control blocks cached capabilities until verification succeeds", async () => {
    let resolve, calls = 0;
    const h = harness({ fetchRevision: () => { calls++; return calls === 1 ? Promise.resolve({ revision: 1, state: "one" }) : new Promise(done => { resolve = done; }); } });
    await flush(); h.control(); assert.equal(await h.cache.can(query), true);
    await h.advance(45000);
    assert.equal(h.monitor.snapshot().uncertain, true);
    assert.equal(h.monitor.snapshot().intervalMs, 5000);
    assert.equal(await h.cache.can(query), false);
    assert.equal(h.events[0].uncertain, true);
    resolve({ revision: 1, state: "one" }); await flush();
    assert.equal(h.monitor.snapshot().uncertain, false);
    assert.equal(h.events.at(-1).uncertain, false);
    h.monitor.dispose();
});
test("temporal deadline is enforced locally even if the expiry event is delayed", async () => {
    let resolve, calls = 0;
    const h = harness({ fetchRevision: () => ++calls === 1 ? Promise.resolve({ revision: 1, state: "one" }) : new Promise(done => { resolve = done; }) });
    await flush(); h.control({ boundary_ms: 2000 });
    assert.equal(await h.cache.can(query), true); await h.advance(2000);
    assert.equal(await h.cache.can(query), false);
    h.control({ state: "mfa-expired", force: true });
    // The old REST response cannot undo a newer control decision.
    resolve({ revision: 1, state: "one" }); await flush();
    assert.equal(h.events.at(-1).reason, "control.ready"); h.monitor.dispose();
});
test("disconnect/offline is idempotent, stops HTTP and forces verification on recovery", async () => {
    const h = harness(); await flush(); h.control(); h.online(false); h.monitor.recover();
    h.monitor.disconnected(); h.monitor.disconnected();
    await h.advance(60000); assert.equal(h.calls(), 1);
    assert.equal(h.events.length, 1); assert.equal(await h.cache.can(query), false);
    h.online(true); h.monitor.recover(); await flush(); assert.equal(h.calls(), 2);
    assert.equal(h.events.at(-1).uncertain, false); h.monitor.dispose();
});
test("quota/throttling is respected and disposed monitors ignore late responses", async () => {
    let requests = 0, resolve;
    const h = harness({ fetchRevision: async () => { requests++; throw { status: 429, retryAfterMs: 300000 }; } });
    await flush(); await h.advance(299999); assert.equal(requests, 1);
    await h.advance(1); assert.equal(requests, 2); h.monitor.dispose();
    const pending = harness({ fetchRevision: () => new Promise(done => { resolve = done; }) });
    pending.monitor.dispose(); resolve({ revision: 99, state: "old-session", force: true }); await flush();
    assert.equal(pending.events.length, 0); assert.equal(pending.timers.size, 0);
});
test("in-flight checks from before disconnect cannot clear uncertainty", async () => {
    let resolve, calls = 0;
    const h = harness({ fetchRevision: () => ++calls === 1 ? Promise.resolve({ revision: 1, state: "one" }) : new Promise(done => { resolve = done; }) });
    await flush(); h.control(); await h.advance(60000); // lease expired, verification pending
    h.monitor.disconnected(); resolve({ revision: 1, state: "one" }); await flush();
    assert.equal(h.monitor.snapshot().uncertain, true); h.monitor.dispose();
});

test("older revisions and retired sockets cannot restore a revoked allowance", async () => {
    const h = harness(); await flush(); h.control();
    h.control({ revision: 8, state: "revoked", force: true });
    const count = h.events.length;
    h.control({ revision: 1, state: "one", force: true });
    assert.equal(h.events.length, count);
    h.monitor.disconnected();
    h.control({ sequence: 1, revision: 8, state: "revoked" }, { entity_id: "new-stream" });
    const recovered = h.events.length;
    h.control({ sequence: 1, revision: 8, state: "old", force: true });
    assert.equal(h.events.length, recovered); h.monitor.dispose();
});
test("a changed organizational context requests a rebuild, not reuse of previous units", async () => {
    const h = harness(); await flush(); h.control({ context: "unit-a" });
    h.control({ context: "unit-b", state: "two", force: true });
    assert.equal(h.events.at(-1).contextChanged, true);
    assert.equal(h.events.at(-1).uncertain, true); h.monitor.dispose();
});
test("REST alone also detects temporal expiry when a control channel is unavailable", async () => {
    let expired = false;
    const h = harness({ fetchRevision: async () => ({ revision: 1, state: expired ? "expired" : "one", boundary_ms: expired ? 999999 : 2000 }) });
    await flush(); expired = true; await h.advance(2000);
    assert.equal(h.events[0].uncertain, true);
    assert.equal(h.events.at(-1).reason, "permission-fallback"); h.monitor.dispose();
});

test("hidden tabs pause healthy REST backup, but still process revocation and restore on focus", async () => {
    const h = harness({ visible: () => false }); await flush(); h.control();
    for (let i = 0; i < 120; i++) { await h.advance(30000); h.control(); }
    assert.equal(h.calls(), 1);
    h.control({ revision: 2, state: "revoked", force: true });
    assert.equal(h.events.at(-1).uncertain, false);
    h.monitor.recover(); await flush();
    assert.equal(h.calls(), 2); h.monitor.dispose();
});
