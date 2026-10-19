import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, unlink, rmdir} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
import {join} from "node:path";
import {build} from "../core/node_modules/esbuild/lib/main.js";
import {JSDOM} from "../core/node_modules/jsdom/lib/api.js";

test("Drive permite buscar antes de seleccionar Excel y descarta resultados antiguos", async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:"http://localhost/"});
    for (const key of ["window", "document", "HTMLElement", "Event", "Node"]) globalThis[key] = dom.window[key];
    Object.defineProperty(globalThis, "navigator", {value:dom.window.navigator, configurable:true});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const broadcast = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
    const calls = [];
    let finishOld;
    globalThis.__pickerApi = {drives:async()=>({drives:[]}), files:async(params)=>{
        calls.push(params);
        if (params.search === "Anterior") return new Promise(resolve=>{finishOld=resolve;});
        return {files:[{id:"folder", name:params.search || "Carpeta", capabilities:{canAddChildren:true}}]};
    }};
    const cache = fileURLToPath(new URL("../core/node_modules/.cache/", import.meta.url));
    await mkdir(cache, {recursive:true});
    const dir = await mkdtemp(join(cache,"bold-picker-")), output = join(dir,"picker.mjs");
    let root;
    try {
        await build({stdin:{contents:'export {DriveFolderPicker} from "../docs/drive_module.jsx";',resolveDir:fileURLToPath(new URL("../core/",import.meta.url)),loader:"jsx"},outfile:output,bundle:true,format:"esm",platform:"node",packages:"external",jsx:"automatic",loader:{".css":"empty"},define:{"import.meta.env":"{}"},plugins:[{name:"mock-api",setup(builder){builder.onLoad({filter:/workspace_api\.js$/},()=>({contents:"export const workspaceApi = globalThis.__pickerApi;",loader:"js"}));}}]});
        const React = await import("../core/node_modules/react/index.js");
        const {createRoot} = await import("../core/node_modules/react-dom/client.js");
        const {DriveFolderPicker} = await import(pathToFileURL(output));
        root=createRoot(document.getElementById("root"));
        await React.act(async()=>{root.render(React.createElement(DriveFolderPicker,{submit(){},submitDisabled:true,label:"Importar aquí"}));});
        const input=document.querySelector('input[type="search"]');
        assert.equal(input.disabled,false);
        assert.equal([...document.querySelectorAll("button")].find(button=>button.textContent==="Importar aquí").disabled,true);
        async function search(value) {
            await React.act(async()=>{
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,value);
                input.dispatchEvent(new window.Event("input",{bubbles:true}));
            });
            await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,280));});
        }
        await search("Anterior");
        await search("Destino");
        assert.equal(input.value,"Destino");
        assert.equal(calls.at(-1).search,"Destino");
        assert.equal(calls.at(-1).parent,"");
        await React.act(async()=>finishOld({files:[{id:"stale",name:"Respuesta anterior"}]}));
        assert.ok(document.querySelector(".drive_destination_folders").textContent.includes("Destino"));
        assert.ok(!document.querySelector(".drive_destination_folders").textContent.includes("Respuesta anterior"));
    } finally {
        if (root) {const {act}=await import("../core/node_modules/react/index.js"); await act(async()=>root.unmount());}
        await unlink(output).catch(()=>{}); await rmdir(dir); dom.window.close(); globalThis.BroadcastChannel = broadcast;
    }
});
