// Run from frontend/modulos/core; reuses the isolated jsdom test dependency.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const { JSDOM } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-ui-check/node_modules/jsdom/lib/api.js")));
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost:5174" });
for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "FormData", "MutationObserver", "Element", "HTMLInputElement", "HTMLSelectElement"]) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = originalSetTimeout(callback, delay, ...args);
    if (delay >= 600000) timer.unref?.();
    return timer;
};
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Swal } = await import("sweetalert2");
const server = await createServer({ cacheDir: path.join(os.tmpdir(), "bold-role-delegation-ui-vite"), server: { middlewareMode: true }, appType: "custom" });
const load = file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\", "/")}`);
const { OrganizationManager } = await load("../administrativo/admin_module.jsx");
const { adminApi } = await load("../administrativo/admin_api.js");
const { coreApi } = await load("./core_api.js");
const data = {
    units: [{ id: "direction", name: "Dirección", positions: 0, is_control_plane: true }],
    roles: [{ id: "assistant", title: "Asistente operativo", administration_enabled: false, permissions_enabled: false },
        { id: "owner", title: "Propietario", owner_protected: true }],
    positions: [], unit_types: [], sensitivity_levels: [], role_levels: [],
};
let saved, refreshed = 0, mfaChecks = 0;
adminApi.organization = async () => data;
adminApi.setRoleModuleAccess = async (id, body) => { saved = { id, ...body }; Object.assign(data.roles[0], body); };
coreApi.stepUpMfa = async () => { mfaChecks++; };
Swal.fire = async () => ({ isConfirmed: true });
const root = createRoot(document.getElementById("root"));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const button = text => [...document.querySelectorAll("button")].find(el => el.textContent.trim() === text);
const click = async element => { assert.ok(element, "Control exists"); element.click(); await settle(); };
const accessLabel = "Acceso a Administración y Permisos";
try {
    root.render(React.createElement(OrganizationManager, { data, isOwner: true, refreshDirectory: async () => { refreshed++; } }));
    await settle();
    await click(button("Catálogos"));
    await click(document.querySelector(".admin_catalog_roles article .admin_widget_trigger"));
    await click(button(accessLabel));
    assert.ok(document.querySelector(".admin_delete_level"), "Owner must unlock with MFA first");
    assert.equal(document.querySelector(".admin_role_module_access"), null);
    document.querySelector('.admin_delete_level [name="code"]').value = "123456";
    document.querySelector(".admin_delete_level").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(mfaChecks, 1);
    await click(document.querySelector(".admin_catalog_roles article .admin_widget_trigger"));
    await click(button(accessLabel));
    const editor = document.querySelector(".admin_role_module_access");
    assert.ok(editor);
    editor.querySelector('[name="administration_enabled"]').checked = true;
    editor.querySelector('[name="permissions_enabled"]').checked = false;
    editor.querySelector('[name="reason"]').value = "Autorizar gestión de empleados";
    editor.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    assert.deepEqual(saved, { id: "assistant", administration_enabled: true, permissions_enabled: false, reason: "Autorizar gestión de empleados" });
    assert.equal(refreshed, 1);
    assert.equal(document.querySelector(".admin_role_module_access"), null);
    const articles = document.querySelectorAll(".admin_catalog_roles article");
    await click(articles[1].querySelector(".admin_widget_trigger"));
    assert.equal(button(accessLabel), undefined, "Owner role cannot be delegated or revoked");
    root.render(React.createElement(OrganizationManager, { key: "delegate", data, isOwner: false }));
    await settle();
    await click(button("Catálogos"));
    await click(document.querySelector(".admin_catalog_roles article .admin_widget_trigger"));
    assert.equal(button(accessLabel), undefined, "Delegates cannot configure module access");
    console.log("Role module delegation UI: MFA, independent toggles, refresh and owner-only visibility passed.");
} finally {
    root.unmount(); await server.close(); dom.window.close();
    globalThis.setTimeout = originalSetTimeout;
}
