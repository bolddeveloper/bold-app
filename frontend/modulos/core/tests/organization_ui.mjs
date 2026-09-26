// Run from frontend/modulos/core. Install jsdom in %TEMP%/bold-ui-check first.
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
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Swal } = await import("sweetalert2");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const load = file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\", "/")}`);
const { OrganizationManager, Audit } = await load("../administrativo/admin_module.jsx");
const { adminApi } = await load("../administrativo/admin_api.js");
const { coreApi } = await load("./core_api.js");
const { CalendarDateField, WorkspaceSelector } = await load("../tareas/src/task_app.jsx");
const data = {
    units: [{ id: "unit-1", name: "Dirección", positions: 1 }],
    roles: [{ id: "role-1", title: "Director", level: "Gerencia", description: "Responsable" }],
    positions: [{ id: "position-1", unit: "unit-1", job_role: "role-1", unit_name: "Dirección", role_title: "Director", occupant_name: "Ana", display_order: 1 }],
    unit_types: [{ id: "type-1", value: "department" }],
    sensitivity_levels: [{ id: "sensitivity-1", value: "normal" }],
    role_levels: [],
};
adminApi.organization = async () => data;
coreApi.stepUpMfa = async () => {};
const dialogs = [];
const answers = [];
Swal.fire = async options => { dialogs.push(options); return answers.shift() || { isConfirmed: false }; };
let updated, created;
adminApi.updateRole = async (id, body) => { updated = { id, ...body }; };
adminApi.createPosition = async body => { created = body; };
adminApi.createOrganizationOption = async body => {
    assert.equal(body.kind, "role_level");
    data.role_levels.push({ id: "level-1", value: body.value });
};
const root = createRoot(document.getElementById("root"));
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const button = text => [...document.querySelectorAll("button")].find(el => el.textContent.trim() === text);
const click = async element => { assert.ok(element, "Control exists"); element.click(); await settle(); };
async function select(label, text) {
    const trigger = document.querySelector(`[aria-label="${label}"]`);
    await click(trigger);
    await click([...trigger.parentElement.querySelectorAll('[role="option"]')].find(el => el.textContent === text));
}
try {
    root.render(React.createElement(OrganizationManager, { data }));
    await settle();
    await select("Tipo de registro", "Cargo");
    await click(document.querySelector('[aria-label="Nivel"]'));
    answers.push({ isConfirmed: true, value: "Operativo" });
    await click(button("+ Agregar nivel"));
    const validator = dialogs.find(dialog => dialog.title === "Agregar nivel").inputValidator;
    assert.ok(validator(" gerencia "), "Existing level ignores case and whitespace");
    assert.ok(validator("  "), "Empty level is rejected");
    assert.equal(validator("Técnico"), undefined);
    assert.equal(document.querySelector('[name="level"]').value, "Operativo");

    await click(document.querySelector('[aria-label="Desbloquear edición de cargos"]'));
    const mfaForm = document.querySelector(".admin_delete_level");
    mfaForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    const rolePanel = [...document.querySelectorAll(".admin_organization section")].find(el => el.textContent.includes("Cargos"));
    await click([...rolePanel.querySelectorAll("button")].find(el => el.textContent === "Editar"));
    const editor = document.querySelector(".admin_role_editor");
    assert.equal(editor.querySelector('[name="title"]').value, "Director");
    editor.querySelector('[name="title"]').value = "Director actualizado";
    editor.querySelector('[name="description"]').value = "Descripción nueva";
    editor.querySelector('[name="reason"]').value = "Ajuste de catálogo";
    await select("Nivel del cargo", "Operativo");
    answers.push({ isConfirmed: true });
    editor.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(updated.title, "Director actualizado");
    assert.equal(updated.description, "Descripción nueva");
    assert.equal(updated.level, "Operativo");
    assert.equal(updated.reason, "Ajuste de catálogo");

    await select("Tipo de registro", "Plaza");
    await select("Unidad", "Dirección");
    await select("Cargo", "Director");
    await click(document.querySelector(".admin_reporting > summary"));
    await select("Departamento de jefatura", "Dirección");
    await select("Cargo de jefatura", "Director");
    await select("Plaza de jefatura", "Director · Dirección · Ana");
    assert.equal(document.querySelector('.admin_reporting [name="reports_to_position"]').value, "position-1");
    const form = document.querySelector(".admin_catalog_form");
    form.querySelector('[name="reason"]').value = "Prueba de jefatura";
    answers.push({ isConfirmed: false });
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(created, undefined, "Cancel does not mutate the API");
    answers.push({ isConfirmed: true });
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(created.reports_to_position, "position-1");
    assert.equal(created.unit, "unit-1");
    assert.equal(created.job_role, "role-1");
    assert.equal(document.querySelector('.admin_reporting [name="reports_to_position"]').value, "", "The reporting selection resets after creation");

    root.render(React.createElement("form", null, React.createElement(CalendarDateField, { name: "expires", defaultValue: "2026-09-25T15:45", withTime: true, required: true })));
    await settle();
    await click(document.querySelector('[aria-label="Elegir fecha"]'));
    assert.equal(document.querySelector(".custom_datepicker_popover").getAttribute("popover"), "manual");
    await click(document.querySelector('[aria-label="26 septiembre 2026"]'));
    await click(button("Aplicar"));
    assert.equal(new FormData(document.querySelector("form")).get("expires"), "2026-09-26T15:45");
    assert.equal(document.querySelector(".custom_datepicker_popover"), null);
    document.querySelector("form").reset();
    await settle();
    assert.equal(new FormData(document.querySelector("form")).get("expires"), "2026-09-25T15:45");
    let workspaceOpened = 0, totalOpened = 0;
    root.render(React.createElement(WorkspaceSelector, { onManage: () => workspaceOpened++, onTotal: () => totalOpened++ }));
    await settle();
    await click(document.querySelector("summary"));
    assert.equal(workspaceOpened, 1, "A single Workspace click navigates");
    assert.equal(document.querySelector("details").open, true);
    await click(button("Vista total"));
    assert.equal(totalOpened, 1, "Secondary navigation remains accessible");
    root.render(React.createElement(Audit, { rows: [{ id: "event-1", module_code: "administration", event_type: "administration.job_role_created", actor_email: "owner@example.test", outcome: "success", target_type: "job_role", target_id: "role-1", correlation_id: "trace-1" }] }));
    await settle();
    assert.equal(document.querySelectorAll("tbody tr").length, 1);
    assert.ok(document.querySelector("td details").textContent.includes("trace-1"));
    assert.equal(document.querySelector(".admin_outcome").textContent, "Correcto");
    console.log("PASS: duplicate levels, role edit, confirmation cancellation, reporting relationship, reusable calendar and preserved time.");
} finally {
    root.unmount();
    await server.close();
    dom.window.close();
}
process.exit(0);
