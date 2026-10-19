import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, unlink, rmdir} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
import {join} from "node:path";
import {build} from "../../core/node_modules/esbuild/lib/main.js";
import {JSDOM} from "../../core/node_modules/jsdom/lib/api.js";

test("el selector conserva ancho legible y permanece dentro de ventanas estrechas", async () => {
    const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:"http://localhost/"});
    for (const key of ["window","document","HTMLElement","Event","Node"]) globalThis[key]=dom.window[key];
    Object.defineProperty(globalThis,"navigator",{value:dom.window.navigator,configurable:true});
    globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    const cache=fileURLToPath(new URL("../../core/node_modules/.cache/",import.meta.url));
    await mkdir(cache,{recursive:true});
    const dir=await mkdtemp(join(cache,"bold-select-")), output=join(dir,"select.mjs");
    let root;
    try {
        await build({stdin:{contents:'export {BoldSelect} from "./shared/bold_select.jsx";',resolveDir:fileURLToPath(new URL("../../core/",import.meta.url)),loader:"jsx"},outfile:output,bundle:true,format:"esm",platform:"node",packages:"external",jsx:"automatic"});
        const React=await import("../../core/node_modules/react/index.js");
        const {createRoot}=await import("../../core/node_modules/react-dom/client.js");
        const {BoldSelect}=await import(pathToFileURL(output));
        root=createRoot(document.getElementById("root"));
        let selected;
        await React.act(async()=>root.render(React.createElement(BoldSelect,{label:"Estado",value:"new",options:[{value:"new",label:"Nueva"},{value:"review",label:"En revisión"}],onValueChange:value=>{selected=value;}})));
        const trigger=document.querySelector(".admin_select_trigger");
        trigger.getBoundingClientRect=()=>({width:68,left:260,right:328,top:150,bottom:182,height:32});
        Object.defineProperty(window,"innerWidth",{value:360,configurable:true});
        await React.act(async()=>trigger.click());
        const menu=document.querySelector(".admin_select_menu");
        assert.ok(parseFloat(menu.style.width)>=160);
        assert.equal(menu.style.boxSizing,"border-box");
        assert.ok(parseFloat(menu.style.left)>=12);
        assert.ok(parseFloat(menu.style.left)+parseFloat(menu.style.width)<=348);
        Object.defineProperty(window,"innerWidth",{value:170,configurable:true});
        await React.act(async()=>window.dispatchEvent(new window.Event("resize")));
        assert.ok(parseFloat(menu.style.width)<=146);
        assert.ok(parseFloat(menu.style.left)+parseFloat(menu.style.width)<=158);
        await React.act(async()=>document.querySelectorAll('[role="option"]')[1].click());
        assert.equal(selected,"review");
        assert.equal(document.querySelector(".admin_select_menu"),null);
    } finally {
        if(root){const {act}=await import("../../core/node_modules/react/index.js");await act(async()=>root.unmount());}
        await unlink(output).catch(()=>{});await rmdir(dir);dom.window.close();
    }
});
