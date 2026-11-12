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
    sockets[0].listeners.message({data: JSON.stringify({event_version: 2, event_type: "notification.invalidated", event_id: "2"})});
    assert.equal(received.length, 2);
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

test("Slack hints use the same session socket without entering private messaging or notifications", async () => {
    let socket, opened=0;
    class Socket {
        constructor() {this.listeners={}; socket=this; opened++;}
        addEventListener(name,fn) {this.listeners[name]=fn;}
        close() {}
    }
    const slack=[], messages=[], notifications=[];
    const realtime=createNotificationRealtime({WebSocketImpl:Socket});
    realtime.connect({assignmentId:"it",getTicket:async()=>({ticket:"one"}),onSlack:event=>slack.push(event),onMessaging:event=>messages.push(event),onNotification:event=>notifications.push(event)});
    await new Promise(resolve=>setImmediate(resolve));
    socket.listeners.message({data:JSON.stringify({event_version:2,event_type:"slack.changed",payload:{channel_id:"one"}})});
    assert.equal(opened,1); assert.equal(slack.length,1); assert.deepEqual(messages,[]); assert.deepEqual(notifications,[]);
    socket.listeners.message({data:JSON.stringify({event_version:2,event_type:'messaging.reminder.changed',payload:{reading:{version:2,items:[]}}})});
    assert.equal(messages.length,1);assert.equal(messages[0].event_type,'messaging.reminder.changed');assert.deepEqual(notifications,[],'a personal reminder is not a new bell notification');
    realtime.disconnect();
    socket.listeners.message({data:JSON.stringify({event_version:2,event_type:"slack.changed"})});
    assert.equal(slack.length,1);
});


test("reports opt in reuses the notification socket and survives reconnect",async()=>{
    const sockets=[],sent=[],reports=[],recovered=[];
    class Socket{
        constructor(){this.listeners={};this.readyState=0;sockets.push(this);}
        addEventListener(name,fn){this.listeners[name]=fn;}
        send(value){sent.push(JSON.parse(value));}
        close(){this.readyState=3;}
    }
    const jobs=[];
    const realtime=createNotificationRealtime({WebSocketImpl:Socket,eventTarget:new EventTarget(),random:()=>0,setTimer:(fn,delay)=>{jobs.push({fn,delay});return jobs.length;},clearTimer:()=>{}});
    realtime.watchReports(true);
    realtime.connect({assignmentId:"a",getTicket:async()=>({ticket:"fresh"}),onReports:event=>reports.push(event),onReconnect:()=>recovered.push(true)});
    await new Promise(resolve=>setImmediate(resolve));sockets[0].readyState=1;sockets[0].listeners.open();
    assert.deepEqual(sent,[{type:'reports.watch',enabled:true}]);
    sockets[0].listeners.message({data:JSON.stringify({event_version:2,event_type:'reports.changed',payload:{scope:'work'}})});
    assert.equal(reports.length,1);
    sockets[0].readyState=3;sockets[0].listeners.close({code:1006});
    jobs.at(-1).fn();await new Promise(resolve=>setImmediate(resolve));
    sockets[1].readyState=1;sockets[1].listeners.open();assert.equal(recovered.length,1);assert.equal(sent.length,2);
    realtime.watchReports(false);assert.deepEqual(sent.at(-1),{type:'reports.watch',enabled:false});
    realtime.disconnect();assert.equal(sockets.length,2);
});
