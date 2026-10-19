import test from "node:test";
import assert from "node:assert/strict";
import {createMessagingSession} from "./messaging_session.js";

function harness(acknowledge = async () => ({receipts: []})) {
    const jobs = new Map(), calls = [], events = [], errors = []; let serial = 0;
    const session = createMessagingSession({employeeId: "me", acknowledge: async (...args) => {calls.push(args); return acknowledge(...args);}, emit: event => events.push(event), onError: error => errors.push(error),
        setTimer: (run, delay) => {const id = ++serial; jobs.set(id, {run, delay}); return id;}, clearTimer: id => jobs.delete(id)});
    return {session, jobs, calls, events, errors, async tick() {const [id, job] = jobs.entries().next().value; jobs.delete(id); await job.run();}};
}
test("shared socket envelopes acknowledge only peer messages, not presence or own sends", async () => {
    const h = harness();
    h.session.receive({event_version: 2, event_type: "control.ready", payload: {messages: [{id:"x"}]}});
    assert.equal(h.jobs.size, 0);
    h.session.receive({event_version: 2, event_type: "messaging.message.created", payload: {messages: [{id:"mine", author_id:"me", conversation_id:"c"}, {id:"other", author_id:"peer", conversation_id:"c"}]}});
    await h.tick();
    assert.deepEqual(h.calls[0].slice(0, 3), ["c", ["other"], "delivered"]);
    assert.equal(h.jobs.size, 0); h.session.dispose();
});
test("read supersedes pending delivery, coalesces duplicates, and idle never polls", async () => {
    const h = harness();
    for (let i=0;i<30;i++) h.session.delivered("c", ["same"]);
    h.session.read("c", ["same"]);
    assert.equal(h.jobs.size, 1); await h.tick();
    assert.deepEqual(h.calls[0].slice(0, 3), ["c", ["same"], "read"]);
    h.session.delivered("c", ["same"]); h.session.read("c", ["same"]);
    assert.equal(h.jobs.size, 0); h.session.dispose();
});
test("receipts batch at most one hundred IDs per request", async () => {
    const h = harness();
    for (let i=0;i<125;i++) h.session.delivered("c", [String(i)]);
    await h.tick(); await h.tick();
    assert.deepEqual(h.calls.map(row => row[1].length), [100,25]); h.session.dispose();
});
test("failures honor Retry-After and stop automatic retry after three attempts", async () => {
    const h = harness(async () => {throw {status:429, retryAfterMs:30000};});
    h.session.delivered("c", ["id"]);
    await h.tick(); assert.ok([...h.jobs.values()][0].delay >= 30000);
    await h.tick(); await h.tick(); assert.equal(h.calls.length, 3); assert.equal(h.jobs.size, 0);
    h.session.recover(); assert.equal(h.jobs.size, 1); h.session.dispose(); assert.equal(h.jobs.size, 0);
});
test("disposal aborts the old account request and suppresses late emissions", async () => {
    let finish; const h = harness(() => new Promise(resolve => {finish=resolve;}));
    h.session.read("c", ["id"]); const job = h.tick(); await Promise.resolve();
    h.session.dispose(); assert.equal(h.calls[0][3].signal.aborted, true);
    finish({receipts:[]}); await job; assert.equal(h.events.length, 0);
});
