// Real editor and edit form, isolated from APIs. This measures work, not Mac latency.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "navigator", "Node", "DOMParser", "HTMLElement", "Element", "HTMLInputElement", "Event", "MouseEvent", "InputEvent"])
    Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true, writable: true});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react"), {act} = React, {createRoot} = await import("react-dom/client");
const server = await createServer({configFile: false, plugins: [{name: "isolated-task-description", enforce: "pre", transform(source, id) {
    const file = id.replaceAll("\\", "/");
    if (file.endsWith("/tareas/src/voice_notes.jsx")) return "export const VoiceNotes = () => null;";
    if (file.endsWith("/tareas/src/image_gallery.jsx")) return "export const ImageGallery = () => null;";
    if (file.endsWith("/tareas/src/task_app.jsx")) {
        // Keep the actual form and its callbacks; replace unrelated modules with inert controls.
        const start = source.indexOf("function EditTaskModal("), end = source.indexOf("function read_task_creation_draft(", start);
        assert.ok(start >= 0 && end > start);
        return `import {useState as use_state,useRef as use_ref,useEffect as use_effect} from 'react';
            import {TaskTextEditor} from './task_text_editor.jsx';
            const is_using_real_backend=()=>false,project_items=[],priority_items=[],render_icon=()=>null;
            const x_icon=0,columns_icon=0,calendar_days_icon=0,check_icon=0,trash_icon=0,plus_icon=0;
            const TaskSelect=()=>null,CustomDatePicker=()=>null,TaskIdentityFields=()=>null,CollaboratorsSelector=()=>null,
                PipelineFields=()=>null,RecurrenceFields=()=>null,AttachmentLinks=()=>null;
            const TaskDrawer=({children})=><section>{children}</section>;
            ${source.slice(start, end)} export {EditTaskModal};`;
    }
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"},
    cacheDir: path.join(os.tmpdir(), "bold-task-description-typing-ui"), optimizeDeps: {noDiscovery: true, include: [], entries: []},
    server: {middlewareMode: true, hmr: false}, appType: "custom"});
const root = createRoot(document.getElementById("root"));
let parses = 0;
class CountingParser extends dom.window.DOMParser {parseFromString(...args) {parses++; return super.parseFromString(...args);}}
globalThis.DOMParser = CountingParser;
try {
    const {EditTaskModal} = await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/task_app.jsx").replaceAll("\\", "/")}`);
    let parentRenders = 0, sent, closed = false;
    const source = "<!--bold-rich-text-->" + Array.from({length: 350}, (_, i) => `<p><b>Bloque ${i}</b> y <a href="https://example.com/${i}">Guía</a></p>`).join("") + "<p>Final</p>";
    function Parent() {
        parentRenders++;
        const [draft, setDraft] = React.useState({id: "task-a", title: "Una tarea", description: source});
        return React.createElement(EditTaskModal, {edit_draft: draft, edit_attachments: [], board_columns: [], projects: [], status_options: [],
            handle_edit_field_change: (field, value) => setDraft(current => ({...current, [field]: value})),
            on_save: (event, fields) => {event.preventDefault(); sent = {...draft, ...fields};}, on_cancel: () => {closed = true;}});
    }
    await act(async () => root.render(React.createElement(Parent)));
    const editor = document.querySelector('[role="textbox"]'); editor.focus();
    const first = editor.firstChild, beforeRenders = parentRenders, beforeParses = parses;
    const range = document.createRange(); range.selectNodeContents(editor.lastChild); range.collapse(false);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    const type = text => {editor.lastChild.textContent += text; const r = document.createRange(); r.selectNodeContents(editor.lastChild); r.collapse(false); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); editor.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));};
    await act(async () => {for (const text of " sin perder letras") type(text);});
    assert.equal(parses, beforeParses, "No whole-document parser per key during a typing burst");
    assert.equal(parentRenders, beforeRenders, "Description typing must not rerender TaskApp's parent");
    assert.equal(editor.firstChild, first, "Do not replace the live document/caret on typing");
    await act(async () => document.querySelector("form").dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
    assert.match(sent.description, /Final sin perder letras/);
    assert.equal(parses, beforeParses + 1, "Immediate submit serializes exactly once, including the last key");
    assert.equal(parentRenders, beforeRenders);
    assert.equal(editor.firstChild, first);
    await act(async () => {type(" después"); await new Promise(resolve => setTimeout(resolve, 190));});
    assert.equal(parentRenders, beforeRenders, "Idle serialization stays local to the edit form");
    // Updating another field must not restore the old description from the parent.
    const title = document.querySelector('input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {setter.call(title, "Otro título"); title.dispatchEvent(new Event("input", {bubbles: true}));});
    assert.match(editor.textContent, /Final sin perder letras después/);
    await act(async () => {type(" ahora"); document.querySelector('button[data-drawer-close]').click();});
    assert.equal(closed, true); assert.match(editor.textContent, /después ahora/);
    console.log("350-block task description: zero parse/parent render per typing burst; one immediate submit parse; idle, other-field update and close retain final text.");

    // Direct editor lifecycle: latest callback, IME, hidden page and unmount flush.
    const {TaskTextEditor} = await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/task_text_editor.jsx").replaceAll("\\", "/")}`);
    const handle = React.createRef(); let committed = [];
    await act(async () => root.render(React.createElement(TaskTextEditor, {value: "", onChange: next => committed.push(next), changeDelay: 160, draftRef: handle})));
    const field = document.querySelector('[role="textbox"]');
    await act(async () => {field.textContent = "日本"; field.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: true}));});
    assert.equal(committed.length, 0, "Do not transform text during IME composition");
    await act(async () => {field.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: false}));});
    await act(async () => handle.current.flush());
    assert.match(committed.at(-1), /日本/);
    await act(async () => {field.textContent = "Pestaña oculta"; field.dispatchEvent(new InputEvent("input", {bubbles: true})); window.dispatchEvent(new Event("pagehide"));});
    assert.match(committed.at(-1), /Pestaña oculta/);
    await act(async () => {field.textContent = "Última letra"; field.dispatchEvent(new InputEvent("input", {bubbles: true})); root.unmount();});
    assert.match(committed.at(-1), /Última letra/);
    assert.equal(handle.current, null);
    console.log("Editor lifecycle: IME untouched during composition; explicit/pagehide/unmount flush preserve latest input.");
} finally {await act(async () => root.unmount()); await server.close(); dom.window.close();}
