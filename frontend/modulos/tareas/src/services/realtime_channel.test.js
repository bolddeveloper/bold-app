import test from "node:test";
import assert from "node:assert/strict";
import { createRealtimeChannel, createTicketQueue } from "../../../core/realtime_channel.js";
const tick = () => new Promise(resolve => setImmediate(resolve));

test("retries notify once per interruption, including unstable recoveries", async () => {
    let time = 0;
    const sockets = [], timers = [], errors = [];
    class Socket {
        constructor() { this.readyState = 0; this.handlers = {}; sockets.push(this); }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        close() { this.readyState = 3; this.handlers.close?.({code: 1006}); }
    }
    const channel = createRealtimeChannel({WebSocketImpl: Socket, eventTarget: new EventTarget(), now: () => time, random: () => 0,
        getTicket: async () => ({}), urlForTicket: () => "ws://example.test", onError: message => errors.push(message),
        setTimer: (fn, delay) => {timers.push({fn, delay}); return timers.length;}, clearTimer: () => {}});
    await tick();
    sockets[0].close();
    timers.at(-1).fn(); await tick();
    sockets[1].close();
    assert.equal(errors.length, 1);
    timers.at(-1).fn(); await tick();
    sockets[2].readyState = 1; sockets[2].handlers.open();
    time = 1000; sockets[2].close();
    assert.equal(errors.length, 1);
    timers.at(-1).fn(); await tick();
    sockets[3].readyState = 1; sockets[3].handlers.open();
    time = 31000; sockets[3].close();
    assert.equal(errors.length, 2);
    channel.stop();
});

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
    assert.equal(timers.at(-1).delay, 1000); timers.at(-1).fn(); await tick();
    sockets[1].listeners.open(); sockets[1].listeners.close({ code: 1006 });
    assert.equal(timers.at(-1).delay, 2000); channel.stop();
});

test("online events cannot shorten server Retry-After or reconnect backoff", async () => {
    let time = 0, tickets = 0;
    const target = new EventTarget(), timers = new Map(); let id = 0;
    const channel = createRealtimeChannel({ eventTarget: target, now: () => time, random: () => 0,
        getTicket: async () => { tickets++; throw { status: 429, retryAfterMs: 300000 }; },
        setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimer: key => timers.delete(key) });
    await channel.ready; await tick();
    for (let i = 0; i < 50; i++) target.dispatchEvent(new Event("online"));
    await tick(); assert.equal(tickets, 1); assert.equal(timers.size, 1);
    time = 300000; target.dispatchEvent(new Event("online")); await tick();
    assert.equal(tickets, 2); assert.equal(timers.size, 1);
    channel.stop(); assert.equal(timers.size, 0);
});

test("silent handshake recovers once, ignores late events and stops all timers", async () => {
    const timers = new Map(), sockets = []; let id = 0, connected = 0, recovered = 0;
    class Socket {
        constructor() { this.readyState = 0; this.handlers = {}; sockets.push(this); }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        close() { this.readyState = 3; this.handlers.close?.({ code: 1006 }); }
    }
    const channel = createRealtimeChannel({ WebSocketImpl: Socket, eventTarget: new EventTarget(), random: () => 0,
        getTicket: async () => ({}), urlForTicket: () => "ws://example.test",
        onConnected: () => connected++, onReconnect: () => recovered++,
        setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimer: key => timers.delete(key) });
    await tick();
    let [key, job] = [...timers][0]; assert.equal(job.delay, 15000); timers.delete(key); job.fn();
    await channel.ready;
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 1000);
    sockets[0].handlers.open(); assert.equal(connected, 0); assert.equal(recovered, 0);
    [key, job] = [...timers][0]; timers.delete(key); job.fn(); await tick();
    sockets[1].readyState = 1; sockets[1].handlers.open();
    assert.equal(connected, 0); assert.equal(recovered, 1); assert.equal(timers.size, 0);
    channel.stop(); sockets[1].handlers.close({ code: 1006 }); assert.equal(timers.size, 0);
});
