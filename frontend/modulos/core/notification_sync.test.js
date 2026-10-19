import test from "node:test";
import assert from "node:assert/strict";
import {createNotificationSync, NOTIFICATION_HEALTHY_MS, NOTIFICATION_FALLBACK_MS} from "./notification_sync.js";

const settle = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function fixture() {
    let time = 0, next = 0;
    const timers = new Map(), target = new EventTarget(), documentTarget = new EventTarget();
    const state = {visible: true, calls: [], errors: [], refresh: async () => {}};
    const sync = createNotificationSync({target, documentTarget, now: () => time, random: () => 0,
        canRun: () => state.visible,
        setTimer: (callback, delay) => {timers.set(++next, {callback, at: time + delay}); return next;},
        clearTimer: id => timers.delete(id),
        onError: error => state.errors.push(error),
        refresh: async (reason, force) => {state.calls.push({reason, force}); return state.refresh();},
    });
    return {state, sync, target, documentTarget, timers, async advance(ms) {
        const until = time + ms;
        for (;;) {
            const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!entry || entry[1].at > until) break;
            time = entry[1].at; timers.delete(entry[0]); entry[1].callback(); await settle();
        }
        time = until; await settle();
    }};
}

test("healthy push channel has only twelve recovery reads per hour, not 1800", async () => {
    const f = fixture(); await f.sync.request("bootstrap"); f.sync.connection("open");
    await f.advance(NOTIFICATION_HEALTHY_MS - 1); assert.equal(f.state.calls.length, 1);
    await f.advance(1); assert.equal(f.state.calls.length, 2);
    await f.advance(55 * 60_000); assert.equal(f.state.calls.length, 13);
    f.sync.dispose(); assert.equal(f.timers.size, 0);
});
test("push events update immediately and focus storms do not multiply reads", async () => {
    const f = fixture(); await f.sync.request("bootstrap"); f.sync.connection("open");
    await f.sync.request("notification-event", {event: true}); assert.equal(f.state.calls.length, 2);
    for (let i = 0; i < 30; i++) f.target.dispatchEvent(new Event("focus"));
    await settle(); assert.equal(f.state.calls.length, 2);
    await f.advance(15_000); f.target.dispatchEvent(new Event("focus")); await settle();
    assert.equal(f.state.calls.length, 3); f.sync.dispose();
});
test("socket outage uses a bounded fallback and reconnect restores healthy cadence", async () => {
    const f = fixture(); await f.sync.request("bootstrap"); f.sync.connection("disconnected");
    await f.advance(NOTIFICATION_FALLBACK_MS); assert.equal(f.state.calls.length, 2);
    f.sync.connection("open"); await f.sync.request("notification-reconnect");
    await f.advance(NOTIFICATION_FALLBACK_MS); assert.equal(f.state.calls.length, 3);
    f.sync.dispose();
});
test("hidden tabs do not poll; a missed push recovers on focus even within 15 seconds", async () => {
    const f = fixture(); await f.sync.request("bootstrap"); f.sync.connection("open");
    f.state.visible = false; await f.sync.request("notification-event", {event: true});
    assert.equal(f.state.calls.length, 1);
    f.state.visible = true; f.documentTarget.dispatchEvent(new Event("visibilitychange")); await settle();
    assert.equal(f.state.calls.length, 2);
    f.state.visible = false; await f.advance(60 * 60_000); assert.equal(f.state.calls.length, 2);
    f.sync.dispose();
});
test("authorized desktop notifications may refresh in background", async () => {
    const f = fixture(); f.state.visible = false;
    await f.sync.request("notification-event", {event: true, force: true});
    assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].force, true); f.sync.dispose();
});
test("in-flight event bursts queue a single follow-up without overlapping requests", async () => {
    const f = fixture(); let release;
    f.state.refresh = () => new Promise(resolve => {release = resolve;});
    f.sync.request("bootstrap"); await settle();
    for (let i = 0; i < 40; i++) f.sync.request("notification-event", {event: true});
    assert.equal(f.state.calls.length, 1);
    f.state.refresh = async () => {}; release(); await settle();
    assert.equal(f.state.calls.length, 2); f.sync.dispose();
});
test("Retry-After and exponential backoff survive focus and event storms", async () => {
    const f = fixture(); f.state.refresh = async () => {throw Object.assign(Error("Rate limited"), {retryAfterMs: 600_000});};
    await f.sync.request("bootstrap"); assert.equal(f.state.errors.length, 1);
    await f.advance(30_000); f.target.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 40; i++) await f.sync.request("notification-event", {event: true, force: true});
    await f.advance(569_999); assert.equal(f.state.calls.length, 1);
    f.state.refresh = async () => {}; await f.advance(1); assert.equal(f.state.calls.length, 2);
    f.sync.dispose();
});
test("dispose removes recovery listeners and cannot schedule again", async () => {
    const f = fixture(); await f.sync.request("bootstrap"); f.sync.dispose();
    f.sync.connection("open"); await f.advance(3_600_000);
    f.target.dispatchEvent(new Event("online")); f.documentTarget.dispatchEvent(new Event("visibilitychange"));
    await f.sync.request("notification-event", {force: true}); await settle();
    assert.equal(f.state.calls.length, 1); assert.equal(f.timers.size, 0);
});
