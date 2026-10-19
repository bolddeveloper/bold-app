// Isolated component checks; never touches production users or data.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "FormData", "MutationObserver", "Element", "HTMLInputElement", "CustomEvent", "Event"]) Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true});
window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
const errors = []; window.addEventListener("error", event => errors.push(event.error || event.message));
globalThis.__brandTestCore = {account: {id: "account", is_superuser: true}, activeAssignment: {id: "assignment"}, permissions: {can: async () => true}, directory: []};
const React = await import("react"), {createRoot} = await import("react-dom/client");
const server = await createServer({configFile: false, plugins: [{name: "brand-test-core", enforce: "pre", transform(_, id) {
    if (id.replaceAll("\\", "/").endsWith("/core/core_provider.jsx")) return "export const useCore = () => globalThis.__brandTestCore;";
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"}, cacheDir: path.join(os.tmpdir(), "bold-brands-ui-vite"), optimizeDeps: {noDiscovery: true, include: [], entries: []}, server: {middlewareMode: true}, appType: "custom"});
const load = file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\", "/")}`);
const {default: Brands} = await load("../marcas/brands_module.jsx"), {brandsApi} = await load("../marcas/brands_api.js");
brandsApi.list = async () => ({results: [], next: null});
const root = createRoot(document.getElementById("root")), settle = () => new Promise(resolve => setTimeout(resolve, 80));
const button = text => [...document.querySelectorAll("button")].find(row => row.textContent === text);
let saves = 0, release;
brandsApi.save = async draft => {saves++; await new Promise(resolve => {release = resolve;}); return {...draft, id: "brand", revision: 1, owner: "account", member_ids: [], unit_name: "Dirección", owner_name: "Luis"};};
try {
    root.render(React.createElement(Brands)); await settle();
    button("Nueva marca").click(); await settle();
    const name = [...document.querySelectorAll("label")].find(label => label.firstChild?.textContent === "Nombre").querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(name, "Marca de prueba"); name.dispatchEvent(new dom.window.Event("input", {bubbles: true})); await settle();
    const form = document.querySelector("form");
    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
    form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true})); await settle();
    assert.equal(saves, 1); assert.equal(button("Guardando…").disabled, true);
    release(); await settle(); assert.equal(document.querySelector("form"), null);
    button("Editar marca").click(); await settle();
    brandsApi.save = async () => {const failure = new Error("conflict"); failure.status = 409; throw failure;};
    document.querySelector("form").dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true})); await settle();
    assert.ok(document.querySelector("form")); assert.match(document.querySelector('[role="alert"]').textContent, /Conservamos tu formulario/);
    assert.equal(errors.length, 0);
    root.unmount();
    console.log("Brands UI: create/edit, duplicate-submit protection and conflict draft preservation passed.");
} finally {await server.close(); dom.window.close(); delete globalThis.__brandTestCore;}
process.exit(0);
