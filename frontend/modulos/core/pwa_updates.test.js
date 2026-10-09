import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {watch_pwa_updates} from "./pwa_updates.js";
import {pwa_release} from "./vite.config.js";

function setup(controller = {}) {
    const registration = Object.assign(new EventTarget(), {updates: 0, update: async () => {registration.updates++;}});
    const container = Object.assign(new EventTarget(), {controller});
    const page = Object.assign(new EventTarget(), {visibilityState: "visible"});
    let clock = 0, connected = true, offer, reloads = 0, interval;
    const host = Object.assign(new EventTarget(), {setInterval: (fn, ms) => {assert.equal(ms, 1800000); interval = fn; return 1;}, clearInterval: () => {interval = null;}});
    const dispose = watch_pwa_updates(registration, {container, page, host, now: () => clock, online: () => connected,
        notify: fn => {offer = fn;}, reload: () => {reloads++;}});
    return {registration, container, page, host, dispose, tick: async minutes => {clock += minutes * 60000; await interval();},
        offline: () => {connected = false;}, get offer() {return offer;}, get reloads() {return reloads;}};
}

test("checks are throttled and skip hidden/offline windows", async () => {
    const s = setup(); await Promise.resolve();
    assert.equal(s.registration.updates, 1);
    await s.tick(1); assert.equal(s.registration.updates, 1);
    await s.tick(10); assert.equal(s.registration.updates, 2);
    s.page.visibilityState = "hidden"; await s.tick(30); assert.equal(s.registration.updates, 2);
    s.page.visibilityState = "visible"; s.offline(); await s.tick(30); assert.equal(s.registration.updates, 2);
    s.dispose();
});

test("waiting update activates and reloads only after explicit acceptance", async () => {
    const s = setup(); await Promise.resolve();
    const messages = [];
    s.registration.waiting = {postMessage: value => messages.push(value)};
    await s.tick(11);
    assert.equal(s.reloads, 0); assert.equal(messages.length, 0);
    s.offer(); s.offer(); assert.deepEqual(messages, [{type: "BOLD_SKIP_WAITING"}]);
    s.container.dispatchEvent(new Event("controllerchange")); assert.equal(s.reloads, 1);
    s.container.dispatchEvent(new Event("controllerchange")); assert.equal(s.reloads, 1);
    s.dispose();
});

test("another tab activating an update does not reload this tab's forms", async () => {
    const s = setup(); await Promise.resolve();
    s.container.dispatchEvent(new Event("controllerchange")); assert.equal(s.reloads, 0);
    s.offer(); assert.equal(s.reloads, 1); s.dispose();
});

test("first installation never requests a reload", () => {
    const s = setup(null); s.container.controller = {};
    s.container.dispatchEvent(new Event("controllerchange")); assert.equal(s.offer, undefined);
    s.container.dispatchEvent(new Event("controllerchange")); assert.equal(typeof s.offer, "function"); s.dispose();
});

test("each changed bundle produces a new SW release and precaches hashed assets", () => {
    function build(code) {let output; pwa_release().generateBundle.call({emitFile: value => {output = value.source;}}, {},
        {"assets/app-abc.js": {code}, "assets/app-abc.css": {source: "body{}"}}); return output;}
    assert.notEqual(build("one"), build("two"));
    assert.equal(build("one"), build("one"));
    assert.match(build("one"), /"\/assets\/app-abc.js"/);
    assert.doesNotMatch(build("one"), /__BOLD_PWA_RELEASE__|BUILD_ASSETS/);
});

test("SW bypasses API/WebSocket/health and revalidates navigation HTML", async () => {
    const listeners = {}, writes = [], network = [], waits = [];
    const cache = {put: async (...args) => writes.push(args), match: async () => new Response("offline-shell")};
    const context = {URL, Request, Response, caches: {open: async () => cache},
        self: {location: {origin: "https://bold.example"}, addEventListener: (name, fn) => {listeners[name] = fn;}},
        fetch: async request => {network.push(request); return new Response("fresh");}};
    vm.runInNewContext(readFileSync(new URL("./public/sw.js", import.meta.url), "utf8"), context);
    for (const path of ["/api/v2/tasks/", "/ws/unit/1/", "/health/", "/private", "https://other.example/image.png"]) {
        let handled = false;
        listeners.fetch({request: {method: "GET", url: path.startsWith("http") ? path : "https://bold.example" + path},
            respondWith: () => {handled = true;}});
        assert.equal(handled, false, path);
    }
    const request = new Request("https://bold.example/?project=123");
    Object.defineProperty(request, "mode", {value: "navigate"});
    let result;
    const event = {request, respondWith: promise => {result = promise;}, waitUntil: promise => waits.push(promise)};
    listeners.fetch(event); assert.equal(await (await result).text(), "fresh"); await Promise.all(waits);
    assert.equal(network[0].cache, "no-cache"); assert.equal(writes[0][0], "/index.html");
    context.fetch = async () => {throw new Error("offline");};
    listeners.fetch(event); assert.equal(await (await result).text(), "offline-shell");
    context.caches.open = async () => {throw new Error("storage unavailable");};
    context.fetch = async () => new Response("network without cache");
    listeners.fetch(event); assert.equal(await (await result).text(), "network without cache");
});

test("SW activation requires a message, claims clients and bounds only BOLD caches", async () => {
    const listeners = {}, deleted = []; let skipped = 0, claimed = 0, precached;
    const current = "bold_app_shell_v4___BOLD_PWA_RELEASE__";
    vm.runInNewContext(readFileSync(new URL("./public/sw.js", import.meta.url), "utf8"), {
        URL, Request: class {constructor(url, options) {this.url = url; this.cache = options.cache;}}, Response,
        self: {addEventListener: (name, fn) => {listeners[name] = fn;},
            skipWaiting: async () => {skipped++;}, clients: {claim: async () => {claimed++;}}},
        caches: {open: async () => ({addAll: async requests => {precached = requests;}}),
            keys: async () => ["unrelated", "bold_tasks_shell_v1", "bold_app_shell_v3", current],
            delete: async key => deleted.push(key)},
    });
    let pending; const event = {waitUntil: value => {pending = value;}};
    listeners.install(event); await pending; assert.equal(skipped, 0);
    assert.ok(precached.every(request => request.cache === "reload"));
    listeners.message({...event, data: {type: "BOLD_SKIP_WAITING"}}); await pending; assert.equal(skipped, 1);
    listeners.activate(event); await pending; assert.equal(claimed, 1);
    assert.deepEqual(deleted, ["bold_tasks_shell_v1"]);
});
