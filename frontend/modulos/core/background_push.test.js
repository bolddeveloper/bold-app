import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {createBackgroundPush} from "./background_push.js";

const scope = {accountId: "account-a", assignmentId: "assignment-a"};
function fixture({permission = "granted", stored = [], gate, server = true} = {}) {
    const values = new Map(stored), requests = [], subscription = {toJSON: () => ({endpoint: "https://provider.invalid/secret", keys: {auth: "secret"}}), unsubscribe: async () => true};
    const client = {request: async (url, options) => {
        requests.push([url, options]); if (gate) await gate;
        return url.endsWith("config/") ? {enabled: server, public_key: "AQID"} : {device_id: "device", binding: "binding", assignment_id: scope.assignmentId};
    }};
    const push = createBackgroundPush({client, notifications: {permission}, supported: () => true,
        storage: {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)},
        serviceWorker: {getRegistration: async () => ({active: {}, pushManager: {getSubscription: async () => subscription}})}, host: new EventTarget()});
    return {push, requests, values};
}

test("push never registers without permission AND per-account device opt-in", async () => {
    const s = fixture(); assert.equal(await s.push.sync(scope), false); assert.equal(s.requests.length, 0);
    const denied = fixture({permission: "denied"}); assert.equal(await denied.push.enable(scope), false); assert.equal(denied.requests.length, 0);
    assert.equal(await s.push.enable(scope), true); assert.equal(s.push.active(scope), true);
    assert.equal(s.values.get("bold-background-push:account-a:assignment-a"), "yes");
    assert.equal(s.push.active({...scope, accountId: "account-b"}), false);
    s.push.suspend(); assert.equal(s.push.active(scope), false);
    assert.equal(await s.push.sync({...scope, accountId: "account-b"}), false);
    assert.equal(await s.push.sync(scope), true, "Same opted-in account gets a fresh server binding after login");
});

test("a late registration cannot reactivate a logged-out or switched context", async () => {
    let release; const s = fixture({gate: new Promise(resolve => {release = resolve;})});
    const registering = s.push.enable(scope); s.push.suspend(); release();
    assert.equal(await registering, false); assert.equal(s.push.active(scope), false);
    assert.equal(s.requests.length, 1); assert.equal(s.values.size, 0);
});

test("unconfigured server is explicit, disabling removes consent and the server binding", async () => {
    const unavailable = fixture({server: false}); await assert.rejects(unavailable.push.enable(scope), /servidor/);
    assert.equal(unavailable.values.size, 0);
    const s = fixture(); await s.push.enable(scope); await s.push.disable(scope);
    assert.equal(s.push.active(scope), false); assert.equal(s.values.size, 0);
    assert.equal(s.requests.at(-1)[1].method, "DELETE"); assert.equal(await s.push.sync(scope), false);
});

const hint = {v: 1, device_id: "00000000-0000-4000-8000-000000000001", binding: "00000000-0000-4000-8000-000000000002",
    assignment_id: "00000000-0000-4000-8000-000000000003", notification_id: "00000000-0000-4000-8000-000000000004"};
function workerFixture({allowed = true, status = 200, visible = false, sound = true} = {}) {
    const handlers = {}, shown = [], fetched = [], focused = [], opened = [];
    const self = {location: {origin: "https://bold.example"}, addEventListener: (name, run) => {handlers[name] = run;},
        registration: {showNotification: async (...args) => {shown.push(args);}},
        clients: {matchAll: async () => [{url: "https://bold.example/", visibilityState: visible ? "visible" : "hidden", focus: async () => focused.push(true)}],
            openWindow: async path => opened.push(path)}};
    vm.runInNewContext(readFileSync(new URL("./public/sw.js", import.meta.url), "utf8"), {self, URL, AbortController, setTimeout, clearTimeout,
        fetch: async (...args) => {fetched.push(args); return {ok: status === 200, json: async () => ({allowed, sound, actor_is_owner: true})};}});
    return {shown, fetched, focused, opened, async receive(data = hint) {let done; handlers.push({data: {json: () => data}, waitUntil: promise => {done = promise;}}); await done;},
        async click() {let done; handlers.notificationclick({notification: {close() {}, data: {url: "https://evil.example/"}}, waitUntil: promise => {done = promise;}}); await done;}};
}

test("actual worker resolves hints with current cookie and assignment; text and URLs never come from payload", async () => {
    const s = workerFixture(); await s.receive({...hint, title: "Private message", url: "https://evil.example/"});
    assert.equal(s.fetched.length, 1); const [url, options] = s.fetched[0];
    assert.equal(new URL(url).origin, "https://bold.example"); assert.equal(options.credentials, "include"); assert.equal(options.cache, "no-store");
    assert.equal(options.headers["X-Assignment-ID"], hint.assignment_id);
    assert.equal(s.shown.length, 1); assert.equal(s.shown[0][0], "BOLD · Propietario");
    assert.doesNotMatch(JSON.stringify(s.shown), /Private message|evil\.example/);
    assert.equal(s.shown[0][1].silent, false);
    await s.click(); assert.equal(s.focused.length, 1); assert.equal(s.opened.length, 0);
});

test("revoked, switched, read, malformed or offline hints cannot display stale account content", async () => {
    for (const setup of [{status: 401}, {status: 403}, {status: 404}, {allowed: false}]) {
        const s = workerFixture(setup); await s.receive(); assert.equal(s.shown.length, 0);
    }
    const s = workerFixture(); await s.receive({...hint, assignment_id: "untrusted"}); assert.equal(s.fetched.length, 0);
    const visible = workerFixture({visible: true}); await visible.receive(); assert.equal(visible.shown[0][1].silent, true);
    const muted = workerFixture({sound: false}); await muted.receive(); assert.equal(muted.shown[0][1].silent, true);
});
