import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationRealtime, notificationWebsocketURL } from "./notification_realtime.js";


test("notification websocket uses the independent one-use ticket channel", () => {
    const url = notificationWebsocketURL({ ticket: "once", baseUrl: "https://boldapp.example/" });
    assert.equal(url, "wss://boldapp.example/ws/notifications/?ticket=once");
});

test("notification realtime requests its own channel and forwards valid events", async () => {
    const sockets = [];
    class Socket {
        constructor(url) { this.url = url; this.listeners = {}; sockets.push(this); }
        addEventListener(name, handler) { this.listeners[name] = handler; }
        close() {}
    }
    const received = [];
    const requested = [];
    const realtime = createNotificationRealtime({ WebSocketImpl: Socket });
    realtime.connect({
        assignmentId: "assignment-1",
        getTicket: async body => { requested.push(body); return { ticket: "single-use" }; },
        onNotification: event => received.push(event),
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requested, [{ assignment: "assignment-1", channel: "notifications" }]);
    sockets[0].listeners.message({ data: JSON.stringify({ event_version: 2, event_type: "notification.created", event_id: "1" }) });
    sockets[0].listeners.message({ data: "{}" });
    assert.equal(received.length, 1);
    realtime.disconnect();
});

test("control capability, disconnect and session-terminal reason propagate independently of notifications", async () => {
    let socket;
    class Socket {
        constructor() { this.listeners = {}; socket = this; }
        addEventListener(name, fn) { this.listeners[name] = fn; }
        close() {}
    }
    const controls = [], states = [], terminal = [];
    const realtime = createNotificationRealtime({ WebSocketImpl: Socket });
    realtime.connect({ assignmentId: "a", getTicket: async () => ({ ticket: "one" }),
        onControl: value => controls.push(value), onState: value => states.push(value), onTerminal: value => terminal.push(value) });
    await new Promise(resolve => setImmediate(resolve));
    socket.listeners.open();
    socket.listeners.message({ data: JSON.stringify({ event_version: 2, event_type: "control.ready" }) });
    socket.listeners.close({ code: 4401 });
    assert.equal(controls.length, 1); assert.ok(states.includes("disconnected"));
    assert.equal(terminal[0].status, 401); realtime.disconnect();
    socket.listeners.message({ data: JSON.stringify({ event_version: 2, event_type: "permissions.revision" }) });
    assert.equal(controls.length, 1);
});
