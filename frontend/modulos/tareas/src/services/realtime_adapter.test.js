import test from "node:test";
import assert from "node:assert/strict";
import { createEventDeduplicator, websocketURL, createRealtimeAdapter } from "./realtime_adapter.js";
test("V2 events deduplicate across units using a bounded cache", () => {
    const accept = createEventDeduplicator(2), event = id => ({ event_id: id, event_version: 2 });
    assert.equal(accept(event("1")), true); assert.equal(accept(event("1")), false);
    assert.equal(accept({ ...event("2"), event_version: 3 }), false); assert.equal(accept({}), false);
    accept(event("2")); accept(event("3")); assert.equal(accept(event("1")), true);
});
test("WS URL uses unit, token and assignment with automatic WSS", () => {
    const url = new URL(websocketURL({ unitId: "u", token: "a&b", assignmentId: "a", baseUrl: "https://example.com" }));
    assert.equal(url.protocol, "wss:"); assert.equal(url.pathname, "/ws/unit/u/"); assert.equal(url.searchParams.get("token"), "a&b"); assert.equal(url.searchParams.get("assignment"), "a");
});
test("reconnect refetches REST, ignores invalid messages and cancels timers on disposal", () => {
    const sockets = [], timers = []; let refetches = 0, events = 0;
    class Socket {
        constructor() { this.handlers = {}; sockets.push(this); }
        addEventListener(name, fn) { this.handlers[name] = fn; }
        emit(name, event = {}) { this.handlers[name]?.(event); }
        close() { this.emit("close"); }
    }
    const adapter = createRealtimeAdapter({ WebSocketImpl: Socket, setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimer: id => { if (id) timers[id - 1].cancelled = true; } });
    adapter.connect({ unitId: "u", token: "t", assignmentId: "a", onReconnect: () => refetches++, onEvent: () => events++ });
    sockets[0].emit("open"); sockets[0].emit("message", { data: "bad json" });
    for (let i = 0; i < 2; i++) sockets[0].emit("message", { data: '{"event_id":"e","event_version":2}' });
    assert.equal(events, 1);
    sockets[0].emit("close"); assert.equal(timers[0].delay, 1000); timers[0].fn(); sockets[1].emit("open");
    assert.equal(refetches, 2);
    sockets[1].emit("close"); adapter.disconnect(); assert.equal(timers[1].cancelled, true);
    timers[1].fn(); assert.equal(sockets.length, 2);
});
