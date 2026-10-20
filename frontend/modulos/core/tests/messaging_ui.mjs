import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
import {installMessagingFixture} from "./messaging_fixture.js";

const replacements = [
    ["/core/core_provider.jsx", "export const useCore = () => globalThis.__messagingCore;"],
    ["/core/app_shell.jsx", "export const useShell = () => globalThis.__messagingShell;"],
    ["/core/http_client.js", "export const is_using_real_backend = () => true; export const http = {request: async () => {throw Error('No network in fixture');}};"],
    ["/mensajeria/messaging_api.js", "export const messagingApi = globalThis.__messagingApi;"],
    ["/tareas/src/task_text_editor.jsx", "export const TaskText = ({value}) => value;"],
];
const server = await createServer({configFile: false, plugins: [{name: "isolated-messaging", enforce: "pre", transform(_, id) {
    return replacements.find(([suffix]) => id.replaceAll("\\", "/").endsWith(suffix))?.[1];
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"}, cacheDir: path.join(os.tmpdir(), "bold-messaging-ui"),
    optimizeDeps: {noDiscovery: true, include: process.argv.includes("--serve") ? ["react", "react/jsx-dev-runtime", "react/jsx-runtime", "react-dom", "react-dom/client", "lucide-react"] : [], entries: []}, server: process.argv.includes("--serve") ? {port: 5186, host: "127.0.0.1", strictPort: true, fs: {allow: [path.resolve("..")]}} : {middlewareMode: true, hmr: false}, appType: "custom"});

if (process.argv.includes("--serve")) {
    // Serve a transformed HTML entry so Vite rewrites the bare module imports.
    server.middlewares.use(async (request, response, next) => {
        if (request.url.split("?")[0] !== "/") return next();
        const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLD · Prueba aislada</title><style>body{margin:0}#root{padding-top:4px}.messaging_module{height:calc(100dvh - 32px)!important}</style></head><body><div id="root"></div><script type="module">
            import React from 'react'; import {createRoot} from 'react-dom/client';
            import {installMessagingFixture} from '/tests/messaging_fixture.js';
            import '/@fs/${path.resolve("../tareas/src/styles.css").replaceAll("\\", "/")}';
            import '/@fs/${path.resolve("../tareas/src/theme_rework.css").replaceAll("\\", "/")}';
            import '/app_shell.css'; import '/shared/presence.css';
            installMessagingFixture(); if (location.search.includes('dark')) document.body.classList.add('theme_dark');
            const {default: Messaging} = await import('/@fs/${path.resolve("../mensajeria/messaging_module.jsx").replaceAll("\\", "/")}');
            createRoot(document.getElementById('root')).render(React.createElement(Messaging));
        </script></body></html>`;
        response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(await server.transformIndexHtml("/", html));
    });
    await server.listen(); console.log("Fixture http://127.0.0.1:5186/ (?dark); synthetic messages only, no application APIs.");
    await new Promise(resolve => {for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, resolve);});
    await server.close();
} else {
    const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5186", pretendToBeVisual: true});
    for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "MutationObserver", "Element", "HTMLTextAreaElement", "CustomEvent", "Event"]) Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true});
    globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
    const fixture = installMessagingFixture();
    console.log("Messaging DOM: loading isolated components…");
    const {default: React} = await import("react"), {createRoot} = await import("react-dom/client");
    const {default: Messaging} = await server.ssrLoadModule(`/@fs/${path.resolve("../mensajeria/messaging_module.jsx").replaceAll("\\", "/")}`);
    const {default: Preferences} = await server.ssrLoadModule(`/@fs/${path.resolve("../perfil/messaging_preferences.jsx").replaceAll("\\", "/")}`);
    let root = createRoot(document.getElementById("root")); const settle = () => new Promise(resolve => setTimeout(resolve, 60));
    const waitFor = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate() && Date.now() < deadline) await settle();
        assert.ok(predicate(), "fixture did not reach the expected rendered state");
    };
    const input = text => {const field = document.querySelector("textarea"); Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(field, text); field.dispatchEvent(new Event("input", {bubbles: true}));};
    const submit = () => document.querySelector("form").dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    try {
        root.render(React.createElement(Messaging)); await waitFor(() => document.querySelectorAll(".messaging_message").length === 2);
        console.log("Messaging DOM: conversation rendered; checking interactions…");
        assert.equal(document.querySelectorAll(".messaging_message").length, 2);
        assert.equal(document.querySelector('#messaging_input').rows,1,"composer starts with one compact row");
        assert.ok(document.querySelector('[aria-label="Enviar mensaje"]'),"compact mobile send keeps an accessible name");
        assert.ok(document.querySelector('.messaging_chat_row .chat_unread_dot'));
        document.querySelector('[aria-label="Plegar conversaciones"]').click(); await settle();
        assert.ok(document.querySelector('.messaging_module.messaging_compact'));
        assert.equal(document.querySelector('[aria-label="Desplegar conversaciones"]').getAttribute('aria-expanded'),'false');
        assert.equal(localStorage.getItem('bold:chat:compact:fixture-account'),'true');
        document.querySelector('[aria-label="Desplegar conversaciones"]').click(); await settle();
        assert.equal(document.querySelector('.messaging_module.messaging_compact'),null);
        assert.equal(document.querySelectorAll('[aria-label="Editar mi mensaje"]').length, 1);
        assert.equal(document.querySelector(".messaging_text script"), null);
        assert.match(document.querySelector(".messaging_text").textContent, /<script>/);
        assert.equal(document.querySelector(".messaging_text a").rel, "noopener noreferrer");
        assert.equal(document.querySelectorAll(".messaging_day").length, 2);
        assert.match(document.querySelector(".messaging_peer").textContent, /En línea/);
        assert.ok(document.querySelector('[aria-label="Adjuntar imagen"]'));
        assert.ok(document.querySelector('[aria-label="Grabar nota de voz"]'));
        const reads = fixture.calls.length; await settle(); assert.equal(fixture.calls.length, reads, "no polling while idle");
        input("Prueba de envío"); await settle();
        let release; fixture.sendDelay = new Promise(resolve => {release = resolve;});
        submit(); submit(); await settle();
        assert.equal(fixture.calls.filter(call => call === "send").length, 1);
        assert.equal(document.querySelector('[type="submit"]').disabled, true);
        release(); await settle();
        assert.equal(document.querySelector("textarea").value, "");
        assert.equal(document.querySelectorAll(".messaging_message").length, 3);
        assert.ok(document.querySelector('.messaging_arriving'), "new sends animate but loaded history does not");
        fixture.sendDelay = null; fixture.failSend = true;
        input("No perder este borrador"); await settle(); submit(); await settle();
        assert.equal(document.querySelector("textarea").value, "No perder este borrador");
        assert.match(document.querySelector('[role="alert"]').textContent, /Conservamos tu texto/);
        fixture.failSend = false;
        document.querySelector('[aria-label="Editar mi mensaje"]').click(); await settle(); input("Texto corregido"); await settle(); submit(); await settle();
        assert.match(document.querySelector(".messaging_mine .messaging_text").textContent, /Texto corregido/);
        assert.match(document.querySelector(".messaging_mine footer").textContent, /editado/);
        assert.equal(document.querySelectorAll(".messaging_message").length, 3);
        root.unmount(); await settle();
        root = createRoot(document.getElementById("root")); root.render(React.createElement(Preferences)); await settle();
        document.querySelector('input[value="newline"]').click(); await settle(); submit(); await settle();
        assert.equal(fixture.enterBehavior,"newline");
        assert.match(document.querySelector('[role="status"]').textContent,/guardada/);
        root.unmount(); root = createRoot(document.getElementById("root")); root.render(React.createElement(Preferences)); await settle();
        assert.equal(document.querySelector('input[value="newline"]').checked,true); root.unmount();
        const {default: Presence} = await server.ssrLoadModule(`/@fs/${path.resolve("../tareas/src/presence_widget.jsx").replaceAll("\\", "/")}`);
        root = createRoot(document.getElementById("root")); root.render(React.createElement(Presence));
        await waitFor(() => document.querySelector('[aria-label^="Abrir chat con"]'));
        const beforeCard = fixture.calls.length;
        assert.ok(document.querySelector('.home_presence_open_chat .chat_unread_dot'));
        document.querySelector('[aria-label^="Ver perfil de"]').click(); await settle();
        assert.match(document.querySelector('[role="dialog"]').textContent, /Analista/);
        assert.match(document.querySelector('[role="dialog"]').textContent, /Equipo de IT/);
        assert.equal(document.querySelector('[role="dialog"] a').href, "mailto:fixture.peer@bold.gt");
        assert.equal(fixture.calls.length, beforeCard, "avatar must not open chat");
        document.querySelector('[aria-label="Cerrar información del empleado"]').click(); await settle();
        document.querySelector('[aria-label^="Abrir chat con"]').click(); await settle();
        assert.equal(fixture.calls.at(-1), `card:${fixture.peer.employee_id}`);
        document.querySelector('.home_presence_person').click(); await settle();
        assert.equal(fixture.calls.length, beforeCard + 2, "card padding also opens chat once");
        root.unmount(); globalThis.__messagingCore.activeAssignment.chat_enabled = false;
        root = createRoot(document.getElementById("root")); root.render(React.createElement(Presence)); await settle();
        assert.equal(document.querySelector('[aria-label^="Abrir chat con"]'), null);
        assert.ok(document.querySelector('[aria-label^="Ver perfil de"]'), "profile remains usable outside IT");
        root.unmount();
        const {MessageMedia, VoiceRecorder} = await server.ssrLoadModule(`/@fs/${path.resolve("../mensajeria/message_media.jsx").replaceAll("\\", "/")}`);
        console.log("Messaging DOM: checking audio, viewer and recorder…");
        const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, revoked = [];
        URL.createObjectURL = () => "blob:private-fixture"; URL.revokeObjectURL = value => revoked.push(value);
        const play = dom.window.HTMLMediaElement.prototype.play, pause = dom.window.HTMLMediaElement.prototype.pause;
        const audioContext = window.AudioContext; let decodes=0, contextClosed=0;
        window.AudioContext = class {
            constructor(options) {assert.equal(options.sampleRate,16000); this.state="running";}
            async decodeAudioData() {decodes++; return {duration:83,getChannelData:()=>new Float32Array([0,.5,0,1])};}
            async close() {this.state="closed"; contextClosed++;}
        };
        dom.window.HTMLMediaElement.prototype.play = function () {this.dispatchEvent(new Event("play")); return Promise.resolve();};
        dom.window.HTMLMediaElement.prototype.pause = function () {this.dispatchEvent(new Event("pause"));};
        root = createRoot(document.getElementById("root"));
        root.render(React.createElement(MessageMedia, {message: {id:"voice",conversation_id:fixture.conversation.id,media:{id:"voice",kind:"audio",mime_type:"audio/webm"}}})); await settle();
        const mediaCalls = fixture.calls.filter(value=>value==="media").length;
        await settle(); assert.equal(fixture.calls.filter(value=>value==="media").length,mediaCalls,"audio must not download until requested");
        document.querySelector('[aria-label="Reproducir nota de voz"]').click(); await settle();
        assert.ok(document.querySelector('audio[preload="none"]'));
        assert.ok(document.querySelector('[aria-label="Pausar nota de voz"]'),"one tap downloads and starts playback");
        assert.equal(decodes,1); assert.equal(contextClosed,1,"waveform decoding releases its audio context");
        const audioNode = document.querySelector('audio');
        Object.defineProperty(audioNode,"duration",{configurable:true,value:83});
        audioNode.dispatchEvent(new Event("loadedmetadata")); audioNode.currentTime=23; audioNode.dispatchEvent(new Event("timeupdate")); await settle();
        const seek = document.querySelector('[aria-label="Posición de la nota de voz"]');
        assert.equal(seek.disabled,false); assert.equal(seek.getAttribute('aria-valuetext'),"0:23 de 1:23");
        assert.ok(document.querySelector('.messaging_wave_bars i[data-played="true"]'));
        document.querySelector('[aria-label="Velocidad de reproducción: 1×"]').click(); await settle();
        assert.equal(document.querySelector('audio').playbackRate,1.5);
        document.querySelector('[aria-label="Velocidad de reproducción: 1.5×"]').click(); await settle(); assert.equal(audioNode.playbackRate,2);
        document.querySelector('[aria-label="Velocidad de reproducción: 2×"]').click(); await settle(); assert.equal(audioNode.playbackRate,1);
        window.dispatchEvent(new CustomEvent("bold:chat-audio-play",{detail:{}})); await settle();
        assert.ok(document.querySelector('[aria-label="Reproducir nota de voz"]'),"starting another note pauses the current player");
        document.querySelector('[aria-label="Reproducir nota de voz"]').click(); await settle();
        assert.equal(fixture.calls.filter(value=>value==="media").length,mediaCalls+1,"replay reuses the private blob");
        assert.equal(decodes,1,"replay reuses the decoded waveform");
        document.querySelector('[aria-label="Pausar nota de voz"]').click(); await settle();
        dom.window.HTMLMediaElement.prototype.play = () => Promise.reject(new Error("Synthetic playback failure"));
        document.querySelector('[aria-label="Reproducir nota de voz"]').click(); await settle();
        assert.match(document.querySelector('[role="alert"]').textContent,/No se pudo reproducir/);
        assert.ok(!document.querySelector('[aria-label="Reproducir nota de voz"]').disabled,"playback failure allows retry");
        window.AudioContext=audioContext;
        assert.equal(document.querySelector('a[download]'),null); root.unmount(); assert.ok(revoked.includes("blob:private-fixture"));
        console.log("Messaging DOM: audio passed; checking in-app image viewer…");
        dom.window.HTMLDialogElement.prototype.showModal = function () {this.setAttribute("open","");};
        dom.window.HTMLDialogElement.prototype.close = function () {this.removeAttribute("open");};
        root = createRoot(document.getElementById("root"));
        root.render(React.createElement(MessageMedia,{message:{id:"image",conversation_id:fixture.conversation.id,created_at:new Date().toISOString(),media:{id:"image",kind:"image",mime_type:"image/webp",width:640,height:360}},author:{name:"Equipo IT"}})); await settle();
        document.querySelector('.messaging_media_load').click(); await settle();
        const imageTrigger = document.querySelector('[aria-label="Ver imagen completa"]');
        assert.ok(!document.querySelector('a[target="_blank"]'),"image must not open a browser tab"); assert.ok(!document.querySelector('a[download]'),"download belongs inside the viewer only");
        const imageCalls=fixture.calls.filter(value=>value==="media").length;
        imageTrigger.focus(); imageTrigger.click(); await waitFor(()=>document.querySelector('dialog[open]'));
        console.log("Messaging DOM: viewer opened…");
        assert.ok(document.querySelector('dialog a[download]')); assert.match(document.querySelector('dialog').textContent,/Equipo IT/);
        document.querySelector('[aria-label="Ampliar imagen"]').click(); await settle();
        assert.equal(document.querySelector('dialog img').style.getPropertyValue('--image_zoom'),"1.5");
        document.querySelector('[aria-label="Ajustar imagen a la pantalla"]').click(); await settle();
        assert.equal(document.querySelector('[aria-label="Alejar imagen"]').disabled,true);
        document.querySelector('dialog').dispatchEvent(new Event("cancel",{cancelable:true})); await settle();
        assert.ok(!document.querySelector('dialog'),"Escape/cancel closes the viewer"); assert.ok(document.activeElement===imageTrigger,"closing the viewer restores focus to its image trigger");
        imageTrigger.click(); await waitFor(()=>document.querySelector('dialog[open]'));
        document.querySelector('[aria-label="Cerrar imagen"]').click(); await settle(); assert.ok(!document.querySelector('dialog'),"explicit close dismisses the viewer");
        assert.equal(fixture.calls.filter(value=>value==="media").length,imageCalls,"viewer and zoom make no new requests");
        root.unmount(); assert.ok(!document.querySelector('dialog'),"unmount removes the private viewer");
        console.log("Messaging DOM: image viewer passed…");
        dom.window.HTMLMediaElement.prototype.play=play; dom.window.HTMLMediaElement.prototype.pause=pause;
        URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
        let tracksStopped = 0, received = null, recording = false, recordingError = "";
        const track = {stop:()=>{tracksStopped++;}}, tracks = {getTracks:()=>[track]};
        Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async ()=>tracks}});
        globalThis.MediaRecorder = class {
            static isTypeSupported(type) {return type.startsWith("audio/webm");}
            constructor() {this.state="inactive"; this.mimeType="audio/webm";}
            start() {this.state="recording";}
            stop() {this.state="inactive"; this.ondataavailable({data:new Blob(["voice"],{type:this.mimeType})}); this.onstop();}
        };
        root = createRoot(document.getElementById("root"));
        root.render(React.createElement(VoiceRecorder,{onReady:file=>{received=file;},onRecording:value=>{recording=value;},onError:value=>{recordingError=value;}})); await settle();
        document.querySelector('[aria-label="Grabar nota de voz"]').click(); await settle(); assert.equal(recording,true);
        document.querySelector('[aria-label="Detener y escuchar grabación"]').click(); await settle();
        assert.equal(received.type,"audio/webm"); assert.equal(recording,false); assert.ok(tracksStopped>0); assert.equal(recordingError,"");
        received = null;
        document.querySelector('[aria-label="Grabar nota de voz"]').click(); await settle();
        document.querySelector('[aria-label="Descartar grabación"]').click(); await settle(); assert.equal(received,null);
        document.querySelector('[aria-label="Grabar nota de voz"]').click(); await settle();
        root.unmount(); assert.equal(recording,false); assert.ok(tracksStopped>=3); assert.equal(received,null);
        const {default: ImageEditor} = await server.ssrLoadModule(`/@fs/${path.resolve("../mensajeria/image_editor.jsx").replaceAll("\\", "/")}`);
        const imageDraws = [], drawingContext = {drawImage:(...args)=>imageDraws.push(args),beginPath:()=>{},rect:()=>{},fill:()=>{},strokeRect:()=>{},setLineDash:()=>{},moveTo:()=>{},lineTo:()=>{},stroke:()=>{}};
        dom.window.HTMLDialogElement.prototype.showModal = function () {this.setAttribute("open","");};
        dom.window.HTMLCanvasElement.prototype.getContext = () => drawingContext;
        dom.window.HTMLCanvasElement.prototype.toBlob = callback => callback(new Blob(["edited image"],{type:"image/webp"}));
        globalThis.Image = class {constructor() {this.naturalWidth=800; this.naturalHeight=600;} set src(value) {queueMicrotask(()=>this.onload?.());}};
        URL.createObjectURL = () => "blob:editor-fixture"; URL.revokeObjectURL = value => revoked.push(value);
        let editedImage = null;
        root = createRoot(document.getElementById("root"));
        root.render(React.createElement(ImageEditor,{file:new File(["image"],"fixture.png",{type:"image/png"}),onSave:file=>{editedImage=file;},onCancel:()=>{}}));
        await waitFor(()=>document.querySelector('dialog[open] canvas') && imageDraws.length>0);
        assert.equal(document.querySelectorAll('dialog input[type="range"]').length,4,"crop is keyboard-adjustable");
        [...document.querySelectorAll('dialog button')].find(node=>node.textContent==="Dibujar").click(); await settle();
        [...document.querySelectorAll('dialog button')].find(node=>node.textContent==="Añadir recuadro").click(); await settle();
        [...document.querySelectorAll('dialog button')].find(node=>node.textContent==="Usar imagen").click(); await settle();
        assert.equal(editedImage.type,"image/webp"); assert.ok(editedImage.size>0); root.unmount();
        assert.ok(revoked.includes("blob:editor-fixture")); URL.createObjectURL=oldCreate; URL.revokeObjectURL=oldRevoke;
        console.log("Messaging UI passed: private entry, safe links, presence, own edits, dates, no idle polling, double-submit/draft protection, compact composer, audio controls/waveform/retry, private in-app image viewer and recorder/editor.");
    } finally {await server.close(); dom.window.close();}
    process.exit(0); // Existing private-image cache owns a BroadcastChannel in Node.
}
