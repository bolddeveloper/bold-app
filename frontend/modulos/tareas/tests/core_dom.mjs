// Deterministic integration: two assignments, stale REST, sockets, 401/403 and logout.
// Uses the same optional temporary jsdom install as v2_dom.mjs.
import { createServer } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const { JSDOM } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-v2-dom/node_modules/jsdom/lib/api.js")).href);
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost:5173" });
for (const key of ["window", "document", "localStorage", "sessionStorage", "FormData", "MouseEvent", "HTMLElement", "Event"]) globalThis[key] = dom.window[key];
globalThis.dispatchEvent = window.dispatchEvent.bind(window);
window.matchMedia = () => ({ matches: false });
const sockets = [], requests = [];
globalThis.WebSocket = class {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
    addEventListener() {}
    close() { this.closed = true; }
};
const assignments = ["a", "b"].map(id => ({ id, employee: "person", employee_name: "Ana", unit: "unit-" + id, unit_name: "Unidad " + id, job_role_title: "Cargo " + id, is_active: true }));
let delayed = null, deferTasks = false, taskStatus = 200;
globalThis.fetch = async (url, options) => {
    const resource = new URL(url).pathname.replace("/api/v2/", "").replace(/\/$/, "");
    const assignment = options.headers["X-Assignment-ID"];
    requests.push({ resource, assignment, options });
    if (resource === "core/auth/token") return Response.json({ token: "test-token" });
    assert.equal(options.headers.Authorization, "Token test-token");
    if (resource === "core/user-accounts") return Response.json([{ id: "account", email: "ana@bold.gt", employee: "person" }]);
    if (resource === "core/employees/person") return Response.json({ id: "person", first_name: "Ana" });
    if (resource === "core/position-assignments" || resource === "core/position-assignments/directory") return Response.json(assignments);
    if (resource === "core/organizational-units") return Response.json(assignments.map(item => ({ id: item.unit, name: item.unit_name })));
    if (resource === "core/authorize") return Response.json({ allowed: JSON.parse(options.body).target_unit === "unit-" + assignment });
    const task = { id: "task-" + assignment, title: "Tarea exclusiva " + assignment, unit: "unit-" + assignment, status: "status-" + assignment, priority: "medium" };
    if (resource === "projects") return Response.json([{ id: "project-" + assignment, name: "Proyecto " + assignment, unit: "unit-" + assignment }]);
    if (resource === "task-statuses") { const unit = new URL(url).searchParams.get("unit"); return Response.json([{ id: "status-" + unit.slice(-1), name: "Pendiente", unit, is_final: false }]); }
    if (resource === "task-projects") return Response.json([{ id: "link-" + assignment, task: task.id, project: "project-" + assignment, position: "1000", section: null }]);
    if (resource === "tasks") {
        if (deferTasks) { deferTasks = false; return new Promise(resolve => { delayed = { resolve: () => resolve(Response.json([task])), signal: options.signal }; }); }
        return taskStatus === 200 ? Response.json([task]) : Response.json({ detail: "Test denial" }, { status: taskStatus });
    }
    return Response.json([]);
};
process.env.VITE_USE_REAL_BACKEND = "true";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const App = (await server.ssrLoadModule("/src/app.jsx")).default;
const store = await server.ssrLoadModule("/src/core/core_store.js");
const http = (await server.ssrLoadModule("/src/core/http_client.js")).http;
let root = createRoot(document.getElementById("root"));
const errors = [], originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check, label) { const end = Date.now() + 12000; while (!check()) { if (Date.now() > end) throw new Error(label + ": " + document.body.textContent.slice(0, 1400)); await pause(); } }
function select(el, value) { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); }
async function login() {
    await until(() => document.querySelector('[name="email"]'), "login");
    document.querySelector('[name="email"]').value = "ana@bold.gt";
    document.querySelector('[name="password"]').value = "test";
    document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => document.querySelector("select"), "assignment selection");
    select(document.querySelector("select"), "a");
    await until(() => document.body.textContent.includes("Tarea exclusiva a"), "assignment a data");
}
try {
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await login();
    assert.equal(store.getCoreState().employee.id, "person");
    assert.equal(store.getCoreState().activeUnit.id, "unit-a");
    assert.equal(requests.filter(item => item.resource === "core/position-assignments/directory").length, 1);
    await until(() => sockets.length === 1, "socket a");
    deferTasks = true; window.dispatchEvent(new Event("focus"));
    await until(() => delayed, "pending old request");
    select(document.querySelector('[aria-label="Asignación activa"]'), "b");
    await until(() => document.body.textContent.includes("Tarea exclusiva b"), "assignment b data");
    assert.equal(delayed.signal.aborted, true); delayed.resolve(); await pause();
    assert.ok(!document.body.textContent.includes("Tarea exclusiva a"));
    assert.equal(store.getCoreState().activeUnit.id, "unit-b");
    assert.equal(http.getSession().assignmentId, "b");
    assert.equal(sockets[0].closed, true);
    await until(() => sockets.length === 2, "socket b");
    assert.equal(new URL(sockets[1].url).searchParams.get("assignment"), "b");
    console.log("CORE PASS: Employee, shared directory, assignment/unit/header, stale request isolation and socket disposal");
    root.unmount(); root = createRoot(document.getElementById("root"));
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await until(() => document.body.textContent.includes("Tarea exclusiva b"), "restored b");
    assert.equal(store.getCoreState().activeAssignment.id, "b");
    taskStatus = 403; window.dispatchEvent(new Event("focus"));
    await until(() => document.body.textContent.includes("Test denial"), "403 shown");
    assert.equal(http.getSession().token, "test-token");
    taskStatus = 401; window.dispatchEvent(new Event("focus"));
    await until(() => document.querySelector('[name="email"]'), "global 401 login");
    assert.equal(http.getSession().token, null); assert.equal(store.getCoreState().activeAssignment, null);
    assert.equal(sessionStorage.getItem("bold_v2_session"), null);
    assert.ok(sockets.every(socket => socket.closed));
    taskStatus = 200; await login();
    [...document.querySelectorAll("button")].find(button => button.textContent === "Cerrar sesión").click();
    await until(() => document.querySelector('[name="email"]'), "explicit logout");
    assert.ok(!document.body.textContent.includes("Tarea exclusiva"));
    assert.equal(http.getSession().token, null); assert.deepEqual(store.getCoreState().directory, []);
    assert.deepEqual(errors, []);
    console.log("CORE PASS: restore selected assignment, 403 preserves session, 401 and logout clear Tasks/identity/token");
} finally { delayed?.resolve(); root.unmount(); await server.close(); dom.window.close(); console.error = originalError; }
