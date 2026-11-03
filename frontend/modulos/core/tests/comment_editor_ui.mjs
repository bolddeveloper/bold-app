// Isolated interaction checks, no backend or production account.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "navigator", "Node", "DOMParser", "FileReader", "File", "HTMLElement", "MutationObserver", "Element", "HTMLInputElement", "Event", "MouseEvent"]) Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true});
globalThis.BroadcastChannel = undefined;
const React = await import("react"), {act} = React, {createRoot} = await import("react-dom/client");
const server = await createServer({configFile: false, plugins: [{name: "isolated-comments", enforce: "pre", transform(_, id) {
    const file = id.replaceAll("\\", "/");
    if (file.endsWith("/tareas/src/voice_notes.jsx")) return "export const VoiceNotes = () => null;";
    if (file.endsWith("/tareas/src/image_gallery.jsx")) return "export const ImageGallery = () => null;";
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"}, cacheDir: path.join(os.tmpdir(), "bold-comment-editor-ui"), optimizeDeps: {noDiscovery: true, include: [], entries: []}, server: {middlewareMode: true, hmr: false}, appType: "custom"});
const root = createRoot(document.getElementById("root")), settle = () => new Promise(resolve => setTimeout(resolve, 40));
const waitFor = async check => {const until=Date.now()+4000;while(!check() && Date.now()<until)await settle();assert.ok(check());};
let value = "", received = [], release;
document.execCommand = (command, _, argument) => {
    const selection = window.getSelection(), range = selection.getRangeAt(0); range.deleteContents();
    if (command === "insertText") { const node = document.createTextNode(argument); range.insertNode(node); range.setStartAfter(node); }
    else if (command === "insertHTML") { const fragment = range.createContextualFragment(argument); const last = fragment.lastChild; range.insertNode(fragment); range.setStartAfter(last); }
    else throw new Error(command);
    range.collapse(true); selection.removeAllRanges(); selection.addRange(range); return true;
};
const transferEvent = (kind, transfer, editor) => {
    const event = new Event(kind, {bubbles: true, cancelable: true});
    Object.defineProperty(event, kind === "paste" ? "clipboardData" : "dataTransfer", {value: transfer});
    editor.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
};
try {
    const {TaskTextEditor} = await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/task_text_editor.jsx").replaceAll("\\", "/")}`);
    const render = disabled => root.render(React.createElement(TaskTextEditor, {value, label: "Comentario", onChange: next => {value = next;}, disabled,
        onFiles: async event => {received.push([...event.target.files]); await new Promise(resolve => {release = resolve;});}}));
    await act(async () => render(false));
    const editor = document.querySelector('[role="textbox"]'); editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); window.getSelection().addRange(range);
    transferEvent("paste", {files: [], getData: () => "https://example.com/demo"}, editor); await settle();
    assert.ok(editor.querySelector("a"), `Pasted link was not recognized: ${editor.innerHTML}`);
    assert.equal(editor.querySelector("a").getAttribute("href"), "https://example.com/demo");
    const image = new File(["image"], "sample.png", {type: "image/png"});
    transferEvent("paste", {files: [image]}, editor);
    transferEvent("drop", {files: [image], types: ["Files"]}, editor); await settle();
    assert.equal(received.length, 1); assert.equal(received[0][0], image);
    assert.equal(document.querySelector('input[type="file"]').disabled, true);
    release(); await settle();
    transferEvent("drop", {files: [image], types: ["Files"]}, document.querySelector('.task_editor_toolbar')); await settle(); assert.equal(received.length, 2,'dropping outside the editable body uses the same validated image handler');
    release(); await settle();
    transferEvent("paste", {files: [new File(["x"], "unsafe.svg", {type: "image/svg+xml"})]}, editor); await settle();
    assert.match(document.querySelector('[role="alert"]').textContent, /PNG/); assert.equal(received.length, 2);
    document.querySelector('[aria-label="Insertar enlace"]').click(); await settle();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (const [label, text] of [["Dirección del enlace", "https://example.com/long"], ["Alias del enlace", "Guía"]]) {
        const input = document.querySelector(`[aria-label="${label}"]`); setter.call(input, text); input.dispatchEvent(new Event("input", {bubbles: true})); await settle();
    }
    [...document.querySelectorAll("button")].find(button => button.textContent === "Insertar").click(); await settle();
    assert.ok([...editor.querySelectorAll("a")].some(a => a.textContent === "Guía" && a.getAttribute("href") === "https://example.com/long"));
    await act(async () => render(true)); transferEvent("paste", {files: [image]}, editor); await settle(); assert.equal(received.length, 2);
    const {updateCore}=await server.ssrLoadModule(path.resolve('core_store.js'));
    updateCore({directory:Array.from({length:6},(_,index)=>({id:`person-${index}`,name:`Persona ${index}`,email:`person${index}@example.test`}))});
    let sent=0,scrolled;
    HTMLElement.prototype.scrollIntoView=function(){scrolled=this.id;};
    root.render(React.createElement(TaskTextEditor,{value:'',label:'Comentario',compact:true,onChange:next=>{value=next;},onSubmit:()=>sent++}));await settle();
    const mentionEditor=document.querySelector('[role="textbox"]');mentionEditor.focus();mentionEditor.textContent='Hola @';
    const mentionRange=document.createRange();mentionRange.selectNodeContents(mentionEditor);mentionRange.collapse(false);
    window.getSelection().removeAllRanges();window.getSelection().addRange(mentionRange);
    mentionEditor.dispatchEvent(new Event('input',{bubbles:true}));await settle();
    const options=[...document.querySelectorAll('.task_mention_options [role="option"]')];assert.equal(options.length,6);
    assert.equal(document.querySelectorAll('.task_mention_avatar').length,6);
    mentionEditor.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await settle();
    assert.equal(options.at(-1).getAttribute('aria-selected'),'true');assert.equal(scrolled,options.at(-1).id);
    mentionEditor.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();
    assert.equal(document.querySelector('.task_mention_menu'),null);assert.match(value,/@person5@example\.test/);assert.equal(sent,0);
    updateCore({directory:[]});
    const {CommentItem, TaskActionsContext} = await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/comment_item.jsx").replaceAll("\\", "/")}`);
    let allowed = true;
    const renderComment = () => root.render(React.createElement(TaskActionsContext.Provider, {value: {canManageComment: () => allowed}},
        React.createElement(CommentItem, {comment: {id: "test-comment", body: "Mi texto", created_at: "2026-10-14T12:00:00Z"}, author: "Autor"})));
    renderComment(); await settle();
    assert.ok(document.querySelector('[aria-label="Editar comentario"]'));
    assert.ok(document.querySelector('[aria-label="Eliminar comentario"]'));
    document.querySelector('[aria-label="Editar comentario"]').click(); await settle();
    assert.ok(document.querySelector('[role="textbox"]'));
    allowed = false; renderComment(); await settle();
    assert.equal(document.querySelector('[aria-label="Editar comentario"]'), null);
    assert.equal(document.querySelector('[aria-label="Eliminar comentario"]'), null);
    assert.equal(document.querySelector('[role="textbox"]'), null);
    assert.match(document.querySelector("article").textContent, /Mi texto/);
    console.log("Comment UI: links, images, mention keyboard selection without sending and author-only actions passed.");
} finally {root.unmount(); await server.close(); dom.window.close();}
