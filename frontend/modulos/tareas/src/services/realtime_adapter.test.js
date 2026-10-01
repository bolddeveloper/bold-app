import test from "node:test";
import assert from "node:assert/strict";
import { createEventDeduplicator, websocketURL, createRealtimeAdapter } from "./realtime_adapter.js";
test("V2 events deduplicate across units using a bounded cache", () => {
    const accept = createEventDeduplicator(2), event = id => ({ event_id: id, event_version: 2 });
    assert.equal(accept(event("1")), true); assert.equal(accept(event("1")), false);
    assert.equal(accept({ ...event("2"), event_version: 3 }), false); assert.equal(accept({}), false);
    accept(event("2")); accept(event("3")); assert.equal(accept(event("1")), true);
});
test("WS URL uses a single-use ticket with automatic WSS", () => {
    const url = new URL(websocketURL({ unitId: "u", ticket: "a&b", baseUrl: "https://example.com" }));
    assert.equal(url.protocol, "wss:"); assert.equal(url.pathname, "/ws/unit/u/"); assert.equal(url.searchParams.get("ticket"), "a&b"); assert.equal(url.searchParams.get("token"), null);
});
test("reconnect obtains a fresh ticket, refetches REST and cancels timers", async () => {
    const sockets = [], timers = []; let refetches = 0, events = 0;
    class Socket {
        constructor() { this.handlers = {}; sockets.push(this); }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        emit(name, event = {}) { this.handlers[name]?.(event); }
        close() { this.emit("close"); }
    }
    const adapter = createRealtimeAdapter({ WebSocketImpl: Socket, random: () => 0, setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimer: id => { if (id) timers[id - 1].cancelled = true; } });
    let tickets = 0;
    adapter.connect({ unitId: "u", assignmentId: "a", getTicket: async () => ({ ticket: `t${++tickets}` }), onReconnect: () => refetches++, onEvent: () => events++ });
    await new Promise(resolve => setImmediate(resolve));
    sockets[0].emit("open"); sockets[0].emit("message", { data: "bad json" });
    for (let i = 0; i < 2; i++) sockets[0].emit("message", { data: '{"event_id":"e","event_version":2}' });
    assert.equal(events, 1);
    assert.equal(refetches, 0);
    sockets[0].emit("close"); assert.equal(timers[0].delay, 1000); timers[0].fn(); await new Promise(resolve => setImmediate(resolve)); sockets[1].emit("open");
    assert.equal(refetches, 1);
    sockets[1].emit("close"); adapter.disconnect(); assert.equal(timers[1].cancelled, true);
    timers[1].fn(); assert.equal(sockets.length, 2);
});

test("retaining units preserves authorized connections instead of reopening every socket", async () => {
    const sockets = [];
    class Socket { constructor() { this.listeners = {}; sockets.push(this); } addEventListener(name, fn) { this.listeners[name] = fn; } close() { this.closed = true; } }
    const adapter = createRealtimeAdapter({ WebSocketImpl: Socket });
    const options = unitId => ({ unitId, assignmentId: "a", getTicket: async () => ({ ticket: "once" }) });
    const one = adapter.connect(options("one")); adapter.connect(options("two"));
    await new Promise(resolve => setImmediate(resolve));
    adapter.retain(["one"]);
    assert.equal(adapter.connect(options("one")), one);
    assert.equal(sockets.length, 2); assert.equal(sockets[0].closed, undefined); assert.equal(sockets[1].closed, true);
    adapter.disconnect();
});
