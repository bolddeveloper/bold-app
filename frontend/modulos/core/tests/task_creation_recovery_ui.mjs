// Actual task creation form + durable boundary. API/storage transport is isolated.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "navigator", "Node", "DOMParser", "HTMLElement", "Element", "HTMLInputElement", "Event", "MouseEvent", "InputEvent", "sessionStorage"])
    Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true, writable: true});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react"), {act} = React, {createRoot} = await import("react-dom/client");
let stored = null, opens = 0, removed = false, holdNextSave = false, releaseDelayed;
globalThis.__openTaskDraft = async () => {
    opens++; let active = true;
    return {isActive: () => active, recover: async () => stored ? {payload: structuredClone(stored)} : null,
        save: async payload => {if (holdNextSave) {holdNextSave = false; await new Promise(resolve => {releaseDelayed = resolve;});} stored = structuredClone(payload); return true;}, clear: async () => {stored = null; removed = true; return true;}, close: () => {active = false;}};
};
const server = await createServer({configFile: false, plugins: [{name: "isolated-task-recovery", enforce: "pre", transform(source, id) {
    const file = id.replaceAll("\\", "/");
    if (file.endsWith("/tareas/src/task_drafts.js")) return `${source.slice(source.indexOf("export function createTaskDraftController("))}\nexport const openTaskCreationDraft = globalThis.__openTaskDraft;`;
    if (file.endsWith("/core/shared/bold_dialog.js")) return "export const confirmBold = async () => true;";
    if (file.endsWith("/tareas/src/voice_notes.jsx")) return "export const VoiceNotes = () => null;";
    if (file.endsWith("/tareas/src/image_gallery.jsx")) return "export const ImageGallery = () => null;";
    if (file.endsWith("/tareas/src/task_app.jsx")) {
        const start = source.indexOf("function read_task_creation_draft("), end = source.indexOf("// ─", start);
        assert.ok(start >= 0 && end > start);
        return `import {useState as use_state,useRef as use_ref,useEffect as use_effect} from 'react';
            import {TaskTextEditor} from './task_text_editor.jsx';
            import {preferredSection} from './section_order.js';
            const is_using_real_backend=()=>false,project_items=[],priority_items=[],render_icon=()=>null;
            const x_icon=0,columns_icon=0,calendar_days_icon=0,plus_icon=0;
            const TaskSelect=()=>null,CustomDatePicker=()=>null,TaskIdentityFields=()=>null,CollaboratorsSelector=()=>null,
                PipelineFields=()=>null,RecurrenceFields=()=>null,AttachmentLinks=()=>null;
            const TaskDrawer=({children})=><section>{children}</section>,month_abbrev_es=Array(12).fill('mes'),toISODate=()=>null;
            ${source.slice(start, end)} export {CreateTaskModal};`;
    }
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"},
    cacheDir: path.join(os.tmpdir(), "bold-task-creation-recovery-ui"), optimizeDeps: {noDiscovery: true, include: [], entries: []},
    server: {middlewareMode: true, hmr: false}, appType: "custom"});
let root = createRoot(document.getElementById("root"));
try {
    const load = file => server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll("\\", "/")}`);
    const {CreateTaskModal} = await load("../tareas/src/task_app.jsx"), {TaskCreationDraft} = await load("../tareas/src/task_creation_draft.jsx");
    const {protectPrivateWork} = await load("shared/private_work.js");
    let submitted, sent = 0, closed = 0;
    const render = async () => {
        await act(async () => {
            root.render(React.createElement(TaskCreationDraft, {assignmentId: "assignment-a", legacyKey: "legacy", onClose: () => {closed++;}},
                draft_state => React.createElement(CreateTaskModal, {draft_state, draft_storage_key: "legacy", board_columns: [], personal_columns: [], status_options: [], projects: [],
                    currentAssignmentId: "assignment-a", on_cancel: () => {closed++;}, on_create: async (task, snapshot, protect) => {
                        sent++; submitted = task; await protect({...snapshot, _submitted: true}); return "queued";
                    }})));
            await new Promise(resolve => setImmediate(resolve));
        });
    };
    await render();
    const title = document.querySelector('input[placeholder="¿Qué hay que hacer?"]'), editor = document.querySelector('[role="textbox"]');
    assert.ok(title && editor, document.body.innerHTML);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
        setter.call(title, "Borrador entre módulos"); title.dispatchEvent(new Event("input", {bubbles: true}));
        editor.textContent = "Últimas letras antes de salir"; editor.dispatchEvent(new InputEvent("input", {bubbles: true}));
        assert.equal(await protectPrivateWork(), true, "Logout/update must wait for encrypted checkpoint");
    });
    // The second explicit protection uses the render committed by the title input.
    await act(async () => assert.equal(await protectPrivateWork(), true));
    assert.equal(stored.title, "Borrador entre módulos"); assert.match(stored.description, /Últimas letras antes de salir/);
    assert.equal(sessionStorage.getItem("legacy"), null, "No new plaintext task drafts in session storage");
    holdNextSave = true;
    await act(async () => {
        editor.textContent += " antes de cambiar de módulo"; editor.dispatchEvent(new InputEvent("input", {bubbles: true}));
        root.unmount();
    });
    let protectedAfterUnmount = false;
    const protectedExit = protectPrivateWork().then(result => {protectedAfterUnmount = true; return result;});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(protectedAfterUnmount, false, "Immediate logout must still await the unmounted form's pending write");
    assert.equal(typeof releaseDelayed, "function"); releaseDelayed();
    assert.equal(await protectedExit, true); assert.match(stored.description, /antes de cambiar de módulo/);
    root = createRoot(document.getElementById("root")); await render();
    assert.equal(opens, 2); assert.equal(document.querySelector('input[placeholder="¿Qué hay que hacer?"]').value, "Borrador entre módulos");
    assert.match(document.querySelector('[role="textbox"]').textContent, /Últimas letras antes de salir/);
    assert.equal(sent, 0, "Recovery never sends a task by itself");
    await act(async () => document.querySelector("form").dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
    assert.equal(sent, 1); assert.match(submitted.description, /Últimas letras antes de salir/); assert.equal(stored._submitted, true);
    await act(async () => root.unmount()); root = createRoot(document.getElementById("root")); await render();
    assert.match(document.body.textContent, /tuvo un intento de envío/); assert.equal(document.querySelector("form"), null); assert.equal(sent, 1);
    const discard = [...document.querySelectorAll("button")].find(button => button.textContent === "Descartar borrador");
    await act(async () => discard.click()); assert.equal(removed, true); assert.equal(stored, null); assert.equal(closed, 1);
    console.log("Actual creation form: checkpoint before logout, full remount recovery, no plaintext, no automatic resend, pending-send review and explicit discard passed.");
} finally {await act(async () => root.unmount()); await server.close(); dom.window.close(); delete globalThis.__openTaskDraft;}
