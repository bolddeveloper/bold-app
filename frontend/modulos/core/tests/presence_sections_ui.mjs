// Isolated component interaction tests; no real accounts/network/production data.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {pathToFileURL} from "node:url";
import {createServer} from "vite";
const {JSDOM} = await import(pathToFileURL(path.join(os.tmpdir(), "bold-ui-check/node_modules/jsdom/lib/api.js")));
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "FormData", "MutationObserver", "Element", "HTMLInputElement", "HTMLSelectElement", "CustomEvent"]) Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true});
window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => {const timer = originalTimeout(callback, delay, ...args); if (delay >= 600000) timer.unref?.(); return timer;};
const React = await import("react"), {createRoot} = await import("react-dom/client");
const server = await createServer({configFile: false, resolve: {dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"}, cacheDir: path.join(os.tmpdir(), "bold-presence-ui-vite"), optimizeDeps: {noDiscovery: true, include: [], entries: []}, server: {middlewareMode: true}, appType: "custom"});
const load = file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\", "/")}`);
const {default: PresencePreferences} = await load("../perfil/presence_preferences.jsx");
const {default: SectionDragHandle} = await load("../tareas/src/section_drag_handle.jsx");
const {http} = await load("./http_client.js");
const root = createRoot(document.getElementById("root"));
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
let saved, requests = 0;
http.request = async (url, options = {}) => {requests++; if (options.method === "PATCH") {saved = {...options.body}; return saved;} return {status: "online", title: "", description: "", calendar_automatic: true};};
function pointer(type, x, y, target = document) {
    const event = new window.Event(type, {bubbles: true, cancelable: true});
    for (const [key, value] of Object.entries({button: 0, pointerId: 1, clientX: x, clientY: y})) Object.defineProperty(event, key, {value});
    target.dispatchEvent(event);
}
try {
    root.render(React.createElement(PresencePreferences)); await settle();
    assert.equal(document.querySelectorAll('[name="presence-status"]').length, 7);
    document.querySelector('[value="busy"]').click(); await settle();
    document.querySelector("form").dispatchEvent(new window.Event("submit", {bubbles: true, cancelable: true})); await settle();
    assert.equal(saved.status, "busy"); assert.equal(saved.calendar_automatic, true);
    assert.match(document.querySelector('[role="status"]').textContent, /guardó/);
    document.querySelector('[value="custom"]').click(); await settle();
    assert.equal(document.querySelector('[maxlength="60"]').required, true);
    assert.equal(document.querySelector("textarea").maxLength, 160);
    document.querySelector('[value="offline"]').click(); await settle();
    document.querySelector("form").dispatchEvent(new window.Event("submit", {bubbles: true, cancelable: true})); await settle();
    assert.equal(saved.status, "offline");
    assert.equal(requests, 3, "One initial read, two explicit writes; no polling");

    const calls = []; let key;
    const handlers = {id: "source", label: "Entrega", view: "list", onStart: (event, id) => {calls.push("start"); event.dataTransfer.setData("application/x-bold-section", id);}, onOver: (event, id) => calls.push(`over:${id}`), onDrop: (event, id) => calls.push(`drop:${id}:${event.dataTransfer.getData("application/x-bold-section")}`), onEnd: () => calls.push("end"), onKeyDown: (event, id, view) => {key = [event.key, id, view];}};
    root.render(React.createElement("div", null, React.createElement("div", {"data-section-id": "source"}, React.createElement("div", {className: "task_group_header"}, React.createElement(SectionDragHandle, handlers))), React.createElement("div", {"data-section-id": "target"}, React.createElement("div", {className: "task_group_header"}, "Destino")))); await settle();
    const grip = document.querySelector(".section_drag_grip"), target = document.querySelector('[data-section-id="target"]');
    document.elementFromPoint = () => target;
    pointer("pointerdown", 10, 10, grip); pointer("pointermove", 12, 12); assert.deepEqual(calls, []);
    pointer("pointermove", 40, 40); await settle();
    assert.ok(document.querySelector(".section_drag_ghost"));
    pointer("pointerup", 40, 40); assert.deepEqual(calls, ["start", "over:target", "drop:target:source", "end"]);
    assert.equal(document.querySelector(".section_drag_ghost"), null);
    calls.length = 0;
    pointer("pointerdown", 10, 10, grip); pointer("pointermove", 40, 40);
    document.dispatchEvent(new window.KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    assert.ok(!calls.some(call => call.startsWith("drop:"))); assert.equal(document.querySelector(".section_drag_ghost"), null);
    grip.dispatchEvent(new window.KeyboardEvent("keydown", {key: "ArrowDown", altKey: true, bubbles: true}));
    assert.deepEqual(key, ["ArrowDown", "source", "list"]);
    calls.length = 0;
    pointer("pointerdown", 10, 10, grip); pointer("pointermove", 40, 40); root.unmount(); await settle();
    assert.equal(document.querySelector(".section_drag_ghost"), null, "Unmount cleans ghost and pointer handlers");
    console.log("Presence preferences and section grip: interaction, cancellation, keyboard, cleanup and request budget passed.");
} finally {await server.close(); dom.window.close();}
// Vite's SSR dependency runner may retain an esbuild IPC handle on Windows.
// Assertions and component teardown are complete before exiting successfully.
process.exit(0);
