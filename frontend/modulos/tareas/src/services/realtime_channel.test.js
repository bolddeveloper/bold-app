import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeChannel, createTicketQueue } from "../../../core/realtime_channel.js";
const tick = () => new Promise(resolve => setImmediate(resolve));

test("terminal ticket rejection never schedules an automatic retry", async () => {
    for (const status of [401, 403]) {
        let tickets = 0, scheduled = 0, terminal = 0;
        const channel = createRealtimeChannel({ getTicket: async () => { tickets++; throw { status }; }, setTimer: () => scheduled++, onTerminal: () => terminal++ });
        await channel.ready; await tick();
        assert.equal(tickets, 1); assert.equal(scheduled, 0); assert.equal(terminal, 1); channel.stop();
    }
});
test("quota retry honors server delay rather than opening a rapid loop", async () => {
    const delays = [];
    const channel = createRealtimeChannel({ getTicket: async () => { throw { status: 429, retryAfterMs: 300_000, quotaExceeded: true }; }, setTimer: (_, delay) => { delays.push(delay); return 1; }, clearTimer: () => {}, random: () => 0 });
    await channel.ready; await tick(); assert.deepEqual(delays, [300_000]); channel.stop();
});
test("ticket queue bounds concurrency and queued cancelled channels do not issue tickets", async () => {
    const queue = createTicketQueue(2); let active = 0, peak = 0; const releases = [];
    const jobs = Array.from({ length: 14 }, () => queue(() => { active++; peak = Math.max(peak, active); return new Promise(resolve => releases.push(() => { active--; resolve(); })); }));
    await tick(); assert.equal(peak, 2);
    while (releases.length || active) { releases.splice(0).forEach(release => release()); await tick(); }
    await Promise.all(jobs); assert.equal(peak, 2);
    let cancelledTickets = 0;
    const channel = createRealtimeChannel({ ticketQueue: queue, getTicket: async () => { cancelledTickets++; return {}; } });
    channel.stop(); await tick(); assert.equal(cancelledTickets, 0);
});
test("offline channels wake once online and flapping does not reset backoff", async () => {
    let online = false, tickets = 0;
    const target = new EventTarget(), sockets = [], timers = [];
    class Socket { constructor() { this.listeners = {}; sockets.push(this); } addEventListener(name, fn) { this.listeners[name] = fn; } close() {} }
    const channel = createRealtimeChannel({ eventTarget: target, online: () => online, WebSocketImpl: Socket, random: () => 0,
        setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimer: () => {},
        getTicket: async () => { tickets++; return {}; }, urlForTicket: () => "ws://example.test" });
    await tick(); assert.equal(tickets, 0);
    online = true; target.dispatchEvent(new Event("online")); await tick();
    sockets[0].listeners.open(); sockets[0].listeners.close({ code: 1006 });
    assert.equal(timers[0].delay, 1000); timers[0].fn(); await tick();
    sockets[1].listeners.open(); sockets[1].listeners.close({ code: 1006 });
    assert.equal(timers[1].delay, 2000); channel.stop();
});
